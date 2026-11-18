// 공고 신청 기간 판단. 공공 데이터에는 실제 접수 기간 대신 사업 기간이 들어 있는 경우가 많다.
// 그런 값은 마감일로 쓰지 않는다 (2026-11-18 온통청년 600건 확인: 특정기간 290건 중 48건이 300일 이상).

export const PERIOD_UNKNOWN = "신청 기간은 공고문 확인";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : undefined;
export const localYmd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2026. 12. 1.(월) ~ 12. 19.(금)", "2026.3.30.~2026.5.29.", "20260101~20261231", "2026-12-31까지", "상시신청" 등을 날짜로 바꾼다
export function parseApplyPeriod(text: string): { start?: string; end?: string } {
  const t = text.replace(/\s+/g, " ").replace(/(^|\D)(20\d{2})(\d{2})(\d{2})(?!\d)/g, "$1$2.$3.$4");
  const full = Array.from(t.matchAll(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/g));
  if (!full.length) return {};
  const [d0] = full;
  const y0 = Number(d0[1]);
  const start = ymd(y0, Number(d0[2]), Number(d0[3]));
  if (!start) return {};
  if (full.length >= 2) {
    const end = ymd(Number(full[1][1]), Number(full[1][2]), Number(full[1][3]));
    return end ? { start, end } : { start };
  }
  const after = t.slice((d0.index ?? 0) + d0[0].length);
  const short = after.match(/^[^~]{0,12}~\s*\.?\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (short) {
    const end = ymd(y0, Number(short[1]), Number(short[2]));
    return end ? { start, end } : { start };
  }
  if (/^.{0,8}(까지|마감)/.test(after)) return { end: start };
  return { start };
}

const dayNumber = (v: string) => Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10))) / 86400000;

// 접수 마감으로 믿을 수 있는 기간만 남긴다.
// 거의 1년 내내 이어지거나, 사업 기간과 똑같은 긴 기간은 실제 접수 기간으로 보지 않는다.
export function trustedPeriod(
  period: { start?: string; end?: string },
  opts: { sameAsBusiness?: boolean; today?: string } = {}
): { start?: string; end?: string; uncertain: boolean } {
  const { start, end } = period;
  const today = opts.today ?? localYmd();
  if (!end) return { start, uncertain: false };
  const futureStart = start && start > today ? start : undefined;
  if (start && end < start) return { start: futureStart, uncertain: true };
  // 이미 끝난 기간은 그대로 둔다 (마감된 공고를 거를 때 쓴다)
  if (end < today || !start) return { start, end, uncertain: false };
  const days = dayNumber(end) - dayNumber(start);
  if (days >= 300 || (opts.sameAsBusiness && days >= 90)) return { start: futureStart, uncertain: true };
  return { start, end, uncertain: false };
}

type Dated = { applyStart?: string; applyEnd?: string };

// 마감일이 확인된 공고를 앞으로: 지금 접수 중(마감 빠른 순) → 곧 시작(시작 빠른 순) → 나머지
export function byDeadline(a: Dated, b: Dated, today = localYmd()) {
  const rank = (n: Dated) => (!n.applyEnd || n.applyEnd < today ? 2 : n.applyStart && n.applyStart > today ? 1 : 0);
  const [ra, rb] = [rank(a), rank(b)];
  if (ra !== rb) return ra - rb;
  if (ra === 2) return 0;
  const key = (n: Dated) => (ra === 1 ? n.applyStart! : n.applyEnd!);
  return key(a).localeCompare(key(b));
}

// 화면에 보여 줄 신청 기한 종류
export const deadlineKind = (n: { applyEnd?: string; deadlineText: string }) =>
  n.applyEnd ? "date" : /상시/.test(n.deadlineText) ? "always" : "check";
