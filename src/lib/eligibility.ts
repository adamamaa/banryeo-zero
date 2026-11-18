// 자격 확인: 공고에서 확인한 조건과 사용자 정보를 서버가 그대로 대조한다.
// 기준 숫자는 코드에 두지 않는다. 공식 원문이나 검색·첨부 공고에서 확인된 조건만 판정에 쓴다.
import { medianRatioPercent } from "./standards";
import { amountsIn, pickOfficial, type OfficialRecord } from "./officialFacts";

export type ConditionField = "age" | "income" | "medianRatio" | "sepMonths" | "deposit" | "rent";

export interface PolicyCondition {
  field: ConditionField;
  min?: number;
  max?: number;
  label: string;
  // 본인이 아니라 가구 전체 소득을 보는 조건
  household?: boolean;
}

export interface MyValues {
  age?: number;
  incomeManwon?: number;
  depositManwon?: number;
  rentManwon?: number;
  sepMonths?: number;
  householdIncomeManwon?: number;
  householdSize?: number;
}

export interface EligibilityCheck {
  label: string;
  mine: string;
  status: "pass" | "fail" | "unknown";
  basis: string;
}

export interface EligibilitySummary {
  policyName: string;
  // eligible: 확인한 조건 모두 충족 · needs_check: 확인이 더 필요 · ineligible: 미충족 조건 있음
  verdict: "eligible" | "needs_check" | "ineligible";
  checks: EligibilityCheck[];
  others: string[];
  basis: string;
  // 답변 검증에서 인정할 중위소득 비율 (내 비율과 공고 기준)
  percents: number[];
}

const man = (v: number) => `${v.toLocaleString("ko-KR")}만 원`;

// "8,000만원", "5천만 원", "1억 3천만원"을 만 원 단위로
function manwonIn(text: string) {
  const found = amountsIn(text).flatMap((a) => (a.low === undefined ? [a.high] : [a.low, a.high])).map((w) => w / 10000);
  for (const m of Array.from(text.matchAll(/(?:(\d+)\s*억\s*)?(?:(\d+)\s*천\s*만\s*)?원/g))) {
    if (m[1] || m[2]) found.push(Number(m[1] || 0) * 10000 + Number(m[2] || 0) * 1000);
  }
  return found;
}

function numbersBefore(text: string, unit: string) {
  const out: number[] = [];
  for (const m of Array.from(text.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*[~∼～\\-–]\\s*(\\d+(?:\\.\\d+)?))?\\s*(?:${unit})`, "g")))) {
    out.push(Number(m[1]));
    if (m[2]) out.push(Number(m[2]));
  }
  return out;
}

// 조건의 숫자가 공식 원문에 실제로 있는지
function inOfficial(c: PolicyCondition, rec: OfficialRecord) {
  const text = `${rec.benefit} ${rec.target}`;
  const values = [c.min, c.max].filter((v): v is number => v !== undefined);
  const pool =
    c.field === "age"
      ? numbersBefore(text, "세")
      : c.field === "medianRatio"
      ? numbersBefore(text, "%")
      : c.field === "sepMonths"
      ? [...numbersBefore(text, "개월"), ...numbersBefore(text, "년").map((y) => y * 12)]
      : manwonIn(text);
  return values.length > 0 && values.every((v) => pool.some((p) => Math.abs(p - v) < 0.01));
}

const MISSING: Record<ConditionField, string> = {
  age: "만 나이",
  income: "본인 월 소득",
  medianRatio: "월 소득",
  sepMonths: "부모님과 따로 산 기간",
  deposit: "보증금",
  rent: "월세",
};

export function judgeConditions(input: {
  policyName: string;
  conditions: PolicyCondition[];
  others: string[];
  values: MyValues;
  records: OfficialRecord[];
  // 웹 검색이나 첨부 공고문으로 조건을 확인했는지
  otherEvidence: boolean;
  otherEvidenceLabel: string;
}) {
  const { policyName, conditions, others, values: v, records, otherEvidence, otherEvidenceLabel } = input;
  const official = pickOfficial(records)[0];
  const checks: EligibilityCheck[] = [];
  const rejected: string[] = [];
  const missing: string[] = [];
  const percents: number[] = [];

  for (const c of conditions) {
    const fromOfficial = Boolean(official && inOfficial(c, official));
    if (!fromOfficial && !otherEvidence) {
      rejected.push(c.label);
      continue;
    }
    let mine: number | undefined;
    let shown = "";
    if (c.field === "age") {
      mine = v.age;
      shown = mine === undefined ? "" : `만 ${mine}세`;
    } else if (c.field === "income") {
      mine = c.household ? v.householdIncomeManwon : v.incomeManwon;
      shown = mine === undefined ? "" : `월 ${man(mine)}`;
    } else if (c.field === "medianRatio") {
      const income = c.household ? v.householdIncomeManwon : v.incomeManwon;
      const size = c.household ? v.householdSize : v.householdSize ?? 1;
      if (income !== undefined && size !== undefined) {
        const ratio = medianRatioPercent(income * 10000, size);
        mine = ratio;
        percents.push(ratio);
        shown = `${size}인 가구 기준 ${ratio}%`;
      }
      percents.push(...[c.min, c.max].filter((x): x is number => x !== undefined));
    } else if (c.field === "sepMonths") {
      mine = v.sepMonths;
      shown = mine === undefined ? "" : `${mine}개월`;
    } else {
      mine = c.field === "deposit" ? v.depositManwon : v.rentManwon;
      shown = mine === undefined ? "" : man(mine);
    }
    const status: EligibilityCheck["status"] =
      mine === undefined
        ? "unknown"
        : (c.min === undefined || mine >= c.min) && (c.max === undefined || mine <= c.max)
        ? "pass"
        : "fail";
    if (status === "unknown") {
      missing.push(c.household ? "가구 월 소득과 가구원 수" : MISSING[c.field]);
    }
    checks.push({
      label: c.label,
      mine: shown || "정보 없음",
      status,
      basis: fromOfficial ? `${official!.source} 원문` : otherEvidenceLabel,
    });
  }

  if (!checks.length && !others.length) return { rejected, missing, summary: undefined };
  const verdict: EligibilitySummary["verdict"] = checks.some((c) => c.status === "fail")
    ? "ineligible"
    : checks.length && checks.every((c) => c.status === "pass") && !others.length
    ? "eligible"
    : "needs_check";
  const summary: EligibilitySummary = {
    policyName,
    verdict,
    checks,
    others,
    basis: official ? `${official.source} ${official.updated} 수정 원문 기준` : `${otherEvidenceLabel}에서 확인한 조건 기준`,
    percents,
  };
  return { rejected, missing: Array.from(new Set(missing)), summary };
}
