// 도구 호출 에이전트 루프.
// AI(Gemini)가 질문을 보고 어떤 도구를 쓸지 스스로 고르고, 서버가 실행한 결과를 다시 AI에 돌려준다.
// 검색(google_search)은 Gemini 서버에서 실행되고, 나머지 도구는 이 파일에서 실행한다.
import { callGemini, geminiError, groundSources, koreanThought, maskPii, recordUsage, type WebSource } from "./gemini";
import { judgeConditions, type ConditionField, type EligibilitySummary, type MyValues, type PolicyCondition } from "./eligibility";
import { fetchGov24Services, type ToolExecution } from "./tools";
import type { AuditResult } from "./docRules";
import { parseCard, type PolicyDetail } from "./card";
import { verifyAnswer, type Verification } from "./verify";
import { findAlternatives, lookupOfficial, searchNotices, type AltCandidate, type AltProfile } from "./alternatives";
import { cleanPolicyName, pickOfficial, policyNamesIn, type OfficialRecord } from "./officialFacts";
import { FILE_FORMATS, downloadName, fileMeta, normalizeFile, type GeneratedFile } from "./fileExport";

// 실행 단계 산출물: 제출용 초안과 제출 직전 체크리스트
export interface AgentDraft {
  policyName: string;
  title: string;
  purpose: string;
  text: string;
}
export interface AgentChecklist {
  policyName: string;
  items: { task: string; detail?: string; done?: boolean }[];
}

export interface AgentAsk {
  question: string;
  reason: string;
  field?: string;
  options?: string[];
}

type Step = { label: string; status: "done" | "active" | "pending" };

// AI가 처음에 세우는 실행 계획. tool은 이 단계에서 쓸 도구 (answer = 최종 답 정리)
export interface PlanStep {
  label: string;
  tool: string;
  done: boolean;
}

export interface AgentInput {
  key: string;
  level: "medium" | "high";
  request: { systemInstruction: { parts: { text: string }[] }; contents: unknown[] };
  pk: string;
  hasDocs: boolean;
  audit: ((p: PolicyDetail) => Promise<AuditResult | null>) | null;
  emit?: (event: string, data: unknown) => void;
  baseSteps: string[];
  signal?: AbortSignal;
  // 링크 검증에서 공식 사이트로 인정할 등록 사이트 도메인
  hosts?: string[];
  // 대안 찾기에 쓰는 온통청년 키와 내 정보
  yk?: string;
  profile?: AltProfile;
  // 자격 확인에 쓰는 내 숫자 정보
  myValues?: MyValues;
  // 파일 요청을 말로만 넘기지 않았는지 검증할 때 쓰는 원래 질문
  question?: string;
  // 에이전트 전에 쓴 시간 (인스타그램 가져오기 등). 함수 300초 한도에서 뺀다
  elapsedMs?: number;
}

export type AgentOutput =
  | {
      ok: true;
      text: string;
      sources: WebSource[];
      traces: ToolExecution[];
      summary?: EligibilitySummary;
      audit?: { policy: PolicyDetail; result: AuditResult };
      ask?: AgentAsk;
      draft?: AgentDraft;
      checklist?: AgentChecklist;
      verification?: Verification;
      plan?: PlanStep[];
      alternatives?: AltCandidate[];
      files?: GeneratedFile[];
      official?: OfficialRecord[];
    }
  | { ok: false; error: string; traces: ToolExecution[]; timedOut?: boolean };

// 계획 세우기와 대안 찾기 차례까지 넉넉히
const MAX_TURNS = 9;
// Vercel 함수는 300초에 끊긴다. 에이전트는 시작 후 260초 안에 끝내고, 남은 시간은 앞뒤 처리에 쓴다.
const AGENT_BUDGET_MS = 260_000;
// 이보다 적게 남으면 도구를 멈추고 최종 답을 쓴다 (도구 한 차례 + 깊은 추론 답변이 들어갈 시간)
const FINAL_RESERVE_MS = 100_000;

const PLAN_TOOLS = [
  "google_search",
  "check_eligibility",
  "lookup_subsidy_list",
  "check_policy",
  "search_policies",
  "find_alternatives",
  "audit_documents",
  "create_draft",
  "create_checklist",
  "create_file",
  "ask_user",
  "answer",
];

