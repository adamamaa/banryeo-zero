import { MEDIAN_INCOME_2026, convertRent } from "./standards";

// 중복수급 충돌 + 최대 수령 조합.
// 정책 목록·금액·중복 규칙은 시연용 예시 데이터다. 실제 신청 전 공고 원문으로 확인해야 한다.

export interface BenefitCtx {
  sido: string;
  age: number | null;
  job: string;
  incomeManwon: number | null;
  sepMonths: number | null;
  depositManwon: number | null;
  rentManwon: number | null;
}

export type NeedKey = "sido" | "age" | "job" | "incomeManwon" | "sepMonths" | "rentManwon" | "depositManwon";
type Check = { status: "ok" | "no" | "unknown"; reason: string; need?: NeedKey };

export interface Benefit {
  id: string;
  name: string;
  org: string;
  amount: number; // 1년 기준 최대 수령액(원)
  amountText: string;
  kind: "현금" | "자산형성" | "환급";
  conflicts: string[];
  check: (c: BenefitCtx) => Check;
  // 신청 기간 (YYYY-MM-DD, 시연용 예시 일정). 없으면 상시 신청
  applyStart?: string;
  applyEnd?: string;
  url: string;
  // 제출 서류와 유효기간(신청일 기준 며칠 이내 발급분, null이면 기간 제한 없음)
  docs: { name: string; validDays: number | null }[];
}

const ratioOf = (c: BenefitCtx) =>
  c.incomeManwon === null ? null : ((c.incomeManwon * 10000) / MEDIAN_INCOME_2026[1]) * 100;

// 조건을 순서대로 확인한다. 하나라도 탈락이면 탈락, 정보가 없으면 '확인 필요'.
function rules(c: BenefitCtx, list: (() => Check | null)[]): Check {
  let unknown: Check | null = null;
  for (const r of list) {
    const res = r();
    if (!res) continue;
    if (res.status === "no") return res;
    if (res.status === "unknown" && !unknown) unknown = res;
  }
  return unknown || { status: "ok", reason: "입력한 조건으로 요건 충족" };
}

const need = (key: NeedKey, what: string): Check => ({ status: "unknown", reason: `${what} 정보가 필요해요`, need: key });
const no = (reason: string): Check => ({ status: "no", reason });

const ageIn = (c: BenefitCtx, min: number, max: number) => () =>
  c.age === null ? need("age", "나이") : c.age < min || c.age > max ? no(`만 ${min}~${max}세만 대상 (지금 만 ${c.age}세)`) : null;
const ratioMax = (c: BenefitCtx, max: number) => () => {
  const r = ratioOf(c);
  return r === null ? need("incomeManwon", "월 소득") : r > max ? no(`소득이 기준 중위소득 ${max}% 초과 (지금 ${r.toFixed(1)}%)`) : null;
};
const livesApart = (c: BenefitCtx) => () =>
  c.sepMonths === null ? need("sepMonths", "독립 여부") : c.sepMonths === 0 ? no("부모님과 따로 살아야 대상") : null;
const inSido = (c: BenefitCtx, sido: string) => () =>
  !c.sido ? need("sido", "거주 지역") : c.sido !== sido ? no(`${sido} 거주자만 대상`) : null;
const jobIn = (c: BenefitCtx, jobs: string[], label: string) => () =>
  !c.job ? need("job", "하는 일") : !jobs.includes(c.job) ? no(`${label}만 대상 (지금 ${c.job})`) : null;

