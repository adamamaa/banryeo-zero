import {
  MEDIAN_INCOME_2026,
  DEPOSIT_CONVERSION_RATE,
  DEPOSIT_LIMIT_KRW,
  RENT_LIMIT_KRW,
  CONVERTED_RENT_LIMIT_KRW,
  judgeEligibility,
} from "./standards";

// 한 끗 차이 진단: 판정 결과에서 "무엇이 얼마나 바뀌면 결과가 달라지는지"를 역산한다.
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
  area: "소득" | "월세" | "특례";
  title: string;
  detail: string;
}

const won = (n: number) => `${Math.max(0, Math.round(n)).toLocaleString("ko-KR")}원`;
const RISK_INCOME = 100_000; // 소득이 이만큼 안쪽이면 '아슬아슬'
const RISK_RENT = 50_000;

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

export function nearMiss(p: NearMissInput, today = new Date()) {
  const income = p.incomeManwon * 10000;
  const deposit = p.depositManwon * 10000;
  const rent = p.rentManwon * 10000;
  const j = judgeEligibility({
    age: p.age,
    monthlyIncomeKRW: income,
    separateLivingMonths: p.sepMonths,
    depositKRW: deposit,
    rentKRW: rent,
  });
  const median = MEDIAN_INCOME_2026[1];
  const max60 = Math.floor(median * 0.6);
  const min50 = Math.ceil(median * 0.5);
  const items: NearMissItem[] = [];

  // 1. 본인 소득 (중위 60% 이하)
  if (!j.selfIncomeOk) {
    items.push({
      kind: "fix",
      area: "소득",
      title: `월 소득이 ${won(income - max60)}만 낮으면 소득 요건을 충족해요`,
      detail: `본인 소득 상한은 기준 중위소득 60%인 월 ${won(max60)}이고, 지금은 ${j.ratio}%입니다.`,
    });
  } else if (max60 - income <= RISK_INCOME) {
    items.push({
      kind: "risk",
      area: "소득",
      title: `월 소득이 ${won(max60 - income + 1)}만 늘어도 소득 요건을 넘어요`,
      detail: `상한 월 ${won(max60)}까지 여유가 거의 없습니다. 지원 중 소득 확인조사에서 중지될 수 있어요.`,
    });
  } else {
    items.push({
      kind: "margin",
      area: "소득",
      title: `소득 상한까지 월 ${won(max60 - income)} 여유`,
      detail: `상한은 기준 중위소득 60%인 월 ${won(max60)}입니다.`,
    });
  }

  // 2. 보증금·월세 (보증금 5천만 이하 + 월세 70만 이하, 또는 환산 합산 90만 이하)
  if (deposit > DEPOSIT_LIMIT_KRW) {
    items.push({
      kind: "fix",
      area: "월세",
      title: `보증금이 ${won(deposit - DEPOSIT_LIMIT_KRW)} 낮아야 해요`,
      detail: `보증금 상한은 ${won(DEPOSIT_LIMIT_KRW)}입니다. 재계약 때 보증금을 낮추고 월세로 돌리는 방법이 있어요.`,
    });
  } else if (!j.rent.eligible) {
    const rentCut = Math.min(rent - RENT_LIMIT_KRW, j.rent.total - CONVERTED_RENT_LIMIT_KRW);
    const maxDeposit = Math.floor(((CONVERTED_RENT_LIMIT_KRW - rent) * 12) / DEPOSIT_CONVERSION_RATE);
    const depositPath =
      rent < CONVERTED_RENT_LIMIT_KRW && maxDeposit >= 0 ? ` 또는 보증금을 ${won(deposit - maxDeposit)} 낮추면` : "";
    items.push({
      kind: "fix",
      area: "월세",
      title: `월세를 ${won(rentCut)} 낮추면${depositPath} 대상이 돼요`,
      detail: `지금 환산 합산 월세는 ${won(j.rent.total)}로 상한 ${won(CONVERTED_RENT_LIMIT_KRW)}을 넘습니다. 관리비를 월세에서 분리해 계약서에 적으면 월세가 내려가는 경우가 많아요.`,
    });
  } else if (rent > RENT_LIMIT_KRW) {
    const room = CONVERTED_RENT_LIMIT_KRW - j.rent.total;
    items.push({
      kind: room <= RISK_RENT ? "risk" : "margin",
      area: "월세",
      title:
        room <= RISK_RENT
          ? `월세가 ${won(room + 1)}만 올라도 대상에서 빠져요`
          : `월세 70만 원을 넘지만 환산 합산 기준으로 ${won(room)} 여유`,
      detail: `보증금 환산 ${won(j.rent.convertedDeposit)} + 월세 ${won(rent)} = ${won(j.rent.total)} (상한 ${won(CONVERTED_RENT_LIMIT_KRW)}). 공고문 3p 제2조 단서 덕분에 통과하는 구간이에요.`,
    });
  }

  // 3. 독립가구 특례 (만 30세 이상, 또는 1년 이상 별도 거주 + 중위 50% 이상)
  if (!j.independent) {
    const paths: string[] = [];
    if (p.age < 30) paths.push(`만 30세가 되면 바로 적용 (지금 만 ${p.age}세)`);
    const moreMonths = Math.max(0, 12 - p.sepMonths);
    const moreIncome = Math.max(0, min50 - income);
    if (moreMonths && moreIncome)
      paths.push(`${moreMonths}개월 더 따로 살고(${monthLabel(moreMonths, today)}부터) 월 소득이 ${won(moreIncome)} 늘면 적용`);
    else if (moreMonths) paths.push(`${moreMonths}개월만 더 따로 살면 ${monthLabel(moreMonths, today)}부터 적용`);
    else if (moreIncome) paths.push(`월 소득이 ${won(moreIncome)}만 늘면 적용 (중위 50% = ${won(min50)})`);
    items.push({
      kind: "fix",
      area: "특례",
      title: "부모님 소득을 빼고 심사받는 방법",
      detail: paths.join(" · ") || "공고문 18p [별표2] 제3호 요건을 확인하세요.",
    });
  } else if (p.age < 30) {
    const room = income - min50;
    items.push({
      kind: room <= RISK_INCOME ? "risk" : "margin",
      area: "특례",
      title:
        room <= RISK_INCOME
          ? `월 소득이 ${won(room + 1)}만 줄어도 특례가 풀려요`
          : `독립가구 특례 하한(중위 50%)까지 월 ${won(room)} 여유`,
      detail: `만 30세 미만은 본인 소득이 월 ${won(min50)} 이상이어야 부모님 소득을 보지 않습니다. 알바 시간을 줄일 때 주의하세요.`,
    });
  }

  const fixes = items.filter((i) => i.kind === "fix").length;
  const risks = items.filter((i) => i.kind === "risk").length;
  const headline =
    j.verdict === "ineligible"
      ? `탈락까지 한 끗 — ${fixes}가지만 바뀌면 대상이에요`
      : j.verdict === "needs_parent_check"
      ? "부모님 소득 심사를 피할 수 있는 방법이 있어요"
      : risks
      ? `지금은 대상이지만 아슬아슬한 조건이 ${risks}개 있어요`
      : "합격선까지 여유가 있어요";

  return { verdict: j.verdict, headline, items };
}
