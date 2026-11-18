// 도구 호출 에이전트 루프.
// AI(Gemini)가 질문을 보고 어떤 도구를 쓸지 스스로 고르고, 서버가 실행한 결과를 다시 AI에 돌려준다.
// 검색(google_search)은 Gemini 서버에서 실행되고, 나머지 도구는 이 파일에서 실행한다.
import { callGemini, geminiError, maskPii, type WebSource } from "./gemini";
import { judgeEligibility, MEDIAN_INCOME_2026, estimateNhisFee, medianRatioPercent } from "./standards";
import { fetchGov24Services, type ToolExecution } from "./tools";
import type { AuditResult } from "./docRules";
import type { PolicyDetail } from "./card";
import { verifyAnswer, type Verification } from "./verify";

export interface EligibilitySummary {
  medianRatioPercent: number;
  totalConvertedRentKRW: number;
  convertedDepositKRW: number;
  verdict: "eligible" | "needs_parent_check" | "ineligible";
  independent: boolean;
}

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
    }
  | { ok: false; error: string; traces: ToolExecution[] };

// 계획 세우기 차례가 하나 늘어서 8번까지
const MAX_TURNS = 8;

const PLAN_TOOLS = [
  "google_search",
  "calculate_eligibility",
  "lookup_subsidy_list",
  "audit_documents",
  "create_draft",
  "create_checklist",
  "ask_user",
  "answer",
];

