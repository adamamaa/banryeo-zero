// 자격 확인: 공고에서 확인한 조건과 사용자 정보를 서버가 그대로 대조한다.
// 기준 숫자는 코드에 두지 않는다. 공식 원문이나 검색·첨부 공고에서 확인된 조건만 판정에 쓴다.
import { medianRatioPercent } from "./standards";
import { amountsIn, pickOfficial, type OfficialRecord } from "./officialFacts";

export type ConditionField = "age" | "income" | "medianRatio" | "sepMonths" | "deposit" | "rent" | "assets" | "houses";

export interface PolicyCondition {
  field: ConditionField;
  min?: number;
  max?: number;
  label: string;
  // 본인이 아니라 가구 전체 소득을 보는 조건
  household?: boolean;
  // 공고가 근로·사업소득을 일부 공제해 소득을 계산하면 그 공제율(%) (예: 소득평가액 30%)
  deductPercent?: number;
  // 특례처럼 "또는"으로 갈리는 경로 이름. 같은 이름끼리는 모두 충족해야 하고, 경로 중 하나만 충족하면 된다
  group?: string;
}

export interface MyValues {
  age?: number;
  incomeManwon?: number;
  depositManwon?: number;
  rentManwon?: number;
  sepMonths?: number;
  householdIncomeManwon?: number;
  householdSize?: number;
  // 재산 합계(만 원)와 본인 명의 주택 수
  assetsManwon?: number;
  housesOwned?: number;
}

export interface EligibilityCheck {
  label: string;
  mine: string;
  status: "pass" | "fail" | "unknown";
  basis: string;
  group?: string;
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
  // 무주택 조건은 숫자 없이 "무주택"으로만 적혀 있다
  if (c.field === "houses") return c.max === 0 && /무주택/.test(text);
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
  assets: "재산 합계",
  houses: "본인 명의 주택 보유 여부",
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
  // 조건마다 모르는 값이 있으면 물어볼 항목 (경로별로 거를 수 있게 따로 둔다)
  const asks: { group?: string; what: string }[] = [];
  const rejectedGroups = new Set<string>();
  const percents: number[] = [];