const DECLARATIONS = [
  {
    name: "make_plan",
    description:
      "작업을 시작할 때 맨 먼저 한 번 호출해 실행 계획을 세운다. 사용자 목표를 이루려면 어떤 순서로 어떤 도구를 쓸지 2~5단계로 정한다. 마지막 단계는 tool을 answer로 둔다. 같은 응답에서 첫 단계 도구도 함께 호출한다.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "사용자가 이루려는 목표 (30자 이내)" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "단계 이름 (15자 이내, 예: 자격 계산, 최신 공고 검색, 서류 대조)" },
              tool: {
                type: "string",
                description: `이 단계에서 쓸 도구: ${PLAN_TOOLS.join(", ")} 중 하나`,
              },
            },
            required: ["label", "tool"],
          },
        },
      },
      required: ["goal", "steps"],
    },
  },
  {
    name: "check_eligibility",
    description:
      "특정 정책의 실제 자격 조건과 사용자 정보를 서버가 대조한다. 먼저 check_policy, google_search, 첨부 공고문 중 하나로 그 정책의 조건을 확인한 뒤 호출한다. 확인한 공고에 없는 기준을 넣지 않는다. 서버는 [사용자 정보]의 나이·월 소득·보증금·월세·따로 산 기간·주택 소유를 직접 가져온다. 그 밖의 값(가구원 수, 가구 소득, 재산 등)은 [사용자 정보]나 대화에서 사용자가 밝힌 것만 values에 넣는다.",
    parameters: {
      type: "object",
      properties: {
        policyName: { type: "string", description: "정확한 정책 이름" },
        conditions: {
          type: "array",
          description: "숫자로 판정되는 조건",
          items: {
            type: "object",
            properties: {
              field: {
                type: "string",
                enum: ["age", "income", "medianRatio", "sepMonths", "deposit", "rent", "assets", "houses"],
                description:
                  "age 만 나이, income 월 소득(만 원), medianRatio 기준 중위소득 대비 %, sepMonths 따로 산 개월, deposit 보증금(만 원), rent 월세(만 원), assets 재산 합계(만 원), houses 본인 명의 주택 수(무주택 요건은 max 0)",
              },
              min: { type: "number" },
              max: { type: "number" },
              label: { type: "string", description: "공고의 조건 요약 (25자 이내)" },
              household: {
                type: "boolean",
                description: "원가구(부모)나 배우자 포함 가구처럼 가구 전체 소득을 보는 조건이면 true. false면 본인 소득을 1인 가구 기준으로 계산한다",
              },
              deductPercent: {
                type: "number",
                description: "income·medianRatio 조건에서 공고가 근로·사업소득을 공제해 소득을 계산하면 그 공제율(%). 예: 소득평가액 30. 공고·검색에서 확인한 경우만 넣는다. 한 조건에 넣으면 이 정책의 모든 소득 조건(특례의 소득 하한 포함)에 적용된다",
              },
              group: {
                type: "string",
                description:
                  "특례·예외처럼 '또는'으로 갈리는 자격 경로 이름(예: '원가구 기준', '독립 특례', '30세 이상 특례'). 같은 경로의 요건은 같은 이름으로 묶고, 그 경로의 요건(본인 소득 하한, 따로 산 기간 등)을 하나도 빠뜨리지 않는다. 모든 경로에 공통인 요건은 비운다.",
              },
            },
            required: ["field", "label"],
          },
        },
        otherConditions: {
          type: "array",
          items: { type: "string" },
          description: "숫자로 판정할 수 없어 사용자가 확인해야 할 조건 (거주 요건 등). 재산·무주택은 conditions의 assets·houses로 넣는다",
        },
        values: {
          type: "object",
          description: "대화에서 새로 확인한 사용자 값만",
          properties: {
            age: { type: "number" },
            incomeManwon: { type: "number" },
            depositManwon: { type: "number" },
            rentManwon: { type: "number" },
            sepMonths: { type: "number" },
            householdIncomeManwon: { type: "number", description: "가구 월 소득 합계(만 원)" },
            householdSize: {
              type: "number",
              description: "가구원 수(본인 포함). 사용자가 말했을 때만 넣고 추측하지 않는다. 비워 두면 서버가 가구원 수와 관계없이 결론이 같은지 계산하고, 갈리면 물어보라고 알려 준다",
            },
            assetsManwon: { type: "number", description: "예금·주식·차량 등 재산 합계(만 원)" },
            housesOwned: { type: "number", description: "본인 명의 주택 수 (무주택이면 0)" },
          },
        },
      },
      required: ["policyName"],
    },
  },
  {
    name: "lookup_subsidy_list",
    description: "행정안전부 보조금24 공식 API에서 서비스명에 키워드가 들어간 정부 지원사업 목록을 조회한다. 정책 이름을 찾거나 공식 소관기관을 확인할 때 쓴다.",
    parameters: {
      type: "object",
      properties: { keyword: { type: "string", description: "서비스명 검색어 (예: 월세, 취업, 창업)" } },
      required: ["keyword"],
    },
  },
  {
    name: "audit_documents",
    description:
      "사용자가 첨부한 서류를 특정 정책의 필요 서류·자격 조건과 대조해 누락, 발급일, 성명·주소 불일치를 검수한다. 서류가 첨부됐고 사용자가 서류 점검·검토를 원할 때만 호출한다. 필요 서류와 조건은 검색으로 확인한 최신 공고 기준으로 넣는다.",
    parameters: {
      type: "object",
      properties: {
        policyName: { type: "string" },
        requiredDocuments: { type: "array", items: { type: "string" }, description: "이 정책의 필요 서류 이름" },
        conditions: { type: "array", items: { type: "string" }, description: "이 정책의 자격 조건" },
      },
      required: ["policyName", "requiredDocuments", "conditions"],
    },
  },
  {
    name: "create_draft",
    description:
      "제출용 문서 초안(신청 사유서, 자기소개서, 활동계획서, 소명서 등)을 작성해 사용자에게 건넨다. 서류 검수에서 보완할 점이 나왔거나(예: 주소 불일치 소명) 사용자가 작성을 원할 때 쓴다. 사용자 정보와 도구 결과에 있는 사실만 쓰고, 모르는 내용은 [성명], [사유]처럼 대괄호로 비워 둔다. 600~1200자, 공고 심사 기준에 맞춰 구체적으로 쓴다.",
    parameters: {
      type: "object",
      properties: {
        policyName: { type: "string" },
        title: { type: "string", description: "문서 이름 (예: 신청 사유서)" },
        purpose: { type: "string", description: "이 초안이 필요한 이유 (30자 이내)" },
        text: { type: "string", description: "초안 본문" },
      },
      required: ["policyName", "title", "purpose", "text"],
    },
  },
  {
    name: "create_checklist",
    description:
      "제출 직전에 할 일을 순서대로 정리한 체크리스트를 만든다. 서류 발급(발급처·발급 옵션), 검수 보완, 초안 확인, 신청 사이트 접속과 제출까지 3~10단계. 서류 검수를 했거나 사용자가 신청 준비·제출 방법을 물을 때 쓴다.",
    parameters: {
      type: "object",
      properties: {
        policyName: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task: { type: "string", description: "할 일 (30자 이내)" },
              detail: { type: "string", description: "방법·주의점 (60자 이내)" },
            },
            required: ["task"],
          },
        },
      },
      required: ["policyName", "items"],
    },
  },
  {
    name: "find_alternatives",
    description:
      "사용자가 원하는 지원이 자격 미달·제외·마감 등으로 안 될 때, 같은 목적을 이룰 다른 지원을 온통청년·복지로·보조금24 실시간 공고에서 찾는다. 사용자의 지역·나이·취업 상태 등에 맞지 않는 공고는 서버가 걸러서 돌려준다.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "사용자가 실제로 이루려는 목적 (예: 어학시험 응시료 부담 줄이기, 30자 이내)" },
        blockedPolicy: { type: "string", description: "안 되는 지원 이름. 결과에서 뺀다" },
        reason: { type: "string", description: "안 되는 이유 (30자 이내)" },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "공고 이름에 들어갈 짧은 검색어 2~4개 (예: 응시료, 어학, 자격증, 평생교육). 문장이 아니라 단어로",
        },
        special: {
          type: "array",
          items: { type: "string" },
          description:
            "대화에서 사용자가 밝힌 해당 조건: 기초생활수급, 차상위계층, 한부모 가정, 장애인, 자립준비청년, 다문화 가정, 국가유공자 가족 중에서",
        },
      },
      required: ["goal", "keywords"],
    },
  },
  {
    name: "check_policy",
    description:
      "정책 이름으로 보조금24·온통청년의 공식 원문(지원 내용, 대상, 신청 기한, 최근 수정일)을 가져온다. 특정 정책의 금액·대상·기한을 답하기 전에 호출한다. 웹 검색보다 이 원문을 우선한다.",
    parameters: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "정확한 정책 이름 1~3개 (예: 국민취업지원제도)" },
      },
      required: ["names"],
    },
  },
  {
    name: "search_policies",
    description:
      "온통청년·복지로·보조금24 실시간 공고에서 사용자의 지역·나이·취업 상태에 맞는 공고를 최대 30개 가져온다. 공고 목록·비교표·마감 일정을 만들거나 '내가 받을 수 있는 공고'를 물을 때 쓴다. keywords를 비우면 내 조건 기준 추천 공고를 가져온다.",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "공고 이름에 들어갈 짧은 단어 0~4개 (예: 월세, 취업, 자격증). 특정 분야가 없으면 비운다",
        },
        special: {
          type: "array",
          items: { type: "string" },
          description: "대화에서 사용자가 밝힌 해당 조건: 기초생활수급, 차상위계층, 한부모 가정, 장애인, 자립준비청년, 다문화 가정, 국가유공자 가족 중에서",
        },
      },
    },
  },
  {
    name: "create_file",
    description:
      "사용자가 내려받을 파일을 만든다. xlsx(엑셀 표), csv(표 데이터), docx(워드 문서), txt(글), ics(캘린더 일정). 표는 sheets, 글은 content, 일정은 events에 넣는다. search_policies·find_alternatives로 찾은 공고는 noticeRefs로 넣으면 서버가 원본으로 표를 채운다. 파일이 여러 개 필요하면 여러 번 호출한다.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: FILE_FORMATS, description: "파일 형식" },
        fileName: { type: "string", description: "확장자를 뺀 파일 이름 (예: 청년지원_공고목록)" },
        description: { type: "string", description: "파일 설명 (30자 이내)" },
        sheets: {
          type: "array",
          description: "표. xlsx는 시트별로, docx·txt에서는 본문 뒤의 표로 들어간다",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "시트 이름" },
              columns: { type: "array", items: { type: "string" }, description: "열 이름. 금액은 단위를 여기에 쓴다 (예: 금액(원))" },
              rows: {
                type: "array",
                items: { type: "array", items: { type: "string" } },
                description: "행 목록. 각 행은 columns 순서의 값. 숫자 칸에는 숫자만 쓴다",
              },
              sumColumns: { type: "array", items: { type: "string" }, description: "맨 아래 합계를 낼 열 이름. 직접 더하지 말고 여기에 넣는다" },
            },
            required: ["name", "columns", "rows"],
          },
        },
        content: { type: "string", description: "docx·txt 본문. # 제목, ## 소제목, - 목록, | 표 | 를 쓸 수 있다" },
        events: {
          type: "array",
          description: "ics 일정",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD" },
              title: { type: "string" },
              note: { type: "string" },
            },
            required: ["date", "title"],
          },
        },
        noticeRefs: {
          type: "array",
          items: { type: "string" },
          description: "파일에 넣을 공고의 ref 목록. 찾은 공고 전부면 [\"all\"]",
        },
      },
      required: ["format", "fileName"],
    },
  },
  {
    name: "ask_user",
    description:
      "자격 판정이나 서류 검수, 결과가 완전히 달라지는 작업에 꼭 필요한 정보가 없을 때 사용자에게 한 가지를 되묻는다. 이 도구를 부르면 대화가 사용자 답을 기다린다. 검색으로 알 수 있는 것은 묻지 않는다.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "사용자에게 할 짧은 질문 (40자 이내)" },
        reason: { type: "string", description: "왜 필요한지 (30자 이내)" },
        field: {
          type: "string",
          description:
            "답을 저장할 항목: age, income, deposit, rent, sepMonths, parentIncome(부모님 가구 월 소득), parentHouseholdSize(부모님 가구원 수), moveInDate, householdSize, other 중 하나",
        },
        options: { type: "array", items: { type: "string" }, description: "고를 수 있는 답이 정해져 있으면 2~4개" },
      },
      required: ["question", "reason"],
    },
  },
];

