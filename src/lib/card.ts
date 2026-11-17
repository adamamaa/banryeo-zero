// AI 답변을 글 대신 카드로 보여주기 위한 구조. 파싱에 실패하면 원문 글로 보여준다.
export interface PolicyDetail {
  name: string;
  benefit?: string;
  deadline?: string;
  applyAt?: string;
  asOf?: string;
  conditions: string[];
  documents: { name: string; where?: string }[];
}

export interface AnswerCard {
  summary: string;
  facts: { label: string; value: string }[];
  steps: string[];
  links: { name: string; url: string }[];
  caution?: string;
  followUps: string[];
  policies: PolicyDetail[];
}

export const CARD_FORMAT = `다른 글 없이 아래 JSON 객체 하나만 출력하세요. 모든 값은 짧은 한국어로 씁니다.
{
  "summary": "질문에 대한 한 줄 답 (50자 이내, 핵심 수치 포함)",
  "facts": [{ "label": "대상|금액|기간|신청처|소득기준 등 2~6자", "value": "25자 이내" }],
  "steps": ["신청 절차 한 단계 (20자 이내)"],
  "links": [{ "name": "사이트 이름", "url": "https://..." }],
  "caution": "놓치기 쉬운 주의점 한 줄 (40자 이내, 없으면 빈 문자열)",
  "followUps": ["사용자가 이어서 물어볼 만한 질문 (25자 이내)"],
  "policies": [{
    "name": "답변에 나온 정책·제도 이름",
    "benefit": "지원 내용 (25자 이내)",
    "deadline": "신청 기한·시기 (20자 이내, 모르면 빈 문자열)",
    "applyAt": "신청하는 곳 (15자 이내)",
    "asOf": "정보 기준 시점과 출처 (예: 2026년 고용24 안내, 20자 이내)",
    "conditions": ["자격 조건 하나 (25자 이내)"],
    "documents": [{ "name": "필요 서류 이름", "where": "발급처 (예: 정부24)" }]
  }]
}
facts·steps는 최대 4개, links·followUps·policies는 최대 3개, 정책마다 conditions는 최대 5개, documents는 최대 6개입니다.
policies에는 답변에서 다룬 실제 정책만 넣고, 조건과 서류는 검색으로 확인한 것만 쓰세요. 정책을 다루지 않는 질문이면 빈 배열로 두세요. 해당 없는 항목은 빈 배열로 두세요.`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []); // eslint-disable-line @typescript-eslint/no-explicit-any

// ponytail: 등록 사이트가 아닌 링크는 도메인 첫 화면으로 줄인다 (모델이 지어낸 세부 경로 404 방지).
// 출처 URL과 대조하는 정밀 검증이 필요하면 grounding 메타데이터의 실제 URL을 따라가 확인.
function safeLink(raw: unknown, sites: { name: string; url: string; host: string }[]) {
  const l = raw as { name?: unknown; url?: unknown };
  try {
    const u = new URL(String(l?.url));
    if (u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./, "");
    const site = sites.find((s) => s.host === host);
    if (site) return { name: str(l.name, 20) || site.name, url: site.url };
    if (!/\.(go|or)\.kr$/.test(host)) return null;
    return { name: str(l.name, 20) || host, url: u.origin };
  } catch {
    return null;
  }
}

export function parsePolicy(p: Record<string, unknown>): PolicyDetail | null {
  const name = str(p?.name, 40);
  if (!name) return null;
  return {
    name,
    benefit: str(p.benefit, 60) || undefined,
    deadline: str(p.deadline, 40) || undefined,
    applyAt: str(p.applyAt, 30) || undefined,
    asOf: str(p.asOf, 40) || undefined,
    // 공고문 분석은 일상 질문을 최대 8개까지 만든다
    conditions: arr(p.conditions).map((c) => str(c, 60)).filter(Boolean).slice(0, 8),
    documents: arr(p.documents)
      .map((d) => (typeof d === "string" ? { name: str(d, 40) } : { name: str(d?.name, 40), where: str(d?.where, 30) || undefined }))
      .filter((d) => d.name)
      .slice(0, 6),
  };
}

export function parseCard(text: string, sites: { name: string; url: string; host: string }[] = []): AnswerCard | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  const summary = str(raw.summary, 120);
  if (!summary) return null;
  const links = arr(raw.links)
    .map((l) => safeLink(l, sites))
    .filter((l): l is { name: string; url: string } => Boolean(l))
    .filter((l, i, all) => all.findIndex((x) => x.url === l.url) === i)
    .slice(0, 3);
  return {
    summary,
    facts: arr(raw.facts)
      .map((f) => ({ label: str(f?.label, 12), value: str(f?.value, 60) }))
      .filter((f) => f.label && f.value)
      .slice(0, 4),
    steps: arr(raw.steps).map((s) => str(s, 50)).filter(Boolean).slice(0, 4),
    links,
    caution: str(raw.caution, 80) || undefined,
    followUps: arr(raw.followUps).map((q) => str(q, 40)).filter(Boolean).slice(0, 3),
    policies: arr(raw.policies)
      .map(parsePolicy)
      .filter((p): p is PolicyDetail => Boolean(p))
      .slice(0, 3),
  };
}

// 히스토리 저장과 이전 대화 전달용 평문
export const cardToText = (c: AnswerCard) =>
  [
    c.summary,
    ...c.facts.map((f) => `- ${f.label}: ${f.value}`),
    ...c.steps.map((s, i) => `${i + 1}. ${s}`),
    ...c.links.map((l) => `- ${l.name}: ${l.url}`),
    c.caution && `주의: ${c.caution}`,
    c.policies.length && `다룬 정책: ${c.policies.map((p) => p.name).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