  for (const c of conditions) {
    const fromOfficial = Boolean(official && inOfficial(c, official));
    if (!fromOfficial && !otherEvidence) {
      rejected.push(c.label);
      // 근거 없는 조건이 빠진 경로는 충족으로 볼 수 없다
      if (c.group) rejectedGroups.add(c.group);
      continue;
    }
    let mine: number | undefined;
    let shown = "";
    // 가구원 수를 몰라도 어떤 가구원 수든 결론이 같으면 바로 판정한다
    let anySize: EligibilityCheck["status"] | undefined;
    if (c.field === "age") {
      mine = v.age;
      shown = mine === undefined ? "" : `만 ${mine}세`;
    } else if (c.field === "income" || c.field === "medianRatio") {
      const gross = c.household ? v.householdIncomeManwon : v.incomeManwon;
      const deduct = Math.min(Math.max(c.deductPercent || 0, 0), 50);
      const income = gross === undefined ? undefined : Math.round(gross * (100 - deduct)) / 100;
      // 공제를 적용했으면 원래 금액과 공제 후 금액을 함께 보여 준다
      const amount = gross === undefined ? "" : deduct ? `월 ${man(gross)} → ${deduct}% 공제 후 ${man(income!)}` : `월 ${man(gross)}`;
      if (c.field === "income") {
        mine = income;
        shown = amount;
      } else {
        // 본인 소득 조건은 1인 가구 기준, 가구 소득 조건은 알려 준 가구원 수 기준
        const size = c.household ? v.householdSize : 1;
        if (income !== undefined && size !== undefined) {
          const ratio = medianRatioPercent(income * 10000, size);
          mine = ratio;
          percents.push(ratio);
          if (deduct) percents.push(medianRatioPercent(gross! * 10000, size));
          shown = `${amount}, ${size}인 가구 기준 ${ratio}%`;
        } else if (income !== undefined) {
          // 가구원 수가 많을수록 비율이 낮아진다: 가장 큰 가구(6인)로도 넘으면 미충족, 1인으로도 안 넘으면 충족
          const low = medianRatioPercent(income * 10000, 6);
          const high = medianRatioPercent(income * 10000, 1);
          if ((c.max !== undefined && low > c.max) || (c.min !== undefined && high < c.min)) {
            anySize = "fail";
            shown = `${amount}, 가구원 수와 관계없이 미충족 (${low}~${high}%)`;
          } else if ((c.max === undefined || high <= c.max) && (c.min === undefined || low >= c.min)) {
            anySize = "pass";
            shown = `${amount}, 가구원 수와 관계없이 충족 (${low}~${high}%)`;
          }
          if (anySize) percents.push(low, high);
        }
        percents.push(...[c.min, c.max].filter((x): x is number => x !== undefined));
      }
    } else if (c.field === "sepMonths") {
      mine = v.sepMonths;
      shown = mine === undefined ? "" : `${mine}개월`;
    } else if (c.field === "houses") {
      mine = v.housesOwned;
      shown = mine === undefined ? "" : mine ? `주택 ${mine}채 보유` : "무주택";
    } else {
      mine = c.field === "deposit" ? v.depositManwon : c.field === "rent" ? v.rentManwon : v.assetsManwon;
      shown = mine === undefined ? "" : man(mine);
    }
    const status: EligibilityCheck["status"] =
      anySize ??
      (mine === undefined
        ? "unknown"
        : (c.min === undefined || mine >= c.min) && (c.max === undefined || mine <= c.max)
        ? "pass"
        : "fail");
    // 재산·주택은 사용자가 말했을 때만 판정하고, 모르면 되묻지 않고 직접 확인할 조건으로 남긴다
    if (status === "unknown" && c.field !== "assets" && c.field !== "houses") {
      const income = c.household ? v.householdIncomeManwon : v.incomeManwon;
      const what = !c.household
        ? MISSING[c.field]
        : c.field === "income"
        ? "가구 월 소득"
        : income === undefined
        ? "가구 월 소득과 가구원 수"
        : "가구원 수";
      asks.push({ group: c.group, what });
    }
    checks.push({
      label: c.group ? `[${c.group}] ${c.label}` : c.label,
      mine: shown || "정보 없음",
      status,
      basis: fromOfficial ? `${official!.source} 원문` : otherEvidenceLabel,
      group: c.group,
    });
  }

  if (!checks.length && !others.length) return { rejected, missing: [], summary: undefined };
  // 그룹이 없는 조건은 모두 충족해야 하고, 그룹(경로)이 있으면 그중 하나만 모두 충족하면 된다
  const common = checks.filter((c) => !c.group);
  const groups = Array.from(new Set([...checks.filter((c) => c.group).map((c) => c.group as string), ...Array.from(rejectedGroups)]));
  const groupStatus = (g: string) => {
    const list = checks.filter((c) => c.group === g);
    if (list.some((c) => c.status === "fail")) return "fail";
    return !rejectedGroups.has(g) && list.every((c) => c.status === "pass") ? "pass" : "unknown";
  };
  const statuses = groups.map(groupStatus);
  const failed =
    common.some((c) => c.status === "fail") || (groups.length > 0 && statuses.every((s) => s === "fail"));
  const pathPassed = groups.length === 0 || statuses.includes("pass");
  const verdict: EligibilitySummary["verdict"] = failed
    ? "ineligible"
    : common.every((c) => c.status === "pass") && pathPassed && !others.length
    ? "eligible"
    : "needs_check";
  // 물어볼 것: 공통 조건 + (통과한 경로가 없을 때) 아직 미충족이 아닌 경로의 조건
  const missing = failed
    ? []
    : Array.from(
        new Set(
          asks
            .filter((a) => !a.group || (!pathPassed && groupStatus(a.group) !== "fail"))
            .map((a) => a.what)
        )
      );
  const summary: EligibilitySummary = {
    policyName,
    verdict,
    checks,
    others,
    basis: official ? `${official.source} ${official.updated} 수정 원문 기준` : `${otherEvidenceLabel}에서 확인한 조건 기준`,
    percents,
  };
  // 이미 미충족이면 더 물을 필요가 없다 (어떤 답이 와도 결론이 같다)
  return { rejected, missing, summary };
}
