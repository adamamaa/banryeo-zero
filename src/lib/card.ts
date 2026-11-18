// AI 답변을 글 대신 카드로 보여주기 위한 구조. 파싱에 실패하면 원문 글로 보여준다.
export interface PolicyDetail {
  name: string;
  benefit?: string;
  deadline?: string;
  applyAt?: string;
  asOf?: string;
  // 숫자로 판정되는 자격 조건 (한 끗 차이 진단에 쓴다)
  limits?: PolicyLimit[];
  conditions: string[];
  documents: { name: string; where?: string }[];
}

export type LimitField = "age" | "income" | "medianRatio" | "sepMonths" | "deposit" | "rent";
export interface PolicyLimit {
  field: LimitField;
  min?: number;
  max?: number;
  label: string;
}
const LIMIT_FIELDS: LimitField[] = ["age", "income", "medianRatio", "sepMonths", "deposit", "rent"];

// 원하는 지원이 안 될 때 대신 쓸 수 있는 지원
export interface AnswerAlternative {
  ref?: string;
  name: string;
  benefit?: string;
  why?: string;
  deadline?: string;
  org?: string;
  url?: string;
  source?: string;
}

export interface AnswerCard {
  summary: string;
  // 글·번역·요약·표처럼 사용자가 요청한 결과물 전체
  body?: string;
  facts: { label: string; value: string }[];
  steps: string[];
  links: { name: string; url: string }[];
  caution?: string;
  followUps: string[];
  policies: PolicyDetail[];
  alternatives?: AnswerAlternative[];
}

// 한 줄 답이 "안 된다"는 내용인지 (대안을 찾아야 하는 답)
export const isNegativeAnswer = (summary: string) =>
  /제외|안\s*됩니다|안\s*돼|불가|받을\s*수\s*없|신청할\s*수\s*없|대상이\s*아니|해당하지\s*않|어렵습니다|어려워요|미충족|충족하지\s*못|마감(됐|되었)|종료(됐|되었)/.test(
    summary
  );

export const CARD_FORMAT = `다른 글 없이 아래 JSON 객체 하나만 출력하세요. 모든 값은 짧은 한국어로 씁니다.
{
  "summary": "질문에 대한 한 줄 답 (50자 이내, 핵심 수치 포함)",
  "body": "사용자가 글·메일·번역·요약·비교표·계획 같은 결과물을 원할 때만 그 전체 내용. # 제목, - 목록, | 표 | 형식을 쓸 수 있음. 아니면 빈 문자열",
  "facts": [{ "label": "대상|금액|기간|신청처|소득기준 등 2~6자", "value": "25자 이내" }],
  "steps": ["신청 절차 한 단계 (20자 이내)"],
  "links": [{ "name": "사이트 이름", "url": "https://..." }],
  "caution": "놓치기 쉬운 주의점 한 줄 (40자 이내, 없으면 빈 문자열)",
  "followUps": ["사용자가 이어서 물어볼 만한 질문 (25자 이내)"],
  "alternatives": [{
    "ref": "find_alternatives 결과의 ref (웹 검색으로 찾았으면 빈 문자열)",
    "name": "대신 받을 수 있는 지원 이름",
    "benefit": "지원 내용 (25자 이내)",
    "why": "이 사용자에게 맞는 이유, 확인할 조건이 있으면 함께 (35자 이내)",
    "url": "웹 검색으로 찾은 공식 페이지 주소 (ref가 있으면 빈 문자열)"
  }],
  "policies": [{
    "name": "답변에 나온 정책·제도 이름",
    "benefit": "지원 내용 (25자 이내)",
    "deadline": "신청 기한·시기 (20자 이내, 모르면 빈 문자열)",
    "applyAt": "신청하는 곳 (15자 이내)",
    "asOf": "정보 기준 시점과 출처 (예: 2026년 고용24 안내, 20자 이내)",
    "limits": [{ "field": "age | income | medianRatio | sepMonths | deposit | rent", "min": 숫자 또는 null, "max": 숫자 또는 null, "label": "조건 요약 (20자 이내)" }],
    "conditions": ["자격 조건 하나 (25자 이내)"],
    "documents": [{ "name": "필요 서류 이름", "where": "발급처 (예: 정부24)" }]
  }]
}
alternatives는 원하는 지원이 안 될 때만 최대 3개 넣고, 그 외에는 빈 배열로 두세요.
facts·steps는 최대 4개, links·followUps·policies는 최대 3개, 정책마다 conditions는 최대 5개, documents는 최대 6개입니다.
limits에는 숫자로 판정되는 자격 조건만 넣으세요: age는 만 나이, income은 본인 월 소득(만 원), medianRatio는 기준 중위소득 대비 %, sepMonths는 부모님과 따로 산 개월 수, deposit·rent는 보증금·월세(만 원). 가구 기준 조건이면 label에 "가구 기준"이라고 쓰세요. 숫자 조건이 없으면 빈 배열로 두세요.
policies에는 답변에서 다룬 실제 정책만 넣고, 조건과 서류는 검색으로 확인한 것만 쓰세요. 정책을 다루지 않는 질문이면 빈 배열로 두세요. 해당 없는 항목은 빈 배열로 두세요.`;

// 카드의 짧은 항목은 글자 그대로 표시하므로 굵게 표시(**)를 뗀다
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\*\*/g, "").trim().slice(0, max) : "");
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
    if (!/(^|\.)(go\.kr|or\.kr|gov\.kr)$/.test(host)) return null;
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
    limits: arr(p.limits)
      .map((l) => {
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
        const field = LIMIT_FIELDS.includes(l?.field) ? (l.field as LimitField) : null;
        const min = num(l?.min);
        const max = num(l?.max);
        return field && (min !== undefined || max !== undefined)
          ? { field, ...(min !== undefined && { min }), ...(max !== undefined && { max }), label: str(l?.label, 40) || field }
          : null;
      })
      .filter((l): l is PolicyLimit => Boolean(l))
      .slice(0, 6),
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
    // 본문은 화면이 서식을 해석하므로 ** 를 그대로 둔다
    body: (typeof raw.body === "string" && raw.body.trim().slice(0, 8000)) || undefined,
    facts: arr(raw.facts)
      .map((f) => ({ label: str(f?.label, 12), value: str(f?.value, 60) }))
      .filter((f) => f.label && f.value)
      .slice(0, 4),
    steps: arr(raw.steps).map((s) => str(s, 50)).filter(Boolean).slice(0, 4),
    links,
    caution: str(raw.caution, 80) || undefined,
    followUps: arr(raw.followUps).map((q) => str(q, 40)).filter(Boolean).slice(0, 3),
    alternatives: arr(raw.alternatives)
      .map((a) => ({
        ref: str(a?.ref, 60) || undefined,
        name: str(a?.name, 60),
        benefit: str(a?.benefit, 60) || undefined,
        why: str(a?.why, 70) || undefined,
        url: safeLink({ name: a?.name, url: a?.url }, sites)?.url,
      }))
      .filter((a) => a.name)
      .slice(0, 3),
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
    c.body,
    ...c.facts.map((f) => `- ${f.label}: ${f.value}`),
    ...c.steps.map((s, i) => `${i + 1}. ${s}`),
    ...c.links.map((l) => `- ${l.name}: ${l.url}`),
    c.caution && `주의: ${c.caution}`,
    c.alternatives?.length && `대안: ${c.alternatives.map((a) => a.name).join(", ")}`,
    c.policies.length && `다룬 정책: ${c.policies.map((p) => p.name).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
