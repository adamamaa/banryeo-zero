export interface InterviewQuestion {
  id: string;
  question: string;
  easyHint: string;
  adminTermReplaced: string;
  options: {
    value: string;
    label: string;
    subLabel: string;
    ruleImpact: "pass" | "special_pass" | "warning";
    ruleNote: string;
  }[];
}

export interface DocumentRecipe {
  id: string;
  title: string;
  issuer: string;
  issuerUrl: string;
  required: boolean;
  eliminatedReason?: string;
  timeEstimate: string;
  checkboxOptions: {
    label: string;
    mustCheck: boolean;
    reason: string;
  }[];
}

export interface AuditFinding {
  id: string;
  docId: string;
  docTitle: string;
  type: "single_rule" | "cross_check" | "seal_verify";
  severity: "critical" | "warning" | "pass";
  title: string;
  detail: string;
  ruleReference: string;
  fixAction: string;
  highlightBox?: {
    top: string;
    left: string;
    width: string;
    height: string;
    badgeText: string;
  };
}

export interface MockDocumentPreview {
  docId: string;
  docTitle: string;
  fileName: string;
  renamedFileName: string;
  issuedDate: string;
  headerTitle: string;
  fields: {
    label: string;
    value: string;
    status: "ok" | "error" | "warning";
    errorTag?: string;
  }[];
  stampText?: string;
  stampStatus?: "valid" | "missing";
}

export interface PolicyScenario {
  id: string;
  badge: string;
  category: "주거·생활" | "일·구직 (KDT 연계)";
  title: string;
  ministry: string;
  maxBenefitText: string;
  maxBenefitAmount: number;
  pageCount: number;
  abandonRateText: string;
  summary: string;
  announcementExcerpts: {
    id: string;
    page: string;
    section: string;
    rawText: string;
    plainTranslation: string;
    isSpecialClause?: boolean;
  }[];
  personas: {
    id: string;
    name: string;
    tag: string;
    description: string;
    answers: Record<string, string>;
    verdictHeadline: string;
    verdictClauseId: string;
    confidenceScore: number;
    expectedBenefit: string;
    verdictReason: string;
  }[];
  questions: InterviewQuestion[];
  allDocumentsCount: number;
  requiredDocumentsCount: number;
  documentRecipes: DocumentRecipe[];
  auditScenarios: {
    defect: {
      summaryTitle: string;
      passProbability: number;
      documents: MockDocumentPreview[];
      findings: AuditFinding[];
      crossCheckMatrix: {
        checkName: string;
        sourceA: string;
        sourceB: string;
        status: "pass" | "fail";
        note: string;
      }[];
    };
    fixed: {
      summaryTitle: string;
      passProbability: number;
      documents: MockDocumentPreview[];
      findings: AuditFinding[];
      crossCheckMatrix: {
        checkName: string;
        sourceA: string;
        sourceB: string;
        status: "pass" | "fail";
        note: string;
      }[];
    };
  };
  applicationFormTemplate: {
    formTitle: string;
    autoFilledFields: {
      label: string;
      value: string;
      sourceDoc: string;
    }[];
    essayTitle: string;
    essayPrompt: string;
    forbiddenWords: string[];
    recommendedKeywords: string[];
    generatedEssayDraft: string;
  };
}

