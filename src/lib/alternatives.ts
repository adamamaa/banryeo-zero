// 대안 찾기: 원하는 지원이 안 될 때 같은 목적을 이룰 다른 지원을 실제 공고에서 찾는다.
// 온통청년·복지로·보조금24를 키워드로 검색하고, 각 출처의 규칙으로 내 조건에 맞지 않는 것을 거른다.
// 화면의 공고명·링크·기한은 AI가 쓴 값이 아니라 여기서 찾은 원본으로 채운다 (지어내기 방지).
import { searchGov24, type Gov24Notice } from "./gov24";
import { searchYouth, type YouthQuery } from "./youthcenter";
import { searchWelfare } from "./welfare";
import { isNegativeAnswer, type AnswerAlternative, type AnswerCard } from "./card";

export type AltProfile = YouthQuery;

export interface AltCandidate extends Gov24Notice {
  ref: string;
}

export const SOURCE_LABEL = { youth: "온통청년", welfare: "복지로", gov24: "보조금24" } as const;
const labelOf = (c: Gov24Notice) => SOURCE_LABEL[c.source || "gov24"];
const norm = (v: string) => v.replace(/[\s()·\-[\]]/g, "").replace(/^20\d{2}(년)?/, "");
const similar = (a: string, b: string) => {
  const [x, y] = [norm(a), norm(b)];
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
};

export async function findAlternatives(
  keys: { pk?: string; yk?: string },
  profile: AltProfile,
  ask: { keywords: string[]; exclude?: string }
): Promise<{ candidates: AltCandidate[]; searched: string[] }> {
  const { keywords, exclude } = ask;
  const [youth, welfare, gov] = await Promise.allSettled([
    keys.yk ? searchYouth(keys.yk, profile, keywords) : Promise.reject(new Error("no key")),
    keys.pk ? searchWelfare(keys.pk, profile, keywords) : Promise.reject(new Error("no key")),
    keys.pk ? searchGov24(keys.pk, profile, keywords) : Promise.reject(new Error("no key")),
  ]);
  const lists = [youth, welfare, gov].map((r) => (r.status === "fulfilled" ? r.value : []));
  const searched = [
    youth.status === "fulfilled" && SOURCE_LABEL.youth,
    welfare.status === "fulfilled" && SOURCE_LABEL.welfare,
    gov.status === "fulfilled" && SOURCE_LABEL.gov24,
  ].filter((x): x is (typeof SOURCE_LABEL)[keyof typeof SOURCE_LABEL] => Boolean(x));

  // 출처를 번갈아 담아 한 곳 결과로만 채워지지 않게 한다
  const candidates: AltCandidate[] = [];
  for (let i = 0; i < 6 && candidates.length < 8; i++) {
    for (const list of lists) {
      const c = list[i];
      if (!c || candidates.length >= 8) continue;
      if (exclude && similar(c.name, exclude)) continue;
      if (candidates.some((x) => similar(x.name, c.name))) continue;
      candidates.push({ ...c, ref: `${c.source || "gov24"}:${c.id}` });
    }
  }
  return { candidates, searched };
}

const fromCandidate = (c: AltCandidate, a?: AnswerAlternative): AnswerAlternative => ({
  ref: c.ref,
  name: c.name,
  benefit: a?.benefit || c.summary.slice(0, 60) || undefined,
  why: a?.why || "내 조건으로 찾은 실시간 공고예요",
  deadline: c.applyEnd ? `${c.applyEnd}까지` : c.deadlineText.slice(0, 30) || undefined,
  org: c.org || undefined,
  url: c.url,
  source: labelOf(c),
});

// AI가 고른 대안을 검색 원본과 맞춘다. 원본이 없는 대안은 공식 링크가 있을 때만 '웹 검색'으로 남긴다.
// 안 된다는 답인데 AI가 대안을 빠뜨렸으면 찾아 둔 공고를 넣는다.
export function resolveAlternatives(card: AnswerCard, candidates: AltCandidate[], ineligible = false): AnswerCard {
  const out: AnswerAlternative[] = [];
  for (const a of card.alternatives || []) {
    const c = candidates.find((x) => x.ref === a.ref) || candidates.find((x) => similar(x.name, a.name));
    const item = c ? fromCandidate(c, a) : a.url ? { ...a, ref: undefined, source: "웹 검색" } : null;
    if (item && !out.some((x) => similar(x.name, item.name))) out.push(item);
  }
  if (!out.length && (ineligible || isNegativeAnswer(card.summary))) {
    out.push(...candidates.slice(0, 3).map((c) => fromCandidate(c)));
  }
  return { ...card, alternatives: out.slice(0, 3) };
}
