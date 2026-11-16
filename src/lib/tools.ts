import { POLICY_SCENARIOS } from "@/data/policies";
import {
  MEDIAN_INCOME_2026,
  CONVERTED_RENT_LIMIT_KRW,
  estimateNhisFee,
  judgeEligibility,
} from "./standards";

// 각 도구 결과가 어디서 왔는지 화면에 그대로 표시한다.
// calc: 입력값으로 실제 계산 · sample: 시연용 예시 데이터 · live: 외부 API 실시간 응답
export type ToolSource = "calc" | "sample" | "live";

export interface ToolExecution {
  step: number;
  toolName: string;
  title: string;
  basis: string;
  url?: string;
  source: ToolSource;
  input: Record<string, string>;
  output: Record<string, string>;
  status: "done" | "warn";
}

export interface ToolChainParams {
  age: number;
  region: string;
  monthlyIncomeManwon: number;
  depositManwon: number;
  monthlyRentManwon: number;
  separateLivingMonths: number;
  auditMode: "defect" | "fixed";
  essayText: string;
  publicDataApiKey?: string;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const policy = POLICY_SCENARIOS[0];

export async function fetchGov24Services(key: string): Promise<string[]> {
  try {
    const url = new URL("https://api.odcloud.kr/api/gov24/v3/serviceList");
    url.searchParams.set("page", "1");
    url.searchParams.set("perPage", "5");
    url.searchParams.set("cond[서비스명::LIKE]", "청년월세");
    const res = await fetch(url, { headers: { Authorization: `Infuser ${key}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data || [])
      .map((d: Record<string, string>) => d["서비스명"])
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function runToolChain(p: ToolChainParams) {
  const incomeKRW = p.monthlyIncomeManwon * 10000;
  const judge = judgeEligibility({
    age: p.age,
    monthlyIncomeKRW: incomeKRW,
    separateLivingMonths: p.separateLivingMonths,
    depositKRW: p.depositManwon * 10000,
    rentKRW: p.monthlyRentManwon * 10000,
  });
  const median1 = MEDIAN_INCOME_2026[1];
  const liveServices = p.publicDataApiKey ? await fetchGov24Services(p.publicDataApiKey) : [];
  const audit = policy.auditScenarios[p.auditMode];
  const risks = audit.findings.filter((f) => f.severity !== "pass").length;
  const form = policy.applicationFormTemplate;
  const forbiddenHit = form.forbiddenWords.filter((w) => p.essayText.includes(w));
  const keywordHit = form.recommendedKeywords.filter((w) => p.essayText.includes(w));

  const tools: ToolExecution[] = [
    {
      step: 1,
      toolName: "subsidy_match",
      title: "신청 가능 지원사업 조회",
      basis: "행정안전부 보조금24",
      url: "https://www.gov.kr/portal/rcvfvrSvc/main",
      source: liveServices.length ? "live" : "sample",
      input: { 만나이: `${p.age}세`, 거주지: p.region, 월소득: `${p.monthlyIncomeManwon}만 원` },
      output: liveServices.length
        ? Object.fromEntries(liveServices.map((s, i) => [`조회결과 ${i + 1}`, s]))
        : {
            대상사업: `${policy.title} (${policy.maxBenefitText})`,
            안내: "공공데이터포털 키를 넣으면 보조금24 API 실시간 조회로 바뀝니다.",
          },
      status: "done",
    },
    {
      step: 2,
      toolName: "policy_clause_lookup",
      title: "공고문 특례 조항 추출",
      basis: `시연용 공고문 (${policy.pageCount}p)`,
      source: "sample",
      input: { 공고문: policy.title, 별도거주: `${p.separateLivingMonths}개월` },
      output: Object.fromEntries(
        policy.announcementExcerpts
          .filter((c) => c.isSpecialClause)
          .map((c) => [c.page, c.section])
      ),
      status: "done",
    },
    {
      step: 3,
      toolName: "median_income_calc",
      title: "기준 중위소득 비율 계산",
      basis: "2026년 기준 중위소득 · 건강보험료율 7.19%",
      source: "calc",
      input: { 월소득: won(incomeKRW), 가구원수: "1인" },
      output: {
        "1인가구 기준 중위소득": won(median1),
        "본인 소득 비율": `${judge.ratio}%`,
        "추정 건강보험료(본인부담)": `월 ${won(estimateNhisFee(incomeKRW))}`,
        "독립가구 특례": judge.independent
          ? "해당 (1년 이상 별도 거주 + 중위 50% 이상, 또는 만 30세 이상)"
          : "미해당 (원가구 소득 합산 심사)",
        "본인가구 소득 요건(60% 이하)": judge.selfIncomeOk ? "충족" : "초과",
      },
      status: judge.selfIncomeOk ? "done" : "warn",
    },
    {
      step: 4,
      toolName: "building_ledger_check",
      title: "건축물대장 주택 용도 확인",
      basis: "국토교통부 건축물대장",
      url: "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=15000000098",
      source: "sample",
      input: { 소재지: p.region },
      output: {
        주용도: "공동주택 (다세대주택)",
        전용면적: "24.8㎡",
        위반건축물: "해당 없음",
        등재호수: "제3층 제301호",
      },
      status: "done",
    },
    {
      step: 5,
      toolName: "rent_conversion_calc",
      title: "보증금 월세 환산액 계산",
      basis: "공고문 3p 제2조 단서 (환산율 연 5.5%)",
      source: "calc",
      input: { 보증금: `${p.depositManwon.toLocaleString("ko-KR")}만 원`, 월세: `${p.monthlyRentManwon}만 원` },
      output: {
        "보증금 환산액": `월 ${won(judge.rent.convertedDeposit)}`,
        "환산 합산 월세": `월 ${won(judge.rent.total)}`,
        "상한(90만 원) 판정": judge.rent.eligible ? "이하 · 적격" : "초과 · 부적격",
      },
      status: judge.rent.eligible ? "done" : "warn",
    },
    {
      step: 6,
      toolName: "doc_recipe",
      title: "필수 서류 선별 및 발급 옵션 매핑",
      basis: "공고문 22p [별표4]",
      source: "sample",
      input: { "공고문 전체 서류": `${policy.allDocumentsCount}종` },
      output: Object.fromEntries(
        policy.documentRecipes
          .filter((d) => d.required)
          .map((d) => [d.title, d.checkboxOptions.map((c) => c.label).join(" / ")])
      ),
      status: "done",
    },
    {
      step: 7,
      toolName: "mask_pii",
      title: "개인정보 마스킹",
      basis: "서버 내 정규식 처리",
      source: "calc",
      input: { 대상: "주민등록번호 뒷자리 · 휴대전화 · 계좌번호" },
      output: {
        "텍스트 서류": "마스킹 후에만 외부 모델로 전송",
        "이미지·PDF 서류": "원본이 Gemini로 전송됨 (판독 결과만 마스킹)",
        서버저장: "저장하지 않음 (요청 처리 후 폐기)",
      },
      status: "done",
    },
    {
      step: 8,
      toolName: "cross_check_documents",
      title: "서류 간 교차 검증",
      basis: p.auditMode === "defect" ? "시연 세트 A (미비 서류)" : "시연 세트 B (보완 서류)",
      source: "sample",
      input: { 서류: audit.documents.map((d) => d.docTitle).join(", ") },
      output: {
        ...Object.fromEntries(
          audit.crossCheckMatrix.map((m) => [m.checkName, `${m.status === "pass" ? "일치" : "불일치"} · ${m.note}`])
        ),
        "반려 위험": `${risks}건`,
      },
      status: risks ? "warn" : "done",
    },
    {
      step: 9,
      toolName: "form_packager",
      title: "신청서 기입 및 계획서 점검",
      basis: "공고문 심사 기준 (금칙어 · 권장 키워드)",
      source: "calc",
      input: { "계획서 분량": `${p.essayText.length}자` },
      output: {
        금칙어: forbiddenHit.length ? forbiddenHit.join(", ") : "없음",
        "권장 키워드 포함": `${keywordHit.length} / ${form.recommendedKeywords.length}`,
        "자동 기입 항목": `${form.autoFilledFields.length}개`,
      },
      status: forbiddenHit.length ? "warn" : "done",
    },
  ];

  return {
    tools,
    summary: {
      medianRatioPercent: judge.ratio,
      totalConvertedRentKRW: judge.rent.total,
      convertedDepositKRW: judge.rent.convertedDeposit,
      verdict: judge.verdict,
      independent: judge.independent,
    },
  };
}
