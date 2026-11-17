// 2026년 기준 중위소득 (보건복지부 고시, 원/월).
// 자격 판정에 쓰이는 값이므로 발표 전 고시 원문과 한 번 더 대조할 것.
export const MEDIAN_INCOME_2026: Record<number, number> = {
  1: 2564238,
  2: 4199292,
  3: 5359036,
  4: 6494738,
  5: 7556719,
  6: 8555952,
};

// 2026년 건강보험료율 7.19% 중 직장가입자 본인부담분
export const NHIS_EMPLOYEE_RATE_2026 = 0.03595;

// 시연용 공고문 제2조 단서의 보증금 월세 환산율과 상한
export const DEPOSIT_CONVERSION_RATE = 0.055;
export const DEPOSIT_LIMIT_KRW = 50_000_000;
export const RENT_LIMIT_KRW = 700_000;
export const CONVERTED_RENT_LIMIT_KRW = 900_000;

export function medianRatioPercent(monthlyIncomeKRW: number, householdSize = 1) {
  const size = Math.min(Math.max(Math.round(householdSize) || 1, 1), 6);
  return Number(((monthlyIncomeKRW / MEDIAN_INCOME_2026[size]) * 100).toFixed(1));
}

export function estimateNhisFee(monthlyIncomeKRW: number) {
  return Math.round(monthlyIncomeKRW * NHIS_EMPLOYEE_RATE_2026);
}

export function convertRent(depositKRW: number, rentKRW: number) {
  const convertedDeposit = Math.round((depositKRW * DEPOSIT_CONVERSION_RATE) / 12);
  const total = convertedDeposit + rentKRW;
  const eligible =
    depositKRW <= DEPOSIT_LIMIT_KRW &&
    (rentKRW <= RENT_LIMIT_KRW || total <= CONVERTED_RENT_LIMIT_KRW);
  return { convertedDeposit, total, eligible };
}

// 독립가구 단독산정 특례: 만 30세 이상, 또는 1년 이상 별도 거주 + 본인 소득 중위 50% 이상
export function judgeEligibility(p: {
  age: number;
  monthlyIncomeKRW: number;
  separateLivingMonths: number;
  depositKRW: number;
  rentKRW: number;
}) {
  const ratio = medianRatioPercent(p.monthlyIncomeKRW);
  const rent = convertRent(p.depositKRW, p.rentKRW);
  // 판정은 반올림 전 실제 금액으로 한다 (표시용 ratio는 소수 첫째 자리로 반올림됨)
  const median = MEDIAN_INCOME_2026[1];
  const selfIncomeOk = p.monthlyIncomeKRW <= median * 0.6;
  const independent = p.age >= 30 || (p.separateLivingMonths >= 12 && p.monthlyIncomeKRW >= median * 0.5);
  return {
    ratio,
    rent,
    selfIncomeOk,
    independent,
    // 특례가 아니면 원가구 소득 확인이 남으므로 '확정'이 아니라 '추가 확인 필요'
    verdict: !selfIncomeOk || !rent.eligible
      ? ("ineligible" as const)
      : independent
      ? ("eligible" as const)
      : ("needs_parent_check" as const),
  };
}
