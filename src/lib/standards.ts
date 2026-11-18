// 2026년 기준 중위소득 (보건복지부 고시, 원/월).
// 자격 확인에 쓰이는 값이므로 고시가 바뀌면 여기만 고친다.
export const MEDIAN_INCOME_2026: Record<number, number> = {
  1: 2564238,
  2: 4199292,
  3: 5359036,
  4: 6494738,
  5: 7556719,
  6: 8555952,
};

export function medianRatioPercent(monthlyIncomeKRW: number, householdSize = 1) {
  const size = Math.min(Math.max(Math.round(householdSize) || 1, 1), 6);
  return Number(((monthlyIncomeKRW / MEDIAN_INCOME_2026[size]) * 100).toFixed(1));
}