export const BENEFITS: Benefit[] = [
  {
    id: "rent-national",
    name: "청년월세 한시 특별지원",
    org: "국토교통부",
    amount: 2_400_000,
    amountText: "월 20만 원 × 12개월",
    kind: "현금",
    conflicts: ["rent-seoul", "housing-benefit"],
    applyStart: "2026-11-02",
    applyEnd: "2026-12-30",
    url: "https://www.bokjiro.go.kr",
    docs: [
      { name: "주민등록등본", validDays: 30 },
      { name: "가족관계증명서 (상세)", validDays: 90 },
      { name: "임대차계약서 (확정일자)", validDays: null },
      { name: "청약통장 가입확인서", validDays: 30 },
    ],
    check: (c) =>
      rules(c, [
        ageIn(c, 19, 34),
        livesApart(c),
        ratioMax(c, 60),
        () => {
          if (c.rentManwon === null) return need("rentManwon", "월세");
          if (c.depositManwon === null) return need("depositManwon", "보증금");
          return convertRent(c.depositManwon * 10000, c.rentManwon * 10000).eligible
            ? null
            : no("보증금·월세 상한 초과 (환산 합산 90만 원)");
        },
      ]),
  },
  {
    id: "rent-seoul",
    name: "서울 청년월세 지원",
    org: "서울특별시",
    amount: 2_000_000,
    amountText: "월 20만 원 × 10개월",
    kind: "현금",
    conflicts: ["rent-national", "housing-benefit"],
    applyStart: "2026-12-01",
    applyEnd: "2026-12-11",
    url: "https://youth.seoul.go.kr",
    docs: [
      { name: "주민등록등본", validDays: 30 },
      { name: "임대차계약서", validDays: null },
      { name: "건강보험료 납부확인서", validDays: 30 },
    ],
    check: (c) => rules(c, [inSido(c, "서울"), ageIn(c, 19, 39), livesApart(c), ratioMax(c, 150)]),
  },
  {
    id: "housing-benefit",
    name: "주거급여 (임차급여)",
    org: "국토교통부 · 지자체",
    amount: 3_600_000,
    amountText: "월 약 30만 원 × 12개월 (지역·가구별 상이)",
    kind: "현금",
    conflicts: ["rent-national", "rent-seoul"],
    url: "https://www.bokjiro.go.kr",
    docs: [
      { name: "임대차계약서", validDays: null },
      { name: "통장 사본", validDays: null },
    ],
    check: (c) =>
      rules(c, [
        livesApart(c),
        ratioMax(c, 48),
        () =>
          c.age !== null && c.age < 30
            ? { status: "unknown", reason: "만 30세 미만 미혼은 부모님 가구 소득도 함께 봐요" }
            : null,
      ]),
  },
  {
    id: "job-kua",
    name: "국민취업지원제도 I유형 (구직촉진수당)",
    org: "고용노동부",
    amount: 3_000_000,
    amountText: "월 50만 원 × 6개월",
    kind: "현금",
    conflicts: ["allowance-seoul"],
    url: "https://www.work24.go.kr",
    docs: [
      { name: "주민등록등본", validDays: 30 },
      { name: "고용보험 자격이력 내역서", validDays: 30 },
    ],
    check: (c) => rules(c, [ageIn(c, 15, 69), jobIn(c, ["구직 중", "쉬는 중"], "미취업자"), ratioMax(c, 60)]),
  },
  {
    id: "allowance-seoul",
    name: "서울 청년수당",
    org: "서울특별시",
    amount: 3_000_000,
    amountText: "월 50만 원 × 6개월",
    kind: "현금",
    conflicts: ["job-kua"],
    applyStart: "2026-12-07",
    applyEnd: "2026-12-18",
    url: "https://youth.seoul.go.kr",
    docs: [
      { name: "주민등록초본", validDays: 30 },
      { name: "최종학력 졸업증명서", validDays: 90 },
      { name: "고용보험 자격이력 내역서", validDays: 30 },
    ],
    check: (c) =>
      rules(c, [inSido(c, "서울"), ageIn(c, 19, 34), jobIn(c, ["구직 중", "쉬는 중"], "미취업자"), ratioMax(c, 150)]),
  },
  {
    id: "save-naeil",
    name: "청년내일저축계좌 (정부 매칭)",
    org: "보건복지부",
    amount: 1_200_000,
    amountText: "월 10만 원 매칭 × 12개월 (3년 유지 시 지급)",
    kind: "자산형성",
    conflicts: ["save-doyak"],
    applyStart: "2027-01-04",
    applyEnd: "2027-01-22",
    url: "https://www.bokjiro.go.kr",
    docs: [
      { name: "재직증명서", validDays: 30 },
      { name: "소득금액증명", validDays: 90 },
    ],
    check: (c) =>
      rules(c, [
        ageIn(c, 19, 34),
        jobIn(c, ["재직 중", "자영업·프리랜서"], "일하고 있는 청년"),
        () =>
          c.incomeManwon === null
            ? need("incomeManwon", "월 소득")
            : c.incomeManwon <= 50 || c.incomeManwon > 250
            ? no("근로·사업소득 월 50만 원 초과 250만 원 이하만 대상")
            : null,
        ratioMax(c, 100),
      ]),
  },
  {
    id: "save-doyak",
    name: "청년도약계좌 (정부기여금)",
    org: "금융위원회",
    amount: 396_000,
    amountText: "월 최대 3.3만 원 × 12개월",
    kind: "자산형성",
    conflicts: ["save-naeil"],
    applyStart: "2026-12-01",
    applyEnd: "2026-12-11",
    url: "https://www.kinfa.or.kr",
    docs: [{ name: "소득금액증명", validDays: 90 }],
    check: (c) =>
      rules(c, [
        ageIn(c, 19, 34),
        () =>
          c.incomeManwon === null
            ? need("incomeManwon", "월 소득")
            : c.incomeManwon <= 0
            ? no("소득이 있어야 정부기여금 대상")
            : c.incomeManwon * 12 > 7500
            ? no("개인소득 연 7,500만 원 이하만 대상")
            : null,
      ]),
  },
  {
    id: "kpass",
    name: "K-패스 (청년 교통비 환급)",
    org: "국토교통부",
    amount: 216_000,
    amountText: "대중교통비 30% 환급 (월 6만 원 이용 시 연 약 21.6만 원)",
    kind: "환급",
    conflicts: [],
    url: "https://korea-pass.kr",
    docs: [],
    check: (c) => rules(c, [ageIn(c, 19, 34)]),
  },
];

