import { MEDIAN_INCOME_2026 } from "./standards";

// 한 끗 차이 진단: 공고의 숫자 조건에서 "무엇이 얼마나 바뀌면 결과가 달라지는지"를 역산한다.
// fix: 탈락·추가 심사를 벗어나는 방법 / risk: 조금만 바뀌어도 결과가 나빠지는 지점 / margin: 여유

export interface NearMissInput {
  age: number;
  incomeManwon: number;
  depositManwon: number;
  rentManwon: number;
  sepMonths: number;
}

export interface NearMissItem {
  kind: "fix" | "risk" | "margin";
  area: string;
  title: string;
  detail: string;
}

const won = (n: number) => `${Math.max(0, Math.round(n)).toLocaleString("ko-KR")}원`;
const RISK_INCOME = 100_000; // 소득이 이만큼 안쪽이면 '아슬아슬'

const monthLabel = (monthsFromNow: number, today: Date) => {
  const d = new Date(today.getFullYear(), today.getMonth() + monthsFromNow, 1);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
};

// 어떤 정책이든 숫자 조건(limits)과 내 정보를 비교해 여유·아슬아슬·미충족을 알려 준다
export type GenericKind = NearMissItem["kind"] | "fail";
export interface GenericNearMissItem {
  kind: GenericKind;
  area: string;
  title: string;
  detail: string;
}
type LimitLike = { field: "age" | "income" | "medianRatio" | "sepMonths" | "deposit" | "rent"; min?: number; max?: number; label: string };

export function limitNearMiss(
  limits: LimitLike[],
  p: Partial<Record<keyof NearMissInput, number | null>>,
  today = new Date()
): { items: GenericNearMissItem[]; missing: number } {
  const median = MEDIAN_INCOME_2026[1];
  const AREA = { age: "나이", income: "소득", medianRatio: "소득", sepMonths: "독립", deposit: "보증금", rent: "월세" } as const;
  const items: GenericNearMissItem[] = [];
  let missing = 0;
  for (const l of limits) {
    const raw =
      l.field === "age" ? p.age
      : l.field === "income" || l.field === "medianRatio" ? p.incomeManwon
      : l.field === "sepMonths" ? p.sepMonths
      : l.field === "deposit" ? p.depositManwon
      : p.rentManwon;
    if (raw === null || raw === undefined || !Number.isFinite(raw)) {
      missing++;
      continue;
    }
    const area = AREA[l.field];
    const detail = `조건: ${l.label}`;
    const incomeWon = (p.incomeManwon || 0) * 10000;
    // 소득 조건은 원 단위로 비교한다 (medianRatio는 1인 가구 기준 중위소득으로 환산)
    const toWon = (v: number) => (l.field === "medianRatio" ? (v / 100) * median : v * 10000);
    const isMoney = l.field === "income" || l.field === "medianRatio";
    const v = isMoney ? incomeWon : raw;

    if (l.max !== undefined) {
      const max = isMoney ? toWon(l.max) : l.max;
      if (v > max) {
        const over = v - max;
        items.push(
          isMoney ? { kind: "fix", area, title: `월 소득이 ${won(over)} 줄면 충족`, detail }
          : l.field === "age" ? { kind: "fail", area, title: `만 ${l.max}세까지만 대상 (지금 만 ${raw}세)`, detail }
          : l.field === "sepMonths" ? { kind: "fail", area, title: `${l.max}개월 이하만 대상 (지금 ${raw}개월)`, detail }
          : { kind: "fix", area, title: `${area}을 ${(over).toLocaleString("ko-KR")}만 원 낮추면 충족`, detail }
        );
      } else if (max === v) {
        items.push({ kind: "risk", area, title: "상한에 딱 맞아요 · 조금만 올라도 탈락", detail });
      } else {
        const gap = max - v;
        const tight = isMoney ? gap <= Math.max(RISK_INCOME, max * 0.05) : l.field === "age" ? gap < 1 : gap <= max * 0.05;
        items.push({
          kind: tight ? "risk" : "margin",
          area,
          title: isMoney
            ? `소득 상한까지 월 ${won(gap)} 여유`
            : l.field === "age"
            ? gap < 1 ? `올해가 마지막 (만 ${l.max}세까지)` : `만 ${l.max}세까지 ${gap}년 남음`
            : l.field === "sepMonths"
            ? `${gap}개월 여유`
            : `상한까지 ${gap.toLocaleString("ko-KR")}만 원 여유`,
          detail: tight ? `${detail} · 조금만 늘어도 탈락할 수 있어요` : detail,
        });
      }
    }
    if (l.min !== undefined) {
      const min = isMoney ? toWon(l.min) : l.min;
      if (v < min) {
        const short = min - v;
        items.push(
          isMoney ? { kind: "fix", area, title: `월 소득이 ${won(short)} 늘면 충족`, detail }
          : l.field === "age" ? { kind: "fix", area, title: `만 ${l.min}세부터 대상 · ${short}년 뒤 신청 가능`, detail }
          : l.field === "sepMonths"
          ? { kind: "fix", area, title: `${short}개월 더 따로 살면 충족 (${monthLabel(short, today)})`, detail }
          : { kind: "fix", area, title: `${area} ${short.toLocaleString("ko-KR")}만 원 이상이어야 충족`, detail }
        );
      } else if (l.max === undefined) {
        items.push({ kind: "margin", area, title: `하한 충족 (${l.field === "age" ? `만 ${l.min}세 이상` : l.field === "sepMonths" ? `${l.min}개월 이상` : "기준 이상"})`, detail });
      }
    }
  }
  // 미충족 → 고치는 방법 → 아슬아슬 → 여유 순
  const order: Record<GenericKind, number> = { fail: 0, fix: 1, risk: 2, margin: 3 };
  return { items: items.sort((a, b) => order[a.kind] - order[b.kind]), missing };
}