const AGENT_RULES = `
[도구 사용 규칙]
- 맨 처음 응답에서 make_plan으로 2~5단계 계획을 세우고, 같은 응답에서 첫 단계 도구도 함께 호출하세요 (계획만 세우고 멈추지 마세요). 그다음 계획 순서대로 도구를 쓰세요. 도중에 계획과 다른 도구가 필요하면 그냥 쓰면 됩니다.
- 답하기 전에 필요한 도구를 스스로 고르세요: 자격 판정은 공고 조건을 확인한 뒤 check_eligibility, 지원사업 목록은 lookup_subsidy_list나 search_policies, 첨부 서류 점검은 audit_documents.
- 자격은 정책마다 다릅니다. 어떤 정책인지 모르면 묻거나 search_policies로 후보를 찾고, 고정된 일반 기준으로 판정하지 마세요. 숫자 조건을 모두 충족해도 나머지 조건이 남으면 "확인이 더 필요"라고 답하세요.
- 판정에 꼭 필요한 정보가 [사용자 정보]와 대화에 없으면 추측하지 말고 ask_user로 한 가지만 물으세요.
- 사용자가 말한 사정(주택 보유, 재산, 혼인, 나이 등)이 공고의 자격 조건과 관련되면 그 조건부터 conditions에 넣어 판정하세요. 이미 미충족 조건이 있으면 다른 정보를 묻지 말고 안 되는 이유와 대안으로 답하세요.
- 소득을 공제해 계산하는 공고(예: 소득평가액 = 근로·사업소득 30% 공제)라면 직접 계산하지 말고 check_eligibility 소득 조건에 deductPercent로 넣으세요. 공고·검색에서 확인하지 않은 공제·환산·예외 규칙은 만들지 마세요.
- 특례·예외가 있는 정책은 일반 경로와 특례 경로를 check_eligibility의 group으로 나눠 넣으세요. 판정은 서버가 경로 규칙으로 계산하니 그 결과를 그대로 쓰세요.
- 사용자가 사업 이름을 말하면 그 사업의 기준으로 판정하세요. 이름이 비슷한 다른 사업(예: 국토교통부 청년월세 지원과 서울시 청년월세지원)의 기준을 섞지 말고, 지자체 사업은 따로 밝혀 대안이나 추가 안내로 넣으세요.
- 도구 결과에 "추가로필요한정보"가 있으면 최종 답을 내지 말고 바로 ask_user로 그 정보를 물으세요. "확인 필요"를 신청 단계나 주의 문구로 미루지 마세요.
- 사용자 정보의 값이 0이면 0으로 계산하세요. 값이 아예 없을 때만 묻습니다.
- values에는 [사용자 정보]나 대화에서 사용자가 밝힌 값, 또는 그 값들의 합계(예: 부모 소득 + 본인 소득)만 넣으세요. 가구원 수처럼 밝히지 않은 값을 "맞벌이 부모면 3인"처럼 추측해 채우지 마세요.
- [사용자 정보]의 가구원 수는 지금 함께 사는 가구 기준입니다. 청년 본인 가구(청년가구) 조건에만 쓰고, 부모님을 포함한 원가구 조건에는 쓰지 마세요. 1인 가구라면 청년가구 소득 조건은 household를 비우고 본인 소득으로 판정하세요.
- 도구 결과의 수치를 그대로 쓰고, 도구 결과와 검색 결과가 다르면 둘 다 밝히세요.
- 특정 정책의 금액·대상·기한을 말하기 전에 check_policy로 공식 원문을 확인하세요. 기록이 여러 개면 최근 수정된 원문을 따르고, 답변에서 다룬 정책은 policies에 넣으세요.
- google_search는 원문이 없을 때, 또는 원문에 없는 최신 변경이나 세부 기준(특례 요건, 소득 공제, 보증금·월세 상한 등)이 필요할 때만 쓰세요. 검색어는 한 번에 2개 이내로 쓰고, 이미 확인한 내용을 다시 검색하지 마세요.
- 검수에서 끝내지 말고 실행까지 이어 주세요: audit_documents를 썼다면 create_checklist로 제출 직전 체크리스트를 만들고, 보완에 설명이 필요하면(주소 불일치, 서류 지연 등) create_draft로 소명서·사유서 초안을 쓰세요.
- 사용자가 사유서·자기소개서·계획서 작성을 원하면 create_draft, 신청 준비·제출 방법을 물으면 create_checklist를 쓰세요.
- 안 된다는 결론(자격 미달, 대상 제외, 마감, 예산 소진)에서 멈추지 마세요. 왜 안 되는지 밝히고, 사용자가 진짜 이루려던 목적을 정한 뒤 find_alternatives를 호출하세요. 전국 제도까지 확인이 필요하면 google_search도 쓰세요.
- 대안은 사용자 조건에 맞는 것만 alternatives에 최대 3개 넣으세요. find_alternatives 결과는 ref를 그대로 쓰고, 조건이 확실하지 않으면 why에 확인할 점을 쓰세요. 없는 공고를 지어내지 마세요.
- 대안을 찾았다면 summary에 "안 되는 이유 + 대신 쓸 수 있는 길"을 함께 쓰세요. 찾아봐도 없으면 찾지 못했다고 밝히고 확인할 곳을 안내하세요.

[요청 처리 범위]
- 정책 질문이 아니어도 거절하지 말고 직접 처리하세요. 글·메일·번역·요약·비교표·계획표는 결과물 전체를 body에 쓰고, summary에는 무엇을 했는지 한 줄로 쓰세요.
- 파일을 달라고 하면 설명만 하지 말고 create_file을 호출하세요. 표·목록·예산은 xlsx, 문서는 docx, 일정은 ics가 기본입니다. 파일 내용을 body에 다시 쓰지 마세요.
- PDF·한글(hwp)·PPT 파일은 만들 수 없습니다. 내용을 docx로 만들고, 그 형식으로는 못 만들어 Word 파일로 만들었으며 한글·Word에서 열어 다른 형식으로 저장할 수 있다고 summary나 caution에 밝히세요.
- 공고 목록이나 공고 비교가 필요하면 search_policies로 실제 공고를 찾고, 파일에는 noticeRefs로 넣으세요. 공고 내용을 직접 옮겨 적지 마세요.
- 표와 문서의 사실·금액·날짜는 사용자 정보, 도구, 검색으로 확인한 값만 쓰세요. 모르는 칸은 "확인 필요"로 두고, 예시 값을 넣었으면 caution에 예시라고 밝히세요.
- 글·표·파일 같은 결과물을 만들 때 정보가 조금 모자라면 되묻기보다 합리적인 가정으로 먼저 만들고 그 가정을 caution에 쓰세요. 결과가 완전히 달라질 때만 ask_user를 쓰세요. 자격 판정에는 가정을 쓰지 말고 위 규칙대로 물으세요.
- 실제로 할 수 없는 일(대신 신청·제출, 로그인, 메일 발송, 결제, 전화)은 할 수 없다고 짧게 밝히고, 사용자가 바로 쓸 결과물(초안, 체크리스트, 일정 파일)을 만들어 주세요.
- 도구를 다 쓴 뒤에는 위에서 정한 JSON 형식으로만 최종 답을 출력하세요.`;