const DECLARATIONS = [
  {
    name: "make_plan",
    description:
      "작업을 시작하기 전에 맨 먼저 한 번 호출해 실행 계획을 세운다. 사용자 목표를 이루려면 어떤 순서로 어떤 도구를 쓸지 2~5단계로 정한다. 마지막 단계는 tool을 answer로 둔다.",
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
    name: "calculate_eligibility",
    description:
      "청년월세 지원(시연 공고 기준) 자격을 실제로 계산한다: 1인 가구 기준 중위소득 대비 본인 소득 비율, 보증금 월세 환산 합산액, 독립가구 특례. 월세·소득·자격 판정 질문이면 반드시 호출한다. 값은 [사용자 정보]나 대화에서 확인된 것만 넣고, 모르는 값은 추측하지 말고 ask_user로 묻는다.",
    parameters: {
      type: "object",
      properties: {
        age: { type: "number", description: "만 나이" },
        monthlyIncomeManwon: { type: "number", description: "본인 월 소득(만 원)" },
        depositManwon: { type: "number", description: "임차 보증금(만 원)" },
        monthlyRentManwon: { type: "number", description: "월세(만 원)" },
        separateLivingMonths: { type: "number", description: "부모님과 따로 산 기간(개월), 함께 살면 0" },
        parentIncomeManwon: {
          type: "number",
          description: "원가구(부모님 가구) 월 소득 합계(만 원). 사용자가 답한 경우에만 넣는다",
        },
        parentHouseholdSize: { type: "number", description: "원가구 가구원 수(본인 포함). 사용자가 답한 경우에만 넣는다" },
      },
      required: ["age", "monthlyIncomeManwon", "depositManwon", "monthlyRentManwon", "separateLivingMonths"],
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
    name: "ask_user",
    description:
      "자격 판정이나 서류 검수에 꼭 필요한 정보가 없을 때 사용자에게 한 가지를 되묻는다. 이 도구를 부르면 대화가 사용자 답을 기다린다. 검색으로 알 수 있는 것은 묻지 않는다.",
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
- 맨 처음에는 반드시 make_plan을 한 번 호출해 2~5단계 계획을 세우고, 그다음 계획 순서대로 도구를 쓰세요. 도중에 계획과 다른 도구가 필요하면 그냥 쓰면 됩니다.
- 답하기 전에 필요한 도구를 스스로 고르세요: 최신 공고·금액·일정은 google_search, 자격 판정은 calculate_eligibility, 정부 지원사업 목록은 lookup_subsidy_list, 첨부 서류 점검은 audit_documents.
- 판정에 꼭 필요한 정보가 [사용자 정보]와 대화에 없으면 추측하지 말고 ask_user로 한 가지만 물으세요.
- 도구 결과에 "추가로필요한정보"가 있으면 최종 답을 내지 말고 바로 ask_user로 그 정보를 물으세요. "확인 필요"를 신청 단계나 주의 문구로 미루지 마세요.
- 사용자 정보의 값이 0이면 0으로 계산하세요. 값이 아예 없을 때만 묻습니다.
- 도구 결과의 수치를 그대로 쓰고, 도구 결과와 검색 결과가 다르면 둘 다 밝히세요.
- 검수에서 끝내지 말고 실행까지 이어 주세요: audit_documents를 썼다면 create_checklist로 제출 직전 체크리스트를 만들고, 보완에 설명이 필요하면(주소 불일치, 서류 지연 등) create_draft로 소명서·사유서 초안을 쓰세요.
- 사용자가 사유서·자기소개서·계획서 작성을 원하면 create_draft, 신청 준비·제출 방법을 물으면 create_checklist를 쓰세요.
- 도구를 다 쓴 뒤에는 위에서 정한 JSON 형식으로만 최종 답을 출력하세요.`;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
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
  const body = (withTools: boolean) => ({
    systemInstruction: {
      parts: [...input.request.systemInstruction.parts, { text: AGENT_RULES }],
    },
    contents,
    ...(withTools && {
      tools: [{ functionDeclarations: DECLARATIONS }, { google_search: {} }],
      // 내장 검색과 함수 호출을 한 요청에 같이 쓰려면 필요한 설정
      toolConfig: { includeServerSideToolInvocations: true },
    }),
    // Gemini 3 계열은 temperature를 낮추면 도구 호출이 반복될 수 있어 기본값을 둔다
    generationConfig: { thinkingConfig: { thinkingLevel: level, includeThoughts: true } },
  });

  show("AI가 목표를 보고 실행 계획을 세우고 있습니다...");

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // 마지막 차례에는 도구 없이 답만 받는다
    const res = await callGemini(key, body(turn < MAX_TURNS - 1));
    if (!res.ok) return { ok: false, error: await geminiError(res), traces };
    const cand = (await res.json())?.candidates?.[0];
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
      show("답변의 수치·판정·날짜·링크를 도구 결과와 대조하고 있습니다.", "verify");
      const checks = verifyAnswer(text, { summary, hosts: input.hosts });
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

      if (fixes.length && !verifyRetried && turn < MAX_TURNS - 1) {
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
              text: `[답변 검증 결과] 아래 문제를 고쳐 같은 JSON 형식으로 최종 답을 다시 출력하세요. 도구 결과의 수치와 판정을 그대로 쓰세요.\n${fixes
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
      show(
        fixes.length ? `검증 경고 ${fixes.length}건을 표시하고 답변을 보냅니다.` : "도구 결과와 대조해 검증을 마쳤습니다.",
        "done"
      );
      return {
        ok: true,
        text,
        sources: sources.slice(0, 8),
        traces,
        summary,
        audit,
        draft,
        checklist,
        verification,
        plan: plan.length ? plan.map((x) => ({ ...x })) : undefined,
      };
    }

    contents.push(cand.content);
    const responses: Record<string, unknown>[] = [];

    for (const p of calls) {
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
        response = { saved: true, note: "계획을 저장했습니다. 이제 계획 순서대로 도구를 실행하세요." };
      } else if (name === "calculate_eligibility") {
        step("calculate_eligibility", "자격 요건 계산");
        show(thought.slice(-140) || "입력 조건으로 중위소득 비율과 환산 월세를 계산합니다.");
        const age = n(args.age);
        const income = n(args.monthlyIncomeManwon);
        const deposit = n(args.depositManwon);
        const rent = n(args.monthlyRentManwon);
        const sep = n(args.separateLivingMonths);
        if ([age, income, deposit, rent, sep].some((v) => !Number.isFinite(v) || v < 0)) {
          response = { error: "값이 비었거나 잘못됐습니다. 모르는 값은 ask_user로 물어보세요." };
        } else {
          const j = judgeEligibility({
            age,
            monthlyIncomeKRW: income * 10000,
            separateLivingMonths: sep,
            depositKRW: deposit * 10000,
            rentKRW: rent * 10000,
          });
          // 독립가구 특례가 안 되면 원가구(부모님) 소득으로 최종 판정한다 (시연 공고: 원가구 중위 100% 이하)
          const pIncome = n(args.parentIncomeManwon);
          const pSize = n(args.parentHouseholdSize);
          const parentKnown = Number.isFinite(pIncome) && pIncome >= 0 && Number.isFinite(pSize) && pSize >= 1;
          const parentRatio = parentKnown ? medianRatioPercent(pIncome * 10000, pSize) : null;
          const verdict =
            j.verdict === "needs_parent_check" && parentRatio !== null
              ? parentRatio <= 100
                ? "eligible"
                : "ineligible"
              : j.verdict;
          const missing =
            j.verdict === "needs_parent_check" && parentRatio === null
              ? !Number.isFinite(pSize) || pSize < 1
                ? "부모님 가구원 수(본인 포함) — 원가구 기준 중위소득을 정하려면 필요. ask_user로 물을 것"
                : "부모님 가구 월 소득 합계 — 독립가구 특례 미적용이라 원가구 소득으로 최종 판정. ask_user로 물을 것"
              : null;
          summary = {
            medianRatioPercent: j.ratio,
            totalConvertedRentKRW: j.rent.total,
            convertedDepositKRW: j.rent.convertedDeposit,
            verdict,
            independent: j.independent,
          };
          response = {
            ...(missing && { 추가로필요한정보: missing }),
            ...(parentRatio !== null && {
              원가구소득비율: `${parentRatio}% (${pSize}인 가구 기준 중위소득 대비, 요건 100% 이하)`,
            }),
            본인소득비율: `${j.ratio}% (1인 가구 기준 중위소득 ${MEDIAN_INCOME_2026[1].toLocaleString("ko-KR")}원 대비, 요건 60% 이하)`,
            환산합산월세: `${j.rent.total.toLocaleString("ko-KR")}원 (보증금 환산율 연 5.5%, 시연 공고 상한 90만 원)`,
            월세요건: j.rent.eligible ? "충족" : "초과",
            독립가구특례: j.independent ? "적용" : "미적용",
            판정: { eligible: "신청 대상", needs_parent_check: "부모님 소득 확인 필요", ineligible: "요건 미충족" }[verdict],
            추정건강보험료: `월 ${estimateNhisFee(income * 10000).toLocaleString("ko-KR")}원`,
            기준: "2026년 기준 중위소득 · 시연용 공고 규칙",
          };
          addTrace({
            toolName: "calculate_eligibility",
            title: "자격 요건 계산",
            basis: "2026년 기준 중위소득 · 보증금 환산율 5.5%",
            source: "calc",
            input: { 만나이: `${age}세`, 월소득: `${income}만 원`, 보증금: `${deposit}만 원`, 월세: `${rent}만 원`, 별도거주: `${sep}개월` },
            output: response as Record<string, string>,
            status: verdict === "eligible" ? "done" : "warn",
          });
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
            task: String(x?.task || "").replace(/^s*d+s*[.)]s*/, "").slice(0, 60),
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
        };
      } else {
        response = { error: `알 수 없는 도구: ${name}` };
      }

      responses.push({ functionResponse: { ...(id && { id }), name, response } });
    }

    contents.push({ role: "user", parts: responses });
    // 다음 차례를 기다리는 동안에도 진행 상태를 갱신한다 (남은 계획 단계 또는 '답변 정리'가 회전)
    show(thought.slice(-140) || "도구 결과를 바탕으로 다음 단계를 진행하고 있습니다.");
  }
  return { ok: false, error: "도구 호출 횟수 제한을 넘었습니다.", traces };
}