export interface ComboResult {
  chosen: Benefit[];
  total: number;
  // 받을 수 있지만 다른 정책과 겹쳐서 뺀 것
  dropped: { b: Benefit; because: Benefit }[];
  unknown: { b: Benefit; check: Check }[];
  ineligible: { b: Benefit; check: Check }[];
}

// 받을 수 있는 정책 중 서로 겹치지 않는 조합의 합이 최대인 것을 고른다 (정책 수가 적어 전수 탐색).
export function bestCombo(c: BenefitCtx): ComboResult {
  const checked = BENEFITS.map((b) => ({ b, check: b.check(c) }));
  const ok = checked.filter((x) => x.check.status === "ok").map((x) => x.b);
  let best: Benefit[] = [];
  let bestSum = -1;
  for (let mask = 0; mask < 1 << ok.length; mask++) {
    const set = ok.filter((_, i) => mask & (1 << i));
    if (set.some((a) => set.some((b) => a.conflicts.includes(b.id)))) continue;
    const sum = set.reduce((n, b) => n + b.amount, 0);
    if (sum > bestSum) {
      best = set;
      bestSum = sum;
    }
  }
  const dropped = ok
    .filter((b) => !best.includes(b))
    .map((b) => ({ b, because: best.find((x) => x.conflicts.includes(b.id) || b.conflicts.includes(x.id))! }))
    .filter((d) => d.because);
  return {
    chosen: best,
    total: Math.max(0, bestSum),
    dropped,
    unknown: checked.filter((x) => x.check.status === "unknown"),
    ineligible: checked.filter((x) => x.check.status === "no"),
  };
}