const strs = (v: unknown, max = 8) =>
  (Array.isArray(v) ? v : []).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, max);

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const { key, level, emit, baseSteps } = input;
  const traces: ToolExecution[] = [];
  const toolSteps: string[] = [];
  const sources: WebSource[] = [];
  let summary: EligibilitySummary | undefined;
  let audit: { policy: PolicyDetail; result: AuditResult } | undefined;
  let draft: AgentDraft | undefined;
  let checklist: AgentChecklist | undefined;
  // 답변 검증에서 고칠 점이 나오면 한 번만 다시 쓰게 한다
  let verifyRetried = false;
  // 대안 찾기 결과 (여러 번 찾으면 합친다)
  let altSearched = false;
  const alternatives: AltCandidate[] = [];
  // 이번 답변에서 조회한 공고 전체 (파일에 넣을 때 원본으로 쓴다)
  const notices: AltCandidate[] = [];
  const remember = (list: AltCandidate[]) => {
    for (const c of list) if (!notices.some((x) => x.ref === c.ref)) notices.push(c);
  };
  const files: GeneratedFile[] = [];
  let usedSearch = false;
  // 정책별 공식 원문 (같은 답변에서 다시 조회하지 않는다)
  const official = new Map<string, OfficialRecord[]>();
  const loadOfficial = (names: string[]) =>
    Promise.all(
      names
        .filter((name) => !official.has(name))
        .map(async (name) => {
          official.set(name, await lookupOfficial({ pk: input.pk, yk: input.yk }, name, input.profile?.sido));
        })
    );
  const officialRecords = () => Array.from(official.values()).flat();
  // AI가 처음에 세운 계획. 도구를 실행할 때마다 해당 단계를 체크한다
  let plan: PlanStep[] = [];
  const markPlan = (tool: string) => {
    const s = plan.find((x) => !x.done && x.tool === tool);
    if (s) s.done = true;
    return Boolean(s);
  };
  // 계획에 있는 도구면 계획 단계를 체크하고, 계획에 없던 도구면 단계를 따로 추가한다
  const step = (tool: string, label: string) => {
    if (!markPlan(tool)) toolSteps.push(label);
  };

  // 진행 단계: (계획) 도구 실행 → 답변 정리 → 답변 검증 → 완료
  type Phase = "tools" | "write" | "verify" | "done";
  const show = (thought: string, phase: Phase | boolean = "tools") => {
    let p: Phase = phase === true ? "write" : phase === false ? "tools" : phase;
    const planned = plan.filter((x) => x.tool !== "answer");
    const firstOpen = planned.findIndex((x) => !x.done);
    // 계획한 도구를 다 썼으면 AI가 답을 쓰는 중이므로 '답변 정리'를 진행 중으로 보여 준다 (회전 표시가 사라지지 않게)
    if (p === "tools" && plan.length && firstOpen < 0) p = "write";
    const order = { tools: 0, write: 1, verify: 2, done: 3 }[p];
    emit?.("step", {
      steps: [
        ...baseSteps.map((label): Step => ({ label, status: "done" })),
        // 계획이 있으면 계획 단계를 그대로 보여 주고, 실행한 단계에 체크한다 (건너뛴 단계는 체크하지 않음)
        ...planned.map((x, i): Step => ({
          label: x.label,
          status: x.done ? "done" : p === "tools" && i === firstOpen ? "active" : "pending",
        })),
        ...toolSteps.map((label, i): Step => ({
          label,
          status: plan.length || p !== "tools" || i < toolSteps.length - 1 ? "done" : "active",
        })),
        // 계획을 세우는 동안에도 진행 중 표시가 보이게
        ...(!plan.length && !toolSteps.length && p === "tools" ? [{ label: "실행 계획 세우기", status: "active" } as Step] : []),
        { label: "답변 정리", status: order > 1 ? "done" : order === 1 ? "active" : "pending" } as Step,
        { label: "답변 검증", status: order > 2 ? "done" : order === 2 ? "active" : "pending" } as Step,
      ],
      thought,
    });
  };
  const addTrace = (t: Omit<ToolExecution, "step">) => traces.push({ step: traces.length + 1, ...t });

  const contents: unknown[] = [...input.request.contents];
  const deadline = Date.now() + AGENT_BUDGET_MS - Math.min(Math.max(input.elapsedMs || 0, 0), 80_000);
  const remain = () => deadline - Date.now();
  let timeNote = "";
  // 도구 선언은 늘 같이 보낸다 (지난 도구 호출 기록과 맞아야 한다). 답만 받을 차례에는 함수 호출을 끈다
  const body = (withTools: boolean) => ({
    systemInstruction: {
      parts: [...input.request.systemInstruction.parts, { text: AGENT_RULES + timeNote }],
    },
    contents,
    tools: [{ functionDeclarations: DECLARATIONS }, { google_search: {} }],
    // 내장 검색과 함수 호출을 한 요청에 같이 쓰려면 includeServerSideToolInvocations가 필요하다
    toolConfig: { includeServerSideToolInvocations: true, ...(!withTools && { functionCallingConfig: { mode: "NONE" } }) },
    // Gemini 3 계열은 temperature를 낮추면 도구 호출이 반복될 수 있어 기본값을 둔다
    generationConfig: { thinkingConfig: { thinkingLevel: level, includeThoughts: true } },
  });

  show("AI가 목표를 보고 실행 계획을 세우고 있습니다...");

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // 시간이 얼마 안 남았으면 도구 없이 지금까지 결과로 답한다
    const outOfTime = remain() < FINAL_RESERVE_MS;
    if (outOfTime && !timeNote) {
      timeNote =
        "\n\n[시간 제한] 더 이상 도구를 쓰지 말고 지금까지 확인한 결과로 최종 답을 JSON 형식으로 주세요. 확인하지 못한 부분은 caution에 밝히세요.";
      show("시간 안에 끝내기 위해 지금까지 확인한 내용으로 답을 정리하고 있습니다.");
    }
    // 마지막 차례에는 도구 없이 답만 받는다. 남은 시간을 넘기면 호출을 끊는다 (응답 본문 읽기까지 포함)
    const timeout = { ok: false as const, error: "시간 제한 안에 답을 만들지 못했습니다. 질문을 조금 나눠서 다시 물어봐 주세요.", traces, timedOut: true };
    if (remain() <= 0) return timeout;
    let json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const res = await callGemini(key, body(turn < MAX_TURNS - 1 && !outOfTime), AbortSignal.timeout(remain()));
      if (!res.ok) return { ok: false, error: await geminiError(res), traces };
      json = await res.json();
    } catch (e) {
      // 시간 초과로 끊긴 것만 시간 초과로 본다. 네트워크 오류는 검색 답변으로 다시 시도할 수 있게 둔다
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") return timeout;
      return { ok: false, error: "AI 서버와 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.", traces };
    }
    recordUsage(json);
    const cand = json?.candidates?.[0];
    const parts: Record<string, any>[] = cand?.content?.parts || []; // eslint-disable-line @typescript-eslint/no-explicit-any

    const thought = parts
      .filter((p) => p.thought && p.text)
      .map((p) => p.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // 서버에서 실행된 검색 (Gemini가 직접 실행)
    for (const p of parts) {
      if (p.toolCall?.toolType === "GOOGLE_SEARCH_WEB") {
        const queries = strs(p.toolCall.args?.queries, 4);
        usedSearch = true;
        step("google_search", `웹 검색: ${queries[0] || "최신 공고"}`);
        addTrace({
          toolName: "google_search",
          title: `웹 검색 ${queries.length}건`,
          basis: "웹 검색",
          source: "live",
          input: Object.fromEntries(queries.map((q, i) => [`검색어 ${i + 1}`, q])),
          output: { 결과: "검색 결과를 읽고 답변 근거로 사용" },
          status: "done",
        });
      }
    }
    for (const c of cand?.groundingMetadata?.groundingChunks || []) {
      const url = String(c?.web?.uri || "");
      if (/^https:\/\//.test(url) && !sources.some((s) => s.url === url)) {
        sources.push({ title: String(c.web.title || new URL(url).hostname).slice(0, 80), url });
      }
    }

    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim();
      if (!text) return { ok: false, error: "AI가 빈 답을 보냈습니다.", traces };

      // 답변 검증: 수치·판정은 도구 결과와, 날짜는 오늘과, 링크는 공식 도메인과 대조한다
      show("답변의 수치·판정·날짜·링크를 도구 결과와 공식 원문에 대조하고 있습니다.", "verify");
      // AI가 확인하지 않은 정책도 서버가 공식 원문을 찾아 대조한다
      const answerCard = parseCard(text);
      if (answerCard) await loadOfficial(policyNamesIn(answerCard));
      const checks = verifyAnswer(text, {
        summary,
        hosts: input.hosts,
        alternativesSearched: altSearched,
        alternatives,
        question: input.question,
        fileCount: files.length,
        official: officialRecords(),
      });
      const fixes = checks.filter((c) => !c.ok && c.severity === "fix");
      const passedCount = checks.filter((c) => c.ok).length;
      const verifyTrace = (title: string, status: "done" | "warn") =>
        addTrace({
          toolName: "answer_verify",
          title,
          basis: "도구 결과 · 오늘 날짜 · 공식 도메인과 대조",
          source: "calc",
          input: { 검사: checks.map((c) => c.name).join(", ") },
          output: Object.fromEntries(checks.map((c) => [c.name, `${c.ok ? "통과" : "확인 필요"} · ${c.note}`])),
          status,
        });

      if (fixes.length && !verifyRetried && turn < MAX_TURNS - 1 && remain() > FINAL_RESERVE_MS) {
        // 고칠 점을 AI에게 돌려주고 같은 형식으로 다시 쓰게 한다 (한 번만)
        verifyRetried = true;
        verifyTrace(`답변 검증: 고칠 점 ${fixes.length}건 → 다시 작성`, "warn");
        toolSteps.push(`검증 결과 반영해 다시 쓰기 (${fixes.length}건)`);
        show(`검증에서 고칠 점 ${fixes.length}건을 찾아 답변을 다시 쓰고 있습니다: ${fixes[0].name}`);
        contents.push(cand.content);
        contents.push({
          role: "user",
          parts: [
            {
              text: `[답변 검증 결과] 아래 문제를 고쳐 같은 JSON 형식으로 최종 답을 다시 출력하세요. 필요한 도구가 있으면 먼저 쓰세요. 도구 결과의 수치와 판정을 그대로 쓰세요.\n${fixes
                .map((f) => `- ${f.name}: ${f.note}`)
                .join("\n")}`,
            },
          ],
        });
        continue;
      }

      markPlan("answer");
      const verification: Verification = { passed: !fixes.length, retried: verifyRetried, checks };
      verifyTrace(
        `답변 검증 ${passedCount}/${checks.length} 통과${verifyRetried ? " · 1회 고쳐 씀" : ""}`,
        fixes.length ? "warn" : "done"
      );
      // 출처: 공식 원문을 먼저 두고, 검색을 썼는데 출처가 없으면 답변 핵심을 다시 확인해 받는다
      const records = officialRecords();
      if (usedSearch && !sources.length && answerCard && remain() > 20_000) {
        show("답변의 근거 출처를 확인하고 있습니다.", "verify");
        const brief = [answerCard.summary, ...answerCard.facts.map((f) => `${f.label}: ${f.value}`)].join(" / ");
        sources.push(...(await groundSources(key, input.question || "", brief)));
      }
      const officialSources: WebSource[] = pickOfficial(records)
        .filter((r) => /^https:\/\//.test(r.url))
        .map((r) => ({ title: `${r.source}: ${r.name} (${r.updated} 수정)`.slice(0, 80), url: r.url }));
      const allSources = [...officialSources, ...sources].filter(
        (s, i, all) => all.findIndex((x) => x.url === s.url) === i
      );
      show(
        fixes.length ? `검증 경고 ${fixes.length}건을 표시하고 답변을 보냅니다.` : "도구 결과와 대조해 검증을 마쳤습니다.",
        "done"
      );
      return {
        ok: true,
        text,
        sources: allSources.slice(0, 8),
        official: records,
        traces,
        summary,
        audit,
        draft,
        checklist,
        verification,
        plan: plan.length ? plan.map((x) => ({ ...x })) : undefined,
        alternatives,
        files,
      };
    }

    contents.push(cand.content);
    const responses: Record<string, unknown>[] = [];

    // make_plan을 첫 도구와 같은 차례에 부르면 계획부터 저장해야 그 도구가 계획 단계에 체크된다. 응답은 호출 순서대로 돌려준다.
    const isPlan = (i: number) => Number(calls[i].functionCall.name === "make_plan");
    for (const i of calls.map((_, i) => i).sort((a, b) => isPlan(b) - isPlan(a))) {
      const p = calls[i];
      const { name, args = {}, id } = p.functionCall as { name: string; args?: Record<string, unknown>; id?: string };
      let response: Record<string, unknown>;

      if (name === "make_plan") {
        const goal = String(args.goal || "").slice(0, 40);
        const steps: PlanStep[] = (Array.isArray(args.steps) ? args.steps : [])
          .map((x: Record<string, unknown>) => ({
            label: String(x?.label || "").slice(0, 20),
            tool: PLAN_TOOLS.includes(String(x?.tool)) ? String(x?.tool) : "answer",
            done: false,
          }))
          .filter((x: PlanStep) => x.label)
          .slice(0, 6);
        if (!steps.some((x) => x.tool === "answer")) steps.push({ label: "답변 정리", tool: "answer", done: false });
        plan = steps;
        addTrace({
          toolName: "make_plan",
          title: `실행 계획 ${plan.length}단계`,
          basis: goal || "사용자 목표",
          source: "live",
          input: { 목표: goal || "-" },
          output: Object.fromEntries(plan.map((x, i) => [`${i + 1}`, x.label])),
          status: "done",
        });
        show(`계획: ${plan.map((x) => x.label).join(" → ")}`);
        response = { saved: true, note: "계획을 저장했습니다. 남은 단계를 계획 순서대로 실행하세요." };
      } else if (name === "find_alternatives") {
        const goal = String(args.goal || "").slice(0, 40);
        const blocked = String(args.blockedPolicy || "").slice(0, 40);
        const keywords = strs(args.keywords, 4).map((k) => k.trim().slice(0, 15)).filter(Boolean);
        step("find_alternatives", `대안 찾기: ${goal || keywords[0] || "다른 지원"}`);
        show(`${blocked ? `'${blocked}' 대신 ` : ""}${goal || "같은 목적"}에 쓸 수 있는 지원을 실시간 공고에서 찾고 있습니다.`);
        if (!keywords.length) {
          response = { error: "검색어가 없습니다. 공고 이름에 들어갈 단어를 keywords에 넣으세요." };
        } else {
          const profile: AltProfile = {
            ...input.profile,
            special: Array.from(new Set([...(input.profile?.special || []), ...strs(args.special)])),
          };
          try {
            const found = await findAlternatives({ pk: input.pk, yk: input.yk }, profile, { keywords, exclude: blocked });
            altSearched = true;
            for (const c of found.candidates) if (!alternatives.some((x) => x.ref === c.ref)) alternatives.push(c);
            remember(found.candidates);
            response = {
              조회한곳: found.searched,
              찾은수: found.candidates.length,
              공고: found.candidates.map((c) => ({
                ref: c.ref,
                이름: c.name,
                기관: c.org,
                내용: c.summary.slice(0, 100),
                대상: c.target.slice(0, 80),
                기한: c.applyEnd || c.deadlineText.slice(0, 30),
              })),
              note: found.candidates.length
                ? "내 지역·조건으로 거른 결과입니다. 맞는 것을 골라 ref와 함께 alternatives에 넣으세요."
                : "맞는 공고가 없습니다. 검색어를 바꿔 한 번 더 찾거나 google_search로 전국 제도를 확인하세요.",
            };
            addTrace({
              toolName: "find_alternatives",
              title: `대안 찾기: ${found.candidates.length}건`,
              basis: found.searched.join(" · ") || "실시간 공고",
              source: "live",
              input: { 목적: goal || "-", 안되는지원: blocked || "-", 검색어: keywords.join(", ") },
              output: found.candidates.length
                ? Object.fromEntries(found.candidates.map((c, i) => [`${i + 1}`, `${c.name} (${c.org || "기관 미상"})`]))
                : { 결과: "조건에 맞는 공고 없음" },
              status: found.candidates.length ? "done" : "warn",
            });
          } catch {
            response = { error: "실시간 공고 조회에 실패했습니다. google_search로 대안을 확인하세요." };
          }
        }
      } else if (name === "check_policy") {
        const names = strs(args.names, 3).map(cleanPolicyName).filter(Boolean);
        step("check_policy", `공식 원문 확인: ${names[0] || "정책"}`);
        show(`${names.join(", ") || "정책"}의 공식 원문을 확인하고 있습니다.`);
        await loadOfficial(names);
        const found = names.flatMap((x) => official.get(x) || []);
        response = {
          찾은수: found.length,
          원문: found.map((r) => ({
            이름: r.name,
            기관: r.org,
            출처: r.source,
            최근수정: r.updated,
            이름일치: r.exact,
            지원내용: r.benefit,
            대상: r.target.slice(0, 200),
            신청기한: r.deadline,
          })),
          note: found.length
            ? "이름이 일치하는 기록 중 최근 수정된 원문을 기준으로 쓰세요."
            : "공식 원문을 찾지 못했습니다. google_search로 확인하고 공식 공고 확인이 필요하다고 밝히세요.",
        };
        addTrace({
          toolName: "check_policy",
          title: `공식 원문 확인: ${found.length}건`,
          basis: "보조금24 · 온통청년",
          source: "live",
          input: { 정책: names.join(", ") || "-" },
          output: found.length
            ? Object.fromEntries(found.map((r, i) => [`${i + 1}`, `${r.name} (${r.source}, ${r.updated} 수정)`]))
            : { 결과: "공식 원문 없음" },
          status: found.length ? "done" : "warn",
        });
      } else if (name === "search_policies") {
        const keywords = strs(args.keywords, 4).map((k) => k.trim().slice(0, 15)).filter(Boolean);
        step("search_policies", `공고 찾기: ${keywords.join(", ") || "내 조건 추천"}`);
        show(`${keywords.length ? `'${keywords.join(", ")}' 공고를` : "내 조건에 맞는 공고를"} 실시간으로 찾고 있습니다.`);
        const profile: AltProfile = {
          ...input.profile,
          special: Array.from(new Set([...(input.profile?.special || []), ...strs(args.special)])),
        };
        try {
          const found = await searchNotices({ pk: input.pk, yk: input.yk }, profile, keywords);
          remember(found.candidates);
          response = {
            조회한곳: found.searched,
            찾은수: found.candidates.length,
            공고: found.candidates.map((c) => ({
              ref: c.ref,
              이름: c.name,
              기관: c.org,
              내용: c.summary.slice(0, 80),
              기한: c.applyEnd || c.deadlineText.slice(0, 30),
            })),
            note: found.candidates.length
              ? "파일에 넣으려면 create_file의 noticeRefs에 ref를 넣으세요. 전부 넣으려면 [\"all\"]."
              : "맞는 공고가 없습니다. 검색어를 바꾸거나 찾지 못했다고 밝히세요.",
          };
          addTrace({
            toolName: "search_policies",
            title: `공고 찾기: ${found.candidates.length}건`,
            basis: found.searched.join(" · ") || "실시간 공고",
            source: "live",
            input: { 검색어: keywords.join(", ") || "내 조건 추천" },
            output: found.candidates.length
              ? Object.fromEntries(found.candidates.slice(0, 12).map((c, i) => [`${i + 1}`, `${c.name} (${c.org || "기관 미상"})`]))
              : { 결과: "조건에 맞는 공고 없음" },
            status: found.candidates.length ? "done" : "warn",
          });
        } catch {
          response = { error: "실시간 공고 조회에 실패했습니다. google_search로 확인하세요." };
        }
      } else if (name === "create_file") {
        const made = normalizeFile(args, notices, (t) => maskPii(t).masked);
        if ("error" in made) {
          response = { error: made.error };
        } else {
          const { file } = made;
          const fullName = downloadName(file);
          step("create_file", `파일 만들기: ${fullName}`);
          show(`'${fullName}' 파일을 만들고 있습니다.`);
          // 같은 이름으로 다시 만들면 새 파일로 바꾼다
          const same = files.findIndex((f) => downloadName(f) === fullName);
          if (same >= 0) files[same] = file;
          else files.push(file);
          response = {
            saved: true,
            파일: fullName,
            내용: fileMeta(file),
            note: "화면에 파일 이름과 다운로드 버튼이 표시됩니다. summary에는 무엇을 만들었는지 한 줄로 쓰고, facts·steps에 파일 이름이나 파일 내용을 반복하지 마세요.",
          };
          addTrace({
            toolName: "create_file",
            title: `파일 만들기: ${fullName}`,
            basis: fileMeta(file),
            source: "calc",
            input: { 형식: file.format, 설명: file.description || "-" },
            output: { 파일: fullName, 내용: fileMeta(file) },
            status: "done",
          });
        }
      } else if (name === "check_eligibility") {
        const policyName = cleanPolicyName(String(args.policyName || ""));
        step("check_eligibility", `자격 확인: ${policyName || "정책"}`);
        show(`${policyName || "정책"}의 공고 조건과 내 정보를 대조하고 있습니다.`);
        const number = (v: unknown) => {
          const x = v === "" || v === null || v === undefined ? NaN : Number(v);
          return Number.isFinite(x) && x >= 0 ? x : undefined;
        };
        const FIELDS: ConditionField[] = ["age", "income", "medianRatio", "sepMonths", "deposit", "rent", "assets", "houses"];
        const conditions: PolicyCondition[] = (Array.isArray(args.conditions) ? args.conditions : [])
          .map((c: Record<string, unknown>) => ({
            field: c?.field as ConditionField,
            min: number(c?.min),
            max: number(c?.max),
            label: String(c?.label || "").slice(0, 40),
            household: c?.household === true,
            deductPercent: number(c?.deductPercent),
            group: c?.group ? String(c.group).slice(0, 20) : undefined,
          }))
          .filter((c: PolicyCondition) => FIELDS.includes(c.field) && c.label && (c.min !== undefined || c.max !== undefined))
          .slice(0, 12);
        // 경로(group)는 "또는"이라 2개 이상일 때만 뜻이 있다. 하나뿐이면 일반 경로를 빠뜨린 것이다
        const groupNames = new Set(conditions.map((c) => c.group).filter(Boolean));
        const said = (args.values || {}) as Record<string, unknown>;
        const keys: (keyof MyValues)[] = ["age", "incomeManwon", "depositManwon", "rentManwon", "sepMonths", "householdIncomeManwon", "householdSize", "assetsManwon", "housesOwned"];
        const values: MyValues = { ...input.myValues };
        for (const k of keys) {
          const v = number(said[k]);
          if (v !== undefined) values[k] = v;
        }
        if (!policyName) {
          response = { error: "정책 이름이 없습니다. 어떤 정책인지 확인하세요." };
        } else if (groupNames.size === 1) {
          response = {
            error:
              "group은 '또는'으로 갈리는 경로가 2개 이상일 때만 씁니다. 일반 경로(예: 원가구 기준)와 특례 경로를 각각 group으로 나눠 다시 호출하고, 경로가 하나뿐이면 group을 비우세요.",
          };
        } else {
          await loadOfficial([policyName]);
          const judged = judgeConditions({
            policyName,
            conditions,
            others: strs(args.otherConditions, 6),
            values,
            records: official.get(policyName) || [],
            otherEvidence: usedSearch || input.hasDocs,
            otherEvidenceLabel: input.hasDocs ? "첨부 공고문" : "웹 검색",
          });
          const result = judged.summary;
          if (!result) {
            response = {
              error: judged.rejected.length
                ? `근거가 확인되지 않은 조건입니다: ${judged.rejected.join(", ")}. check_policy나 google_search로 공고 조건을 먼저 확인하세요.`
                : "대조할 조건이 없습니다. 공고의 자격 조건을 확인해 conditions에 넣으세요.",
            };
          } else {
            summary = result;
            const verdictLabel = { eligible: "확인한 조건 모두 충족", needs_check: "확인이 더 필요", ineligible: "미충족 조건 있음" }[result.verdict];
            const statusLabel = { pass: "충족", fail: "미충족", unknown: "정보 없음" };
            response = {
              ...(judged.missing.length && { 추가로필요한정보: `${judged.missing.join(", ")} — ask_user로 물을 것` }),
              ...(judged.rejected.length && { 근거없어제외한조건: judged.rejected }),
              판정: verdictLabel,
              조건별: result.checks.map((c) => ({ 조건: c.label, 내값: c.mine, 결과: statusLabel[c.status], 근거: c.basis })),
              ...(result.checks.some((c) => c.group) && { 경로판정: "[경로] 표시 조건은 경로 중 하나만 모두 충족하면 됩니다. 판정은 이 규칙으로 계산한 결과입니다." }),
              직접확인할조건: result.others,
              기준: result.basis,
            };
            addTrace({
              toolName: "check_eligibility",
              title: `자격 확인: ${policyName}`,
              basis: result.basis,
              source: "calc",
              input: { 정책: policyName, 조건: `${result.checks.length}개` },
              output: {
                판정: verdictLabel,
                ...Object.fromEntries(result.checks.map((c, i) => [`${i + 1}. ${c.label}`, `${c.mine} · ${statusLabel[c.status]}`])),
              },
              status: result.verdict === "eligible" ? "done" : "warn",
            });
          }
        }
      } else if (name === "lookup_subsidy_list") {
        const keyword = String(args.keyword || "청년").slice(0, 20);
        step("lookup_subsidy_list", `보조금24 조회: ${keyword}`);
        show(`보조금24 공식 API에서 '${keyword}' 지원사업을 찾습니다.`);
        if (!input.pk) {
          response = { available: false, note: "공공데이터포털 키가 없어 조회할 수 없습니다. google_search로 확인하세요." };
        } else {
          const list = await fetchGov24Services(input.pk, keyword);
          response = { count: list.length, services: list };
          addTrace({
            toolName: "lookup_subsidy_list",
            title: `보조금24 지원사업 조회: ${keyword}`,
            basis: "행정안전부 보조금24 API",
            url: "https://www.gov.kr/portal/rcvfvrSvc/main",
            source: "live",
            input: { 검색어: keyword },
            output: list.length ? Object.fromEntries(list.map((s, i) => [`${i + 1}. ${s.name}`, s.org])) : { 결과: "없음" },
            status: "done",
          });
        }
      } else if (name === "audit_documents") {
        const policy: PolicyDetail = {
          name: String(args.policyName || "지원사업").slice(0, 40),
          conditions: strs(args.conditions),
          documents: strs(args.requiredDocuments).map((d) => ({ name: d })),
        };
        step("audit_documents", `서류 대조: ${policy.name}`);
        show(`첨부 서류를 '${policy.name}' 필요 서류 ${policy.documents.length}종과 대조하고 있습니다.`);
        const result = input.hasDocs && input.audit ? await input.audit(policy) : null;
        if (!result) {
          response = { error: input.hasDocs ? "서류 판독에 실패했습니다." : "첨부된 서류가 없습니다. 서류를 올려 달라고 ask_user로 요청하세요." };
        } else {
          audit = { policy, result };
          const risks = result.findings.filter((f) => f.severity !== "pass");
          response = {
            반려위험: risks.length,
            항목: risks.map((f) => ({ 제목: f.title, 보완: f.fixAction, 심각도: f.severity })),
          };
          addTrace({
            toolName: "audit_documents",
            title: `서류 대조: ${policy.name}`,
            basis: `AI 깊은 추론 · 필요 서류 ${policy.documents.length}종 기준`,
            source: "live",
            input: { 정책: policy.name, 서류: `${result.documents.length}건` },
            output: risks.length ? Object.fromEntries(risks.map((f, i) => [`${i + 1}`, f.title])) : { 결과: "반려 위험 없음" },
            status: risks.length ? "warn" : "done",
          });
        }
      } else if (name === "create_draft") {
        const title = String(args.title || "신청 사유서").slice(0, 40);
        step("create_draft", `초안 작성: ${title}`);
        show(`보완점을 반영해 '${title}' 초안을 쓰고 있습니다.`);
        const text = maskPii(String(args.text || "").slice(0, 4000)).masked.trim();
        if (text.length < 50) {
          response = { error: "초안 본문이 너무 짧습니다. 600자 이상으로 다시 쓰세요." };
        } else {
          draft = {
            policyName: String(args.policyName || "").slice(0, 40),
            title,
            purpose: String(args.purpose || "").slice(0, 60),
            text,
          };
          response = { saved: true, chars: text.length, note: "사용자 화면에 편집 가능한 초안으로 표시됨" };
          addTrace({
            toolName: "create_draft",
            title: `초안 작성: ${title}`,
            basis: `${draft.policyName || "정책"} · ${text.length}자`,
            source: "live",
            input: { 목적: draft.purpose || "-" },
            output: { 분량: `${text.length}자`, "빈칸": `${(text.match(/\[[^\]]+\]/g) || []).length}곳` },
            status: "done",
          });
        }
      } else if (name === "create_checklist") {
        const items = (Array.isArray(args.items) ? args.items : [])
          .map((x: Record<string, unknown>) => ({
            // 화면이 번호를 붙이므로 AI가 붙인 "1." 같은 번호는 뗀다
            task: String(x?.task || "").replace(/^\s*\d+\s*[.)]\s*/, "").slice(0, 60),
            detail: x?.detail ? String(x.detail).slice(0, 120) : undefined,
          }))
          .filter((x: { task: string }) => x.task)
          .slice(0, 10);
        step("create_checklist", `제출 체크리스트 ${items.length}단계`);
        show("제출 직전에 할 일을 순서대로 정리하고 있습니다.");
        if (!items.length) {
          response = { error: "항목이 없습니다." };
        } else {
          checklist = { policyName: String(args.policyName || "").slice(0, 40), items };
          response = { saved: true, count: items.length };
          addTrace({
            toolName: "create_checklist",
            title: `제출 체크리스트 ${items.length}단계`,
            basis: checklist.policyName || "정책",
            source: "live",
            input: { 정책: checklist.policyName || "-" },
            output: Object.fromEntries(items.map((x: { task: string }, i: number) => [`${i + 1}`, x.task])),
            status: "done",
          });
        }
      } else if (name === "ask_user" && summary?.verdict === "ineligible") {
        // 이미 미충족 조건이 있으면 어떤 답을 받아도 결론이 같으므로 묻지 않는다
        response = {
          asked: false,
          note: `${summary.policyName}에는 이미 미충족 조건이 있어 더 묻지 않습니다. 안 되는 이유를 밝히고 find_alternatives로 대안을 찾아 최종 답을 내세요. 다른 정책에 필요한 정보라면 그 정책을 먼저 check_eligibility로 판정하세요.`,
        };
      } else if (name === "ask_user") {
        const ask: AgentAsk = {
          question: String(args.question || "추가 정보가 필요합니다.").slice(0, 80),
          reason: String(args.reason || "").slice(0, 60),
          field: typeof args.field === "string" ? args.field.slice(0, 20) : undefined,
          options: strs(args.options, 4),
        };
        step("ask_user", "사용자에게 확인 요청");
        addTrace({
          toolName: "ask_user",
          title: "추가 정보 요청",
          basis: "판정에 필요한 정보 부족",
          source: "calc",
          input: { 필요한정보: ask.field || "기타" },
          output: { 질문: ask.question, 이유: ask.reason },
          status: "warn",
        });
        show(`판정에 필요한 정보가 없어 사용자에게 묻습니다: ${ask.reason}`, true);
        return {
          ok: true,
          text: "",
          sources: sources.slice(0, 8),
          traces,
          summary,
          audit,
          draft,
          checklist,
          ask,
          plan: plan.length ? plan.map((x) => ({ ...x })) : undefined,
          files,
        };
      } else {
        response = { error: `알 수 없는 도구: ${name}` };
      }

      responses[i] = { functionResponse: { ...(id && { id }), name, response } };
    }

    contents.push({ role: "user", parts: responses });
    // 다음 차례를 기다리는 동안에도 진행 상태를 갱신한다 (남은 계획 단계 또는 '답변 정리'가 회전)
    show(koreanThought(thought) || "도구 결과를 바탕으로 다음 단계를 진행하고 있습니다.");
  }
  return { ok: false, error: "도구 호출 횟수 제한을 넘었습니다.", traces };
}
