// 공식 원문 대조: 보조금24·온통청년의 가장 최근 수정 기록으로 답변의 금액을 확인한다.
// 같은 정책도 기록마다 금액이 다를 수 있어(예전 기록이 남아 있음) 수정일이 가장 최근인 원문을 기준으로 삼는다.
import type { AnswerCard } from "./card";

export interface OfficialRecord {
  // 찾을 때 쓴 정책 이름
  query: string;
  // 이름이 정확히 같은 기록인지 (비슷한 이름의 지역 사업과 구분)
  exact: boolean;
  source: "보조금24" | "온통청년";
  name: string;
  org: string;
  updated: string; // YYYY-MM-DD
  benefit: string;
  target: string;
  deadline: string;
  url: string;
}

export const normName = (v: string) => v.replace(/[\s()·\-[\]]/g, "").replace(/^20\d{2}(년)?/, "");
export const similarName = (a: string, b: string) => {
  const [x, y] = [normName(a), normName(b)];
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
};

// "2026 국민취업지원제도(Ⅰ유형)" → "국민취업지원제도"
export const cleanPolicyName = (v: string) =>
  v
    .replace(/\([^)]*\)/g, " ")
    .replace(/[ⅠⅡⅢI]+\s*유형/g, " ")
    .replace(/^\s*20\d{2}(년)?\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

export const ymdOf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
};

// 답변 카드에서 공식 원문과 대조할 정책 이름
export const policyNamesIn = (card: AnswerCard) =>
  Array.from(
    new Set([...card.policies.map((p) => p.name), ...(card.alternatives || []).map((a) => a.name)].map(cleanPolicyName))
  )
    .filter((n) => normName(n).length >= 5)
    .slice(0, 4);

// 정책마다 기준이 되는 원문 하나: 이름이 같고 금액이 적힌 가장 최근 기록
export function pickOfficial(records: OfficialRecord[]) {
  const picked = new Map<string, OfficialRecord>();
  for (const r of records) {
    if (!r.exact) continue;
    const cur = picked.get(r.query);
    const better = !cur || (!amountsIn(cur.benefit).length && amountsIn(r.benefit).length > 0);
    if (better) picked.set(r.query, r);
  }
  return Array.from(picked.values());
}

// ---------- 금액 ----------

interface Amount {
  text: string;
  index: number;
  low?: number;
  high: number;
}
const AMOUNT = /(?:(\d[\d,]*(?:\.\d+)?)\s*[~∼～\-–]\s*)?(\d[\d,]*(?:\.\d+)?)\s*(만\s*원?|원)/g;
const toNum = (v: string) => Number(v.replace(/,/g, ""));

export function amountsIn(text: string): Amount[] {
  return Array.from(text.matchAll(AMOUNT)).map((m) => {
    const unit = m[3].startsWith("만") ? 10000 : 1;
    return {
      text: m[0].trim(),
      index: m.index ?? 0,
      high: toNum(m[2]) * unit,
      ...(m[1] && { low: toNum(m[1]) * unit }),
    };
  });
}

// 원문의 금액, 범위 안의 값, "월 60만 원 × 6개월" 같은 곱을 인정한다
function supportedBy(rec: OfficialRecord) {
  const text = `${rec.benefit} ${rec.target}`;
  const found = amountsIn(text);
  const exact = found.flatMap((a) => (a.low === undefined ? [a.high] : [a.low, a.high]));
  const counts = Array.from(text.matchAll(/(\d+)\s*(개월|회|년)/g)).map((m) => Number(m[1]));
  return (won: number) =>
    exact.some((e) => Math.abs(e - won) < 1 || counts.some((k) => Math.abs(e * k - won) < 1)) ||
    found.some((a) => a.low !== undefined && a.low <= won && won <= a.high);
}

// 소득·재산 기준처럼 지원 금액이 아닌 값은 비교하지 않는다
const NOT_BENEFIT = /소득|재산|자산|이하|이상|미만|초과|보증금/;

export interface AmountIssue {
  policy: string;
  amount: string;
  record: OfficialRecord;
}

export function findAmountIssues(card: AnswerCard, records: OfficialRecord[]): AmountIssue[] {
  const official = pickOfficial(records).filter((r) => amountsIn(r.benefit).length);
  const queries = official.map((r) => normName(r.query));
  const lines = [
    card.summary,
    ...card.facts.map((f) => `${f.label}: ${f.value}`),
    ...(card.body || "").split(/\r?\n/),
  ];
  const issues: AmountIssue[] = [];
  for (const rec of official) {
    const q = normName(rec.query);
    const segments = [
      ...card.policies.filter((p) => similarName(p.name, rec.query)).map((p) => p.benefit || ""),
      ...(card.alternatives || []).filter((a) => similarName(a.name, rec.query)).map((a) => a.benefit || ""),
      // 이 정책만 언급한 줄 (여러 정책이 함께 나온 줄은 어느 금액인지 알 수 없다)
      ...lines.filter((l) => {
        const n = normName(l);
        return n.includes(q) && queries.filter((x) => n.includes(x)).length === 1;
      }),
    ];
    const ok = supportedBy(rec);
    for (const seg of segments) {
      for (const a of amountsIn(seg)) {
        const around = seg.slice(Math.max(0, a.index - 10), a.index + a.text.length + 6);
        if (NOT_BENEFIT.test(around)) continue;
        if ([a.low, a.high].every((v) => v === undefined || ok(v))) continue;
        if (!issues.some((x) => x.policy === rec.query && x.amount === a.text)) {
          issues.push({ policy: rec.query, amount: a.text, record: rec });
        }
      }
    }
  }
  return issues;
}

// 원문에서 금액이 나오는 부분
export function benefitExcerpt(rec: OfficialRecord) {
  const at = amountsIn(rec.benefit)[0]?.index ?? 0;
  return rec.benefit.slice(Math.max(0, at - 30), at + 70).replace(/\s+/g, " ").trim();
}

// 카드에 공식 원문의 기준 시점과 출처를 넣는다
export function applyOfficial(card: AnswerCard, records: OfficialRecord[]): AnswerCard {
  const official = pickOfficial(records);
  const find = (name: string) => official.find((r) => normName(r.query) === normName(cleanPolicyName(name)));
  return {
    ...card,
    policies: card.policies.map((p) => {
      const r = find(p.name);
      return r ? { ...p, asOf: `${r.source} ${r.updated} 수정` } : p;
    }),
    alternatives: card.alternatives?.map((a) => {
      const r = a.source === "웹 검색" ? find(a.name) : undefined;
      return r ? { ...a, source: r.source, org: r.org || a.org, url: r.url || a.url } : a;
    }),
  };
}