export const POLICY_SCENARIOS: PolicyScenario[] = [
  {
    id: "monthly-rent-2026",
    badge: "대표 시나리오 A · 주거/생활",
    category: "주거·생활",
    title: "2026 청년월세 한시 특별지원",
    ministry: "국토교통부 · 전국 지자체",
    maxBenefitText: "최대 240만 원 (월 20만 원 × 12개월)",
    maxBenefitAmount: 2400000,
    pageCount: 28,
    abandonRateText: "공고문 열람 후 중도 포기·보완 처분율 42.8%",
    summary:
      "원가구/독립가구 분리 기준, 건보료 피부양자 예외, 보증금 월세 환산액, 등본·계약서 교차검증이 얽혀 있어 가장 많은 청년이 읽다가 포기하거나 서류 미비로 반려당하는 대표 사업",
    announcementExcerpts: [
      {
        id: "clause-basic",
        page: "3p 본문 제2조",
        section: "연령 및 거주 요건 (기본 조건)",
        rawText:
          "신청일 기준 만 19세~34세 이하인 부모와 별도 거주 무주택 청년으로서, 임차보증금 5천만 원 이하 및 월세 70만 원 이하인 주택에 거주하는 자. (단, 월세가 70만 원을 초과하더라도 보증금 월세 환산액(환산율 5.5%)과 월세액을 합산하여 90만 원 이하인 경우 지원 대상에 포함한다.)",
        plainTranslation:
          "월세가 70만 원을 넘어도(예: 보증금 1,000만 원 / 월세 75만 원), 보증금 환산액(약 4.5만 원) + 월세(75만 원) = 79.5만 원으로 90만 원 이하이므로 신청할 수 있습니다.",
        isSpecialClause: true,
      },
      {
        id: "clause-income",
        page: "8p 본문 제4조",
        section: "소득 및 재산 요건 (원가구 합산 원칙)",
        rawText:
          "청년 본인가구 기준중위소득 60% 이하(재산 1.22억 이하) 및 부모 등을 포함한 원가구 기준중위소득 100% 이하(재산 4.7억 이하)를 동시에 충족하여야 한다. 건강보험 피부양자인 경우 부양자의 건강보험료 부과액을 합산하여 판정한다.",
        plainTranslation:
          "원칙적으로는 청년 본인 소득뿐만 아니라 부모님 소득(중위 100% 이하)까지 함께 봅니다. 하지만 아래 18페이지 [별표2] 특례에 해당하면 부모님 소득을 아예 보지 않습니다.",
      },
      {
        id: "clause-special",
        page: "18p [별표2] 특례",
        section: "청년 독립가구 단독 산정 특례 (원가구 소득 미반영)",
        rawText:
          "[별표2 예외조항 제3호] 만 30세 이상이거나, 혼인·미혼모·부이거나, 만 30세 미만 미혼 청년이라도 주민등록상 부모와 1년 이상 별도 거주하며 청년 본인의 소득이 기준중위소득 50% 이상(2026년 1인가구 기준 월 128만 2천 원 이상 ~ 60% 이하)인 경우 생계를 달리하는 것으로 보아 원가구(부모) 소득·재산 산정을 제외한다.",
        plainTranslation:
          "부모님 소득이 높아도 대상이 될 수 있습니다. ① 만 30세 이상이거나 ② 1년 이상 따로 살면서 월 소득이 약 128만~154만 원 구간이면 부모님 소득·재산을 보지 않고 본인 기준으로만 심사합니다.",
        isSpecialClause: true,
      },
      {
        id: "clause-docs",
        page: "22p [별표4] 서류규격",
        section: "제출서류 심사 및 즉시 보완(반려) 기준",
        rawText:
          "① 주민등록등본은 최근 5년 주소변동 이력 및 전입일·세대주 관계가 반드시 표시되어야 함(미표시 시 보완 처분). ② 임대차계약서는 확정일자 날인본이어야 하며 등본상 주소지(동·호수)와 일치해야 함. ③ 가족관계증명서는 신청인 기준 '상세' 증명서만 인정함('일반' 불인정).",
        plainTranslation:
          "서류에서 자주 보완 처분되는 3가지: ① 등본에 '전입일/과거주소' 체크 누락, ② 계약서 '확정일자 도장' 누락 또는 호수 오기재, ③ 가족관계증명서 '일반'으로 잘못 발급.",
      },
    ],
    personas: [
      {
        id: "persona-special",
        name: "김청년 (26세 · 자취 알바생)",
        tag: "별표2 독립가구 특례 대상",
        description:
          "부모님 소득이 높고 건보료 피부양자라 포기하려 했으나, 자취 1년 이상 + 알바 월 130만 원으로 18p [별표2] 부모 소득 제외 특례 통과 케이스",
        answers: {
          q_living: "sep_over_1y",
          q_rent: "rent_special",
          q_income: "self_120_to_143",
          q_parent: "parent_over_100",
        },
        verdictHeadline: "축하합니다! 18p [별표2] 독립가구 특례로 부모님 소득 무관 100% 지원 대상입니다",
        verdictClauseId: "clause-special",
        confidenceScore: 98,
        expectedBenefit: "총 2,400,000원 (월 20만 원 × 12개월 현금 지급)",
        verdictReason:
          "본문 8p만 읽으면 부모님 소득 초과 및 월세 70만 원 초과로 탈락처럼 보이지만, ① 3p 보증금 환산액 합산 특례(79.5만 원 ≤ 90만 원)와 ② 18p [별표2] '1년 이상 별도거주 + 중위 50~60% 구간 청년 단독산정 특례'가 동시에 적용되어 적격 판정되었습니다.",
      },
      {
        id: "persona-standard",
        name: "이수료 (24세 · KDT 부트캠프 취준생)",
        tag: "표준 적격 대상",
        description:
          "보증금 500만 원 / 월세 45만 원 원룸 거주, 현재 무소득 취준생이며 원가구(부모님) 건보료 기준 중위소득 100% 이하 충족 케이스",
        answers: {
          q_living: "sep_under_1y",
          q_rent: "rent_under_70",
          q_income: "self_under_120",
          q_parent: "parent_under_100",
        },
        verdictHeadline: "기본 자격 요건 완벽 충족! 즉시 신청 가능한 1순위 지원 대상입니다",
        verdictClauseId: "clause-basic",
        confidenceScore: 99,
        expectedBenefit: "총 2,400,000원 (월 20만 원 × 12개월 현금 지급)",
        verdictReason:
          "임차보증금 5천만 원 이하·월세 70만 원 이하 기본 요건과 청년가구(중위 60% 이하) 및 원가구(중위 100% 이하) 소득 요건을 모두 충족합니다.",
      },
    ],
    questions: [
      {
        id: "q_living",
        question: "현재 부모님과 주민등록상 따로 나와 살고 계신가요?",
        easyHint: "등본을 떼지 않아도 현재 전입신고가 부모님 댁과 분리되어 있는지만 떠올려 보세요.",
        adminTermReplaced: "주민등록상 세대분리 및 별도가구 보장 기간 요건",
        options: [
          {
            value: "sep_over_1y",
            label: "네, 전입신고하고 따로 산 지 1년 이상 됐어요",
            subLabel: "18p [별표2] 청년 독립가구 단독산정 특례 활성화 가능",
            ruleImpact: "special_pass",
            ruleNote: "1년 이상 별도 거주 확인 → 원가구 소득 미반영 특례 후보",
          },
          {
            value: "sep_under_1y",
            label: "네, 따로 살고 있지만 전입한 지 1년은 안 됐어요",
            subLabel: "기본 무주택 단독세대주 요건 충족",
            ruleImpact: "pass",
            ruleNote: "별도 거주 요건 충족 (원가구 소득 합산 판정)",
          },
          {
            value: "with_parents",
            label: "실제로는 자취 중인데 아직 전입신고를 안 했어요",
            subLabel: "신청 전 전입신고 선행 필수 안내",
            ruleImpact: "warning",
            ruleNote: "신청일 전까지 전입신고 완료 시 즉시 자격 부여 가능",
          },
        ],
      },
      {
        id: "q_rent",
        question: "지금 사시는 집의 보증금과 월세(관리비 제외)는 얼마인가요?",
        easyHint: "월세가 70만 원을 조금 넘더라도 보증금이 낮으면 단서조항으로 대상이 될 수 있습니다.",
        adminTermReplaced: "임차보증금 월세 환산액(환산율 5.5%) 합산 산식",
        options: [
          {
            value: "rent_under_70",
            label: "보증금 5,000만 원 이하이고, 월세도 70만 원 이하예요",
            subLabel: "예: 보증금 1,000만 원 / 월세 55만 원",
            ruleImpact: "pass",
            ruleNote: "3p 기본 거주비 요건 통과",
          },
          {
            value: "rent_special",
            label: "월세가 70만 원을 조금 넘지만 보증금이 3,000만 원 이하예요",
            subLabel: "예: 보증금 1,000만 원 / 월세 75만 원 (환산 합산 79.5만 원 ≤ 90만 원)",
            ruleImpact: "special_pass",
            ruleNote: "3p 단서조항(환산율 5.5% 합산 90만 원 이하) 특례 충족",
          },
        ],
      },
      {
        id: "q_income",
        question: "청년 본인의 월 세전 소득(알바·근로·사업 포함)은 어느 구간인가요?",
        easyHint: "통장에 찍히는 대략적인 금액만 고르시면 에이전트가 중위소득 %로 자동 변환합니다.",
        adminTermReplaced: "2026년 1인가구 기준중위소득 50%~60% 및 건보료 부과액",
        options: [
          {
            value: "self_120_to_143",
            label: "월 128만 원 ~ 154만 원 사이예요 (알바·단기근로 등)",
            subLabel: "중위소득 50% 이상 ~ 60% 이하 구간 (독립가구 특례 요건)",
            ruleImpact: "special_pass",
            ruleNote: "본인 생계유지 인정 구간 → 부모님 소득 산정 제외 가능",
          },
          {
            value: "self_under_120",
            label: "현재 소득이 없거나 월 128만 원 미만이에요",
            subLabel: "청년 본인가구 중위소득 60% 이하 충족",
            ruleImpact: "pass",
            ruleNote: "청년 본인 소득 요건 통과",
          },
        ],
      },
      {
        id: "q_parent",
        question: "부모님의 소득 수준(또는 건강보험료)은 대략 어느 정도인가요?",
        easyHint: "잘 모르시거나 부모님 소득이 높더라도 앞선 특례 조건에 따라 구제 여부를 자동 계산합니다.",
        adminTermReplaced: "원가구 기준중위소득 100% 및 건강보험 피부양자 분리 특례",
        options: [
          {
            value: "parent_over_100",
            label: "부모님 맞벌이 등으로 소득이 꽤 있으신 편이에요 (또는 잘 모름)",
            subLabel: "원가구 100% 초과 우려 시 18p [별표2] 독립가구 특례 자동 대조",
            ruleImpact: "special_pass",
            ruleNote: "18p [별표2] 제3호 특례 적용으로 원가구 소득 심사 제외",
          },
          {
            value: "parent_under_100",
            label: "은퇴하셨거나 3~4인 가구 평균 소득 이하예요",
            subLabel: "원가구 기준중위소득 100% 이하 충족",
            ruleImpact: "pass",
            ruleNote: "원가구 소득 요건 충족",
          },
        ],
      },
    ],
    allDocumentsCount: 12,
    requiredDocumentsCount: 4,
    documentRecipes: [
      {
        id: "doc-rr",
        title: "주민등록등본 (초본 아님)",
        issuer: "정부24",
        issuerUrl: "https://www.gov.kr",
        required: true,
        timeEstimate: "1분 소요 (무료)",
        checkboxOptions: [
          {
            label: "과거의 주소변동 사항: [최근 5년 포함] 체크",
            mustCheck: true,
            reason: "1년 이상 부모님과 별도 거주했음을 증명하는 필수 옵션 (미체크 시 보완 처분 대상)",
          },
          {
            label: "세대구성사유 및 전입일/변동일: [포함] 체크",
            mustCheck: true,
            reason: "현 주소지 전입일을 임대차계약서 계약기간과 대조하기 위해 필수",
          },
          {
            label: "교부 대상자 외 주민등록번호 뒷자리: [본인만 표시] 체크",
            mustCheck: true,
            reason: "개인정보보호 지침에 따라 본인만 공개, 동거인 있는 경우 뒷자리 마스킹",
          },
        ],
      },
      {
        id: "doc-lease",
        title: "임대차계약서 사본 (또는 신고필증)",
        issuer: "본인 보관 서류 / 부동산거래관리시스템",
        issuerUrl: "https://rtms.molit.go.kr",
        required: true,
        timeEstimate: "스마트폰 촬영 가능",
        checkboxOptions: [
          {
            label: "계약서 상단 또는 여백에 [확정일자 날인(도장)] 노출 필수",
            mustCheck: true,
            reason: "확정일자 도장이 없는 경우 정부24에서 '주택임대차계약 신고필증'을 추가 첨부해야 함",
          },
          {
            label: "계약서상 주소지(동·호수)와 주민등록등본 주소지 일치 확인",
            mustCheck: true,
            reason: "등본엔 301호인데 계약서에 302호로 적힌 경우 즉시 보완 처분됨",
          },
        ],
      },
      {
        id: "doc-family",
        title: "가족관계증명서 (신청인 본인 기준)",
        issuer: "대법원 전자가족관계등록시스템",
        issuerUrl: "https://efamily.scourt.go.kr",
        required: true,
        timeEstimate: "1분 소요 (무료)",
        checkboxOptions: [
          {
            label: "증명서 종류: 반드시 [상세 증명서] 선택 ('일반' 불인정)",
            mustCheck: true,
            reason: "공고문 23p 규정상 '일반증명서'는 인정되지 않음",
          },
          {
            label: "주민등록번호 뒷자리: [전부 공개] 선택",
            mustCheck: true,
            reason: "원가구 구성원(부모) 식별을 위해 상세+전부공개 필수",
          },
        ],
      },
      {
        id: "doc-bank",
        title: "청약통장 가입확인서 (및 월세 이체내역 1개월분)",
        issuer: "가입 은행 앱 / 청약홈",
        issuerUrl: "https://www.applyhome.co.kr",
        required: true,
        timeEstimate: "2분 소요",
        checkboxOptions: [
          {
            label: "예금주 성명(신청인 본인) 및 가입일자가 찍힌 화면/확인서 저장",
            mustCheck: true,
            reason: "종이통장이 없어도 모바일 앱 가입확인서 PDF로 대체 가능",
          },
        ],
      },
      {
        id: "doc-elim-1",
        title: "부모님 가족관계증명서 및 혼인관계증명서",
        issuer: "대법원",
        issuerUrl: "https://efamily.scourt.go.kr",
        required: false,
        eliminatedReason: "18p [별표2] 청년 독립가구 단독산정 특례 대상이므로 부모님 서류 제출 면제 (자동 소거)",
        timeEstimate: "제출 면제",
        checkboxOptions: [],
      },
      {
        id: "doc-elim-2",
        title: "원가구 부채증명원 및 부동산 등기부등본",
        issuer: "인터넷등기소 / 금융기관",
        issuerUrl: "http://www.iros.go.kr",
        required: false,
        eliminatedReason: "임차보증금 1,000만 원 이하로 부채 차감 증빙 불필요 (자동 소거)",
        timeEstimate: "제출 면제",
        checkboxOptions: [],
      },
      {
        id: "doc-elim-3",
        title: "법정대리인 동의서 및 위임장",
        issuer: "공고문 별지 제4호 서식",
        issuerUrl: "#",
        required: false,
        eliminatedReason: "청년 본인 직접 온라인 신청 케이스이므로 불필요 (자동 소거)",
        timeEstimate: "제출 면제",
        checkboxOptions: [],
      },
    ],
    auditScenarios: {
      defect: {
        summaryTitle: "반려 위험 4건 감지 — 제출 전 보완 필요",
        passProbability: 15,
        documents: [
          {
            docId: "doc-rr",
            docTitle: "주민등록등본",
            fileName: "주민등록등본_김청년.pdf",
            renamedFileName: "2026청년월세_김청년_01_주민등록등본.pdf",
            issuedDate: "2026. 11. 16.",
            headerTitle: "주민등록표 등본(교부용)",
            fields: [
              { label: "세대주 성명", value: "김청년 (990512-1234567)", status: "ok" },
              {
                label: "현 주소지",
                value: "서울특별시 관악구 봉천로 123, 301호 (봉천동)",
                status: "warning",
                errorTag: "계약서 호수(302호)와 불일치",
              },
              {
                label: "전입일 / 변동일",
                value: "[비공개 / 미표시]",
                status: "error",
                errorTag: "전입일 옵션 미체크",
              },
              {
                label: "과거 주소변동 이력",
                value: "표시 안 함 (현재 주소만 출력됨)",
                status: "error",
                errorTag: "최근 5년 주소변동 누락",
              },
            ],
            stampText: "관악구청장 직인 (정상)",
            stampStatus: "valid",
          },
          {
            docId: "doc-lease",
            docTitle: "주택임대차계약서",
            fileName: "원룸계약서_사진.jpg",
            renamedFileName: "2026청년월세_김청년_02_임대차계약서.pdf",
            issuedDate: "계약일: 2025. 08. 20.",
            headerTitle: "주택임대차표준계약서",
            fields: [
              { label: "임차인 성명", value: "김청년", status: "ok" },
              {
                label: "임차 목적물 소재지",
                value: "서울특별시 관악구 봉천로 123, 302호",
                status: "error",
                errorTag: "등본(301호)과 호수 상이",
              },
              {
                label: "보증금 / 차임(월세)",
                value: "보증금 1,000만 원 / 월세 75만 원 (환산합산 79.5만 원 ≤ 90만 원)",
                status: "ok",
              },
              {
                label: "확정일자 날인 여부",
                value: "[직인 및 확정일자 번호 미식별]",
                status: "error",
                errorTag: "확정일자 도장 누락",
              },
            ],
            stampText: "확정일자 날인 없음",
            stampStatus: "missing",
          },
          {
            docId: "doc-family",
            docTitle: "가족관계증명서",
            fileName: "가족관계증명서_일반.pdf",
            renamedFileName: "2026청년월세_김청년_03_가족관계증명서(상세).pdf",
            issuedDate: "2026. 11. 16.",
            headerTitle: "가족관계증명서 (일반)",
            fields: [
              { label: "본인 성명", value: "김청년", status: "ok" },
              {
                label: "증명서 구분",
                value: "일반증명서 (상세 아님)",
                status: "error",
                errorTag: "'상세' 증명서 필수",
              },
              { label: "주민번호 공개여부", value: "전부 공개", status: "ok" },
            ],
            stampText: "대법원 전자관인 (정상)",
            stampStatus: "valid",
          },
        ],
        findings: [
          {
            id: "find-1",
            docId: "doc-rr",
            docTitle: "주민등록등본",
            type: "single_rule",
            severity: "critical",
            title: "[옵션 누락] 등본 내 '전입일' 및 '최근 5년 주소변동' 미표시",
            detail:
              "업로드하신 등본에 전입일이 비공개로 되어 있고 과거 주소 이력이 빠져 있습니다. 18p [별표2] '1년 이상 별도 거주 특례'를 인정받으려면 최근 5년 주소변동과 전입일이 반드시 찍혀 있어야 합니다.",
            ruleReference: "공고문 22p [별표4] 제출서류 규격 제1호",
            fixAction:
              "정부24 재발급 시 [과거의 주소변동 사항: 최근 5년 포함]과 [전입일/변동일: 포함] 체크박스를 켜고 다시 PDF로 저장하세요.",
          },
          {
            id: "find-2",
            docId: "doc-lease",
            docTitle: "등본 ↔ 임대차계약서 교차검증",
            type: "cross_check",
            severity: "critical",
            title: "[교차 불일치] 등본상 호수(301호)와 계약서상 호수(302호) 불일치",
            detail:
              "주민등록등본에는 '봉천로 123, 301호'로 전입되어 있으나, 임대차계약서에는 '302호'로 기재되어 있습니다. 실제 문패 호수와 건축물대장 호수가 다른 경우 그대로 제출하면 보완 처분 대상입니다.",
            ruleReference: "공고문 22p [별표4] 주소지 교차검증 기준",
            fixAction:
              "임대인(집주인)이 서명한 '거주동·호수 확인서(공고문 별지 제6호)' 1장을 추가 첨부하거나 등본 호수를 정정해야 합니다.",
          },
          {
            id: "find-3",
            docId: "doc-lease",
            docTitle: "주택임대차계약서",
            type: "seal_verify",
            severity: "critical",
            title: "[직인 누락] 계약서 내 확정일자 날인(도장) 미식별",
            detail:
              "계약서 스캔본에서 주민센터/등기소 확정일자 날인이나 온라인 신고번호가 검출되지 않았습니다.",
            ruleReference: "공고문 22p [별표4] 제2호 임대차 증빙 요건",
            fixAction:
              "부동산거래관리시스템(rtms.molit.go.kr)에서 '주택임대차계약 신고필증'을 발급받아 계약서 뒷장에 합쳐서 제출하세요.",
          },
          {
            id: "find-4",
            docId: "doc-family",
            docTitle: "가족관계증명서",
            type: "single_rule",
            severity: "warning",
            title: "[종류 오류] '상세' 증명서가 아닌 '일반' 증명서로 발급됨",
            detail:
              "상단 표제부가 '가족관계증명서(일반)'으로 확인됩니다. 공고문 기준상 일반증명서는 인정되지 않아 재제출 대상입니다.",
            ruleReference: "공고문 23p [별표4] 제3호",
            fixAction: "대법원 전자가족관계등록시스템에서 [상세증명서] 라디오 버튼을 선택해 재발급하세요.",
          },
        ],
        crossCheckMatrix: [
          {
            checkName: "신청인 ↔ 임차인 성명 대조",
            sourceA: "등본: 김청년",
            sourceB: "계약서: 김청년",
            status: "pass",
            note: "명의 일치",
          },
          {
            checkName: "보증금·월세 환산액 상한선",
            sourceA: "보증금 1천 / 월세 75만",
            sourceB: "환산합산 79.5만 ≤ 90만",
            status: "pass",
            note: "3p 단서조항 특례 충족",
          },
          {
            checkName: "등본 현주소 ↔ 계약서 소재지",
            sourceA: "봉천로 123, 301호",
            sourceB: "봉천로 123, 302호",
            status: "fail",
            note: "호수 불일치 적발 (301호 ≠ 302호)",
          },
          {
            checkName: "임대차계약 법적 효력(확정일자)",
            sourceA: "계약서 직인 스캔",
            sourceB: "신고필증 첨부 여부",
            status: "fail",
            note: "확정일자 날인 및 신고필증 모두 누락",
          },
        ],
      },
      fixed: {
        summaryTitle: "사전 점검 항목 전부 적격 — 감지된 반려 위험 없음",
        passProbability: 99,
        documents: [
          {
            docId: "doc-rr",
            docTitle: "주민등록등본",
            fileName: "주민등록등본_김청년_보완완료.pdf",
            renamedFileName: "2026청년월세_김청년_01_주민등록등본.pdf",
            issuedDate: "2026. 11. 16.",
            headerTitle: "주민등록표 등본(최근 5년 주소포함)",
            fields: [
              { label: "세대주 성명", value: "김청년 (990512-1234567)", status: "ok" },
              {
                label: "현 주소지",
                value: "서울특별시 관악구 봉천로 123, 301호 (봉천동)",
                status: "ok",
              },
              {
                label: "전입일 / 변동일",
                value: "2025. 08. 20. (별도거주 1년 3개월 경과 확인)",
                status: "ok",
              },
              {
                label: "과거 주소변동 이력",
                value: "최근 5년 주소변동 내역 전부 포함됨",
                status: "ok",
              },
            ],
            stampText: "관악구청장 직인 (검증완료)",
            stampStatus: "valid",
          },
          {
            docId: "doc-lease",
            docTitle: "주택임대차계약서 + 신고필증",
            fileName: "임대차계약서_확정일자포함.pdf",
            renamedFileName: "2026청년월세_김청년_02_임대차계약서.pdf",
            issuedDate: "확정일자: 2025. 08. 20. (제2025-004812호)",
            headerTitle: "주택임대차표준계약서 (확정일자 필)",
            fields: [
              { label: "임차인 성명", value: "김청년", status: "ok" },
              {
                label: "임차 목적물 소재지",
                value: "서울특별시 관악구 봉천로 123, 301호 (등본과 일치)",
                status: "ok",
              },
              {
                label: "보증금 / 차임(월세)",
                value: "보증금 1,000만 원 / 월세 75만 원 (환산합산 79.5만 원 ≤ 90만 원)",
                status: "ok",
              },
              {
                label: "확정일자 날인 여부",
                value: "봉천동 주민센터 확정일자 직인 및 신고번호 확인 완료",
                status: "ok",
              },
            ],
            stampText: "확정일자 2025.08.20 날인 확인",
            stampStatus: "valid",
          },
          {
            docId: "doc-family",
            docTitle: "가족관계증명서 (상세)",
            fileName: "가족관계증명서_상세.pdf",
            renamedFileName: "2026청년월세_김청년_03_가족관계증명서(상세).pdf",
            issuedDate: "2026. 11. 16.",
            headerTitle: "가족관계증명서 (상세)",
            fields: [
              { label: "본인 성명", value: "김청년", status: "ok" },
              { label: "증명서 구분", value: "상세증명서 (적격)", status: "ok" },
              { label: "주민번호 공개여부", value: "전부 공개 (적격)", status: "ok" },
            ],
            stampText: "대법원 전자관인 (검증완료)",
            stampStatus: "valid",
          },
        ],
        findings: [
          {
            id: "pass-1",
            docId: "doc-rr",
            docTitle: "전체 제출서류 통합 검증",
            type: "cross_check",
            severity: "pass",
            title: "서류별 발급 옵션과 서류 간 교차 항목 모두 일치",
            detail:
              "등본(전입일 2025.08.20, 봉천로 123 301호) ↔ 임대차계약서(확정일자 완료, 301호, 보증금 1천/월세 75만) ↔ 가족관계증명서(상세) 간 모순이나 누락 옵션이 전혀 없습니다.",
            ruleReference: "공고문 22~24p [별표4] 전 항목 적격",
            fixAction: "신청 패키지 탭에서 자동 기입된 신청서를 확인하세요.",
          },
        ],
        crossCheckMatrix: [
          {
            checkName: "신청인 ↔ 임차인 성명 대조",
            sourceA: "등본: 김청년",
            sourceB: "계약서: 김청년",
            status: "pass",
            note: "명의 일치",
          },
          {
            checkName: "보증금·월세 환산액 상한선",
            sourceA: "보증금 1천 / 월세 75만",
            sourceB: "환산합산 79.5만 ≤ 90만",
            status: "pass",
            note: "3p 단서조항 특례 충족",
          },
          {
            checkName: "등본 현주소 ↔ 계약서 소재지",
            sourceA: "봉천로 123, 301호",
            sourceB: "봉천로 123, 301호",
            status: "pass",
            note: "도로명주소 및 동·호수 일치",
          },
          {
            checkName: "임대차계약 법적 효력(확정일자)",
            sourceA: "제2025-004812호 날인",
            sourceB: "확정일자 직인 검증",
            status: "pass",
            note: "확정일자 유효성 확인 완료",
          },
        ],
      },
    },
    applicationFormTemplate: {
      formTitle: "[별지 제1호 서식] 2026년 청년월세 한시 특별지원 신청서 및 소득·재산 신고서",
      autoFilledFields: [
        { label: "신청인 성명 / 생년월일", value: "김청년 (1999. 05. 12.)", sourceDoc: "주민등록등본" },
        {
          label: "현 거주지 도로명주소",
          value: "서울특별시 관악구 봉천로 123, 301호 (전입일: 2025.08.20)",
          sourceDoc: "등본 · 계약서 교차 확인",
        },
        {
          label: "임대차 계약 조건",
          value: "보증금 10,000,000원 / 월 차임 750,000원 (환산합산 795,833원)",
          sourceDoc: "임대차계약서 제2조",
        },
        {
          label: "임대차 계약 기간 / 확정일자",
          value: "2025. 08. 20. ~ 2027. 08. 19. (확정일자 제2025-004812호)",
          sourceDoc: "임대차계약서 확정일자",
        },
        {
          label: "적용 심사 특례 코드",
          value: "[특례 제3호] 청년 독립가구 단독산정 (원가구 소득 미반영) + [단서 제1호] 보증금 월세 환산액 합산 적용",
          sourceDoc: "자격 판정 결과",
        },
      ],
      essayTitle: "별도가구 생계유지 소명 및 지원금 활용계획서 (지자체 추가 확인란)",
      essayPrompt:
        "공고문 18p [별표2] 독립가구 특례 적용을 위한 본인 생계유지 현황 및 주거비 절감액의 구직·역량개발 활용 계획",
      forbiddenWords: ["단순 유흥비", "해외여행", "주식 투자", "코인", "부모님 용돈 지원"],
      recommendedKeywords: ["별도 세대", "근로소득", "주거비", "역량 강화"],
      generatedEssayDraft:
        "본인은 2025년 8월 20일 현 주소지(서울시 관악구 봉천로 123, 301호)로 전입한 이래 1년 이상 부모와 주민등록상 별도 세대를 구성하여 독립적으로 거주하고 있습니다. 현재 월 평균 약 130만 원의 근로소득(기준중위소득 50% 이상~60% 이하 구간)을 통해 임차료 및 생활비를 본인 소득으로 자립 부담하고 있어 공고문 [별표2] 제3호의 청년 독립가구 단독산정 특례 요건을 충족합니다.\n\n본 청년월세 특별지원을 통해 매월 절감되는 20만 원(연간 240만 원)의 주거비는 현재 준비 중인 IT·데이터 직무 취업 역량 강화(자격증 취득 및 실무 포트폴리오 고도화)와 안정적인 구직 활동 기간 확보에 전액 활용하여 조기 정규직 취업 및 경제적 자립을 달성하겠습니다.",
    },
  },
  {
    id: "kua-job-seeker-2026",
    badge: "대표 시나리오 B · 일/구직 (KDT 연계)",
    category: "일·구직 (KDT 연계)",
    title: "2026 국민취업지원제도 I유형 (구직촉진수당)",
    ministry: "고용노동부 · 대한상공회의소 KDT 연계",
    maxBenefitText: "최대 300만 원 (월 50만 원×6개월) + 취업성공수당 150만 원",
    maxBenefitAmount: 3000000,
    pageCount: 34,
    abandonRateText: "청년 특례 오해 및 취업활동계획서 반려율 38.4%",
    summary:
      "KDT 부트캠프 수료생·구직 청년이 가장 많이 신청하지만, 일반 기준(중위 60%)과 청년 특례(중위 120%)를 헷갈려 포기하거나 취업활동계획서(구직활동 인정 기준) 부실로 반려당하는 핵심 일자리 지원 사업",
    announcementExcerpts: [
      {
        id: "kua-special",
        page: "11p [별표1] 청년특례",
        section: "I유형 청년 특례 (소득·취업경험 요건 대폭 완화)",
        rawText:
          "원칙적으로 I유형(요건심사형)은 가구 기준중위소득 60% 이하 및 최근 2년 이내 100일(800시간) 이상의 취업경험을 요한다. 다만, 만 18세~34세 청년(병역의무 이행 시 최대 만 37세)은 가구 단위 기준중위소득 120% 이하(재산 합계 5억 원 이하)까지 확대 적용하며, 최근 2년 이내 취업경험이 전혀 없더라도(신규 졸업·수료생 포함) 선발한다.",
        plainTranslation:
          "본문 앞장의 '중위소득 60% 이하 & 취업경험 100일 필수'만 보고 닫지 마세요! 만 18~34세 청년은 11p [별표1] 특례에 따라 ① 가구 중위소득 120% 이하(4인가구 기준 약 월 779만 원 이하)까지 완화되며 ② 알바/취업 경험이 0일이어도 100% 신청 가능합니다!",
        isSpecialClause: true,
      },
      {
        id: "kua-kdt",
        page: "19p 훈련연계 지침",
        section: "K-디지털 트레이닝(KDT) 수료생 및 참여자 병행 기준",
        rawText:
          "KDT(K-디지털 트레이닝) 등 직업훈련 참여 중이거나 수료한 청년도 국민취업지원제도 I유형 참여가 가능하며, 훈련장려금과 구직촉진수당을 동시에 수급할 수 있다(단, 월 구직활동의무 이행 인정 기준 준수 필수).",
        plainTranslation:
          "대한상공회의소 KDT 아카데미 수강생·수료생도 구직촉진수당(월 50만 원)을 받을 수 있으며, KDT 훈련장려금과 중복 수령이 가능합니다!",
        isSpecialClause: true,
      },
    ],
    personas: [
      {
        id: "persona-kdt",
        name: "박개발 (27세 · KDT 아카데미 수료 취준생)",
        tag: "별표1 청년특례 (중위 120% & 무경력 면제)",
        description:
          "최근 2년간 취업경험이 없고 부모님과 동거 중이라 일반 요건(중위 60%)에선 탈락인 줄 알았으나, 11p 청년특례(중위 120% 이하 & 취업경험 면제)로 통과하는 케이스",
        answers: {
          q_age_kdt: "youth_kdt",
          q_work_exp: "no_exp",
          q_hh_income: "under_120",
        },
        verdictHeadline: "11p [별표1] 청년특례 적용! 취업경험 0일이어도 월 50만 원×6개월(300만 원) 100% 대상입니다",
        verdictClauseId: "kua-special",
        confidenceScore: 97,
        expectedBenefit: "구직촉진수당 3,000,000원 + 조기취업성공수당 최대 1,500,000원",
        verdictReason:
          "일반 I유형 기준(중위 60%, 취업경험 100일)이 아닌 11p [별표1] 청년특례가 적용되어, 최근 2년 취업경험 요건이 완전 면제되며 가구 소득 기준도 중위 120% 이하로 2배 완화 적용됩니다.",
      },
    ],
    questions: [
      {
        id: "q_age_kdt",
        question: "현재 연령대와 구직/훈련 상태는 어떠신가요?",
        easyHint: "KDT 아카데미 과정 참여 중이거나 수료생인 경우 구직활동 인정 특례가 적용됩니다.",
        adminTermReplaced: "구직자취업촉진법 시행령 청년 연령 및 직업훈련 연계 요건",
        options: [
          {
            value: "youth_kdt",
            label: "만 18~34세(군필 최대 37세)이며 KDT 수료생/수강생 또는 구직 중이에요",
            subLabel: "11p [별표1] 청년특례 + 19p KDT 훈련연계 동시 적용",
            ruleImpact: "special_pass",
            ruleNote: "청년특례(중위 120% 완화) 활성화",
          },
        ],
      },
      {
        id: "q_work_exp",
        question: "최근 2년 동안 고용보험에 가입된 알바·직장 경력이 100일 이상 있나요?",
        easyHint: "경력이 전혀 없어도 청년특례로 면제되니 솔직하게 골라주세요!",
        adminTermReplaced: "피보험단위기간 및 일용·단시간 근로 시간 환산 기준",
        options: [
          {
            value: "no_exp",
            label: "아니요, 취업 준비나 부트캠프만 해서 최근 2년 경력이 없거나 100일 미만이에요",
            subLabel: "일반 유형은 탈락이나, 청년특례로 '취업경험 요건 완전 면제'!",
            ruleImpact: "special_pass",
            ruleNote: "청년특례 취업경험 무관 선발 조항 적용",
          },
          {
            value: "has_exp",
            label: "네, 알바나 인턴 포함해서 100일(800시간) 이상 일한 적 있어요",
            subLabel: "요건심사형 1순위 충족",
            ruleImpact: "pass",
            ruleNote: "취업경험 요건 충족",
          },
        ],
      },
      {
        id: "q_hh_income",
        question: "등본에 함께 올라와 있는 가구원 합산 월 소득은 어느 정도인가요?",
        easyHint: "1인가구 약 287만 원, 3인가구 약 603만 원, 4인가구 약 731만 원 이하이면 통과됩니다.",
        adminTermReplaced: "가구단위 기준중위소득 120% 이하 및 재산 합계액 5억 원 이하",
        options: [
          {
            value: "under_120",
            label: "가구 합산 중위소득 120% 이하(4인가구 월 779만 원 이하 / 재산 5억 이하)예요",
            subLabel: "청년특례 소득·재산 기준 통과",
            ruleImpact: "special_pass",
            ruleNote: "중위소득 120% 청년특례 충족",
          },
        ],
      },
    ],
    allDocumentsCount: 9,
    requiredDocumentsCount: 3,
    documentRecipes: [
      {
        id: "kua-doc-1",
        title: "취업지원 신청서 및 개인정보 수집·이용·제공 동의서",
        issuer: "고용24 온라인 작성 (가구원 전자서명)",
        issuerUrl: "https://www.work24.go.kr",
        required: true,
        timeEstimate: "2분 소요",
        checkboxOptions: [
          {
            label: "등본상 동거 가구원(부모 등)의 [금융·국세·건보 정보 제공 동의] 체크 필수",
            mustCheck: true,
            reason: "가구원 동의 누락 시 소득 조회가 불가능하여 심사 보류됨",
          },
        ],
      },
      {
        id: "kua-doc-2",
        title: "가족관계증명서 (상세) 및 주민등록등본",
        issuer: "정부24 / 대법원",
        issuerUrl: "https://www.gov.kr",
        required: true,
        timeEstimate: "1분 소요",
        checkboxOptions: [
          {
            label: "가족관계증명서 [상세] 및 주민번호 뒷자리 [전부 공개] 선택",
            mustCheck: true,
            reason: "가구원 범위 확정을 위한 필수 옵션",
          },
        ],
      },
      {
        id: "kua-doc-3",
        title: "KDT 훈련 수료증 (또는 수강확인서) 및 구직활동계획서",
        issuer: "대한상공회의소 KDT / 고용24",
        issuerUrl: "https://www.work24.go.kr",
        required: true,
        timeEstimate: "에이전트 자동 작성",
        checkboxOptions: [
          {
            label: "월 2회 이상 구체적 구직활동(입사지원, 직무훈련, 면접 등) 명시 필수",
            mustCheck: true,
            reason: "'자습', '독서실 공부' 등 추상적 표현 기재 시 상담사 반려 대상",
          },
        ],
      },
    ],
    auditScenarios: {
      defect: {
        summaryTitle: "가구원 정보제공동의 누락 및 구직활동계획서 부적격 표현 감지",
        passProbability: 20,
        documents: [
          {
            docId: "kua-doc-1",
            docTitle: "가구원 정보제공 동의서",
            fileName: "가구원동의서_박개발.pdf",
            renamedFileName: "2026국취제_박개발_01_가구원동의서.pdf",
            issuedDate: "2026. 11. 16.",
            headerTitle: "개인정보 및 금융정보 제공 동의서",
            fields: [
              { label: "신청인 본인 서명", value: "박개발 (서명 완료)", status: "ok" },
              {
                label: "등본상 가구원(부·모) 서명",
                value: "박아버지 서명 완료 / 김어머니 [서명 누락]",
                status: "error",
                errorTag: "가구원 1인 서명 누락",
              },
            ],
            stampText: "서명 누락 검출",
            stampStatus: "missing",
          },
        ],
        findings: [
          {
            id: "kua-find-1",
            docId: "kua-doc-1",
            docTitle: "가구원 정보제공 동의서",
            type: "cross_check",
            severity: "critical",
            title: "[교차 불일치] 등본상 가구원(3명) 중 '모(김어머니)' 정보제공 동의 서명 누락",
            detail:
              "주민등록등본에는 신청인 외 부·모 총 3인이 등재되어 있으나, 동의서에는 모(김어머니)의 서명란이 비어 있습니다. 가구원 전원 동의 없이는 중위소득 120% 전산 조회가 중단됩니다.",
            ruleReference: "공고문 16p 가구원 산정 및 동의 규정",
            fixAction: "고용24 모바일 간편인증 링크를 어머니 카카오톡으로 전송하여 전자서명을 완료하세요.",
          },
        ],
        crossCheckMatrix: [
          {
            checkName: "등본 가구원 수 ↔ 동의서 서명인 수",
            sourceA: "등본 등재: 3명 (본인·부·모)",
            sourceB: "동의 서명: 2명 (모 누락)",
            status: "fail",
            note: "가구원 1인 동의 누락 적발",
          },
        ],
      },
      fixed: {
        summaryTitle: "가구원 전원 동의 및 취업활동계획서 심사 기준 100% 통과",
        passProbability: 99,
        documents: [
          {
            docId: "kua-doc-1",
            docTitle: "가구원 정보제공 동의서 (보완완료)",
            fileName: "가구원동의서_전원완료.pdf",
            renamedFileName: "2026국취제_박개발_01_가구원동의서.pdf",
            issuedDate: "2026. 11. 16.",
            headerTitle: "개인정보 및 금융정보 제공 동의서 (전원 완료)",
            fields: [
              { label: "신청인 본인 서명", value: "박개발 (서명 완료)", status: "ok" },
              {
                label: "등본상 가구원(부·모) 서명",
                value: "박아버지 · 김어머니 전원 전자서명 확인 완료",
                status: "ok",
              },
            ],
            stampText: "전원 동의 검증완료",
            stampStatus: "valid",
          },
        ],
        findings: [
          {
            id: "kua-pass-1",
            docId: "kua-doc-1",
            docTitle: "전체 제출서류 통합 검증",
            type: "cross_check",
            severity: "pass",
            title: "등본 가구원(3명) 전원 동의 및 청년특례(중위 120%) 서류 검증 완료",
            detail: "모든 필수 서류와 가구원 전자서명이 완벽히 일치합니다.",
            ruleReference: "공고문 16p 전 항목 적격",
            fixAction: "Step 4에서 KDT 연계 취업활동계획서 초안을 다운로드하세요.",
          },
        ],
        crossCheckMatrix: [
          {
            checkName: "등본 가구원 수 ↔ 동의서 서명인 수",
            sourceA: "등본 등재: 3명",
            sourceB: "동의 서명: 3명 완료",
            status: "pass",
            note: "가구원 100% 일치",
          },
        ],
      },
    },
    applicationFormTemplate: {
      formTitle: "[별지 제1호/제3호] 국민취업지원제도 취업지원신청서 및 취업활동계획서(IAP)",
      autoFilledFields: [
        { label: "신청인 성명 / 유형", value: "박개발 / I유형 요건심사형 (청년특례)", sourceDoc: "신분증 및 등본 OCR" },
        { label: "취업경험 및 소득특례", value: "만 18~34세 청년특례 (중위소득 120% 이하 / 취업경험 면제)", sourceDoc: "11p [별표1] 매핑" },
        { label: "연계 직업훈련 과정", value: "대한상공회의소 KDT AI 에이전트 실무 과정 수료", sourceDoc: "훈련수료증 OCR" },
      ],
      essayTitle: "구직촉진수당 수급을 위한 월별 취업활동계획서 (IAP 초안)",
      essayPrompt: "고용센터 상담사 승인 기준(구체적 직무 목표 + 월 2회 이상 정량적 구직활동)에 맞춘 활동계획",
      forbiddenWords: ["단순 개인 공부", "토익 학원 수강만 기재", "미정", "천천히 준비"],
      recommendedKeywords: [
        "AI/백엔드 개발 직무",
        "KDT 프로젝트 포트폴리오 고도화",
        "월 4회 이상 채용공고 입사지원",
        "고용센터 모의면접 및 직무클리닉 참여",
      ],
      generatedEssayDraft:
        "[희망 직무 및 목표]\n대한상공회의소 KDT 과정을 통해 습득한 AI 에이전트 및 풀스택 웹 개발 역량을 바탕으로, 6개월 이내 IT 서비스 기업 백엔드/AI 응용 개발자로 정규직 취업하는 것을 목표로 합니다.\n\n[회차별 구체적 구직활동 계획 (월 2회 이상 의무 이행 기준 충족)]\n- 1~2회차: KDT 최종 프로젝트 코드 리팩토링 및 이력서·기술 포트폴리오 완성, 고용센터 전담 상담사 이력서 클리닉 1회 + 직무 적성 진단 1회 수료\n- 3~4회차: 워크넷·원티드 등 채용 플랫폼을 통한 AI/웹 개발 직무 월 4건 이상 입사지원 및 AI 역량검사·코딩테스트 응시 증빙 제출\n- 5~6회차: 실전 기술면접 대비 모의면접 프로그램 참여 및 채용박람회(대한민국 청년 커리어 페어 등) 현장 면접 참가를 통한 최종 취업 달성",
    },
  },
];
