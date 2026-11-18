// 행정안전부 보조금24 (공공데이터포털 '대한민국 공공서비스 정보') 실시간 조회.
// 목록(serviceList)으로 내 지역·관심 분야 공고를 찾고, 상세(serviceDetail)에서 신청기한·구비서류를 가져온다.
// 키는 서버 환경변수 PUBLIC_DATA_API_KEY (공공데이터포털 일반 인증키)를 쓴다. 키가 없으면 조회하지 않는다.

import { ymdOf, type OfficialRecord } from "./officialFacts";

const BASE = "https://api.odcloud.kr/api/gov24/v3";

export interface Gov24Notice {
  // 어디서 온 공고인지 (없으면 보조금24)
  source?: "gov24" | "youth" | "welfare";
  id: string;
  name: string;
  org: string;
  summary: string;
  target: string;
  deadlineText: string;
  applyStart?: string; // YYYY-MM-DD
  applyEnd?: string;
  docs: string[];
  applyAt: string;
  url: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : v == null ? "" : String(v).slice(0, max));
const https = (v: unknown) => (/^https:\/\//.test(s(v)) ? s(v) : "");

async function call(path: string, key: string, params: Record<string, string>): Promise<Row[]> {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("page", "1");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // 일반 인증키를 serviceKey 쿼리로 보낸다 (Swagger의 ApiKeyAuth2 방식)
  url.searchParams.set("serviceKey", key);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`보조금24 응답 ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : undefined;
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// "2026. 12. 1.(월) ~ 12. 19.(금)", "2026.3.30.~2026.5.29.", "2026-12-31까지", "상시신청" 등을 날짜로 바꾼다
export function parseApplyPeriod(text: string): { start?: string; end?: string } {
  const t = text.replace(/\s+/g, " ");
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
  const short = after.match(/^[^~]{0,12}~\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (short) {
    const end = ymd(y0, Number(short[1]), Number(short[2]));
    return end ? { start, end } : { start };
  }
  if (/^.{0,8}(까지|마감)/.test(after)) return { end: start };
  return { start };
}

// 구비서류 글을 서류 이름 목록으로 나눈다 ("○ 주민등록등본 1부", "1. 신청서" 등)
export function splitDocs(text: string): string[] {
  if (!text || /^(해당\s*없음|없음|-)$/.test(text.trim())) return [];
  return text
    .split(/\r?\n|[○●◦·•▪■□※]|(?:^|\s)\d{1,2}[.)]\s|,\s*/)
    .map((x) =>
      x
        // "신청인 제출서류: 주민등록등본"처럼 앞에 붙은 구분 머리말은 뗀다
        .replace(/^[^:：]*(서류|구비|제출|추가)[^:：]*[:：]\s*/, "")
        .replace(/\(?\s*\d+\s*부\s*\)?/g, "")
        .replace(/^[-\s]+/, "")
        .trim()
    )
    .filter((x) => x.length >= 2 && x.length <= 40 && !/^(구비서류|제출서류|공통|해당자)$/.test(x))
    .slice(0, 8);
}

// 서류 이름으로 흔한 유효기간을 추정한다 (신청일 기준 며칠 이내 발급분). 모르면 null
export function guessValidDays(doc: string): number | null {
  if (/등본|초본/.test(doc)) return 30;
  if (/재직증명|건강보험료|납부확인|자격득실|이체내역/.test(doc)) return 30;
  if (/가족관계|혼인관계|기본증명|소득금액|사실증명|졸업증명/.test(doc)) return 90;
  return null;
}

const toNotice = (r: Row, detail?: Row): Gov24Notice => {
  const deadlineText = s(detail?.["신청기한"] ?? r["신청기한"], 120);
  const { start, end } = parseApplyPeriod(deadlineText);
  return {
    source: "gov24",
    id: s(r["서비스ID"], 40),
    name: s(r["서비스명"], 60),
    org: s(r["소관기관명"], 40),
    summary: s(r["서비스목적요약"] ?? detail?.["서비스목적"] ?? r["지원내용"], 160),
    target: s(detail?.["지원대상"] ?? r["지원대상"], 200),
    deadlineText,
    applyStart: start,
    applyEnd: end,
    docs: splitDocs(s(detail?.["구비서류"], 800)),
    applyAt: s(detail?.["접수기관명"] ?? r["접수기관"], 40),
    url: https(detail?.["온라인신청사이트URL"]) || https(r["상세조회URL"]) || "https://www.gov.kr/portal/rcvfvrSvc/main",
  };
};

// 관심 분야 → 서비스명 검색어
const INTEREST_KEYWORD: Record<string, string> = {
  주거: "월세",
  "일자리·취업": "취업",
  창업: "창업",
  "금융·자산": "자산",
  "교육·자격증": "교육",
  "생활·복지": "생활",
  "문화·여가": "문화",
  "건강·심리": "심리",
};

export const SIDO_FULL: Record<string, string[]> = {
  서울: ["서울특별시"],
  부산: ["부산광역시"],
  대구: ["대구광역시"],
  인천: ["인천광역시"],
  광주: ["광주광역시", "전남광주통합특별시"],
  대전: ["대전광역시"],
  울산: ["울산광역시"],
  세종: ["세종특별자치시"],
  경기: ["경기도"],
  강원: ["강원특별자치도", "강원도"],
  충북: ["충청북도"],
  충남: ["충청남도"],
  전북: ["전북특별자치도", "전라북도"],
  전남: ["전라남도", "전남광주통합특별시"],
  경북: ["경상북도"],
  경남: ["경상남도"],
  제주: ["제주특별자치도"],
};

// 같은 조건은 10분 동안 다시 부르지 않는다 (호출 한도 아끼기)
const cache = new Map<string, { at: number; data: Gov24Notice[] }>();

// 소관기관으로 내 지역 사업인지 가른다
function regionOf(q: { sido?: string; sigungu?: string }) {
  const org = (r: Row) => s(r["소관기관명"]);
  const sidoPrefixes = q.sido ? SIDO_FULL[q.sido] || [q.sido] : [];
  const inMySido = (o: string) => !sidoPrefixes.length || sidoPrefixes.some((p) => o.startsWith(p));
  const isRegionalOrg = (o: string) => sidoPrefixes.some((p) => o === p);
  const isLocalGov = (r: Row) =>
    s(r["소관기관유형"]).includes("지방") ||
    /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|전북|전남|경상|경북|경남|제주)/.test(org(r));
  const isCentral = (r: Row) =>
    s(r["소관기관유형"]).includes("중앙") ||
    (!isLocalGov(r) && (/중앙|부$|처$|청$|위원회$|공단$|공사$|원$/.test(org(r)) || org(r).length > 0));
  const isMine = (r: Row) => Boolean(q.sigungu) && inMySido(org(r)) && org(r).includes(q.sigungu!);
  return { org, inMySido, isRegionalOrg, isCentral, isMine };
}

// 청년이 대상이 아니거나, 내 조건에 없는 특정 집단 전용인 서비스
const NOT_YOUTH = /노인|어르신|경로당|영유아|아동|초등|중학생|고등학생|산모|임산부/;
const GROUP_ONLY: [RegExp, string[]][] = [
  [/장애/, ["장애인"]],
  [/한부모/, ["한부모 가정"]],
  [/다문화/, ["다문화 가정"]],
  [/기초생활|수급자|차상위|저소득/, ["기초생활수급", "차상위계층"]],
  [/국가유공|보훈/, ["국가유공자 가족"]],
];

// 공식 원문 확인: 정책 이름으로 찾아 지원 내용과 수정일을 그대로 돌려준다
export async function officialGov24(key: string, name: string): Promise<Omit<OfficialRecord, "query" | "exact">[]> {
  const rows = await call("serviceList", key, { perPage: "10", "cond[서비스명::LIKE]": name });
  return rows.map((r) => ({
    source: "보조금24",
    name: s(r["서비스명"], 60),
    org: s(r["소관기관명"], 40),
    updated: ymdOf(s(r["수정일시"], 20)),
    benefit: s(r["지원내용"], 700),
    target: s(r["지원대상"], 300),
    deadline: s(r["신청기한"], 80),
    url: https(r["상세조회URL"]),
  }));
}

// 대안 찾기: 서비스명 키워드 검색 → 내 시군구·시도·중앙부처 사업만 남긴다
export async function searchGov24(
  key: string,
  q: { sido?: string; sigungu?: string; special?: string[] },
  keywords: string[],
  limit = 6
): Promise<Gov24Notice[]> {
  const results = await Promise.allSettled(
    keywords.map((kw) => call("serviceList", key, { perPage: "30", "cond[서비스명::LIKE]": kw }))
  );
  if (results.every((r) => r.status === "rejected")) throw new Error("보조금24 검색 실패");
  const { org, isRegionalOrg, isCentral, isMine } = regionOf(q);
  const mine = q.special || [];
  const rank = (r: Row) => (isMine(r) ? 0 : isRegionalOrg(org(r)) ? 1 : 2);
  const today = todayYmd();
  const seen = new Set<string>();
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((r) => {
      const id = s(r["서비스ID"]);
      const name = s(r["서비스명"]);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      if (NOT_YOUTH.test(name)) return false;
      if (GROUP_ONLY.some(([re, need]) => re.test(name) && !need.some((n) => mine.includes(n)))) return false;
      return !q.sido || isCentral(r) || isRegionalOrg(org(r)) || isMine(r);
    })
    .sort((a, b) => rank(a) - rank(b))
    .map((r) => toNotice(r))
    .filter((n) => n.id && n.name && (!n.applyEnd || n.applyEnd >= today))
    .slice(0, limit);
}

export async function recommendGov24(
  key: string,
  q: { sido?: string; sigungu?: string; interests?: string[] },
  opts?: { bypassCache?: boolean }
): Promise<Gov24Notice[]> {
  const cacheKey = JSON.stringify(q);
  const hit = !opts?.bypassCache ? cache.get(cacheKey) : undefined;
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;

  // serviceList는 서비스명·서비스ID·등록/수정일시로만 거를 수 있다 (Swagger 기준).
  // 그래서 '청년'이 들어간 서비스를 넉넉히 받아 소관기관명으로 지역을 거르고, 관심 분야는 서비스명으로 따로 찾는다.
  const youthRows = await call("serviceList", key, { perPage: "500", "cond[서비스명::LIKE]": "청년" });
  const interestRows = (
    await Promise.all(
      (q.interests || [])
        .slice(0, 3)
        .map((i) => INTEREST_KEYWORD[i])
        .filter(Boolean)
        .map((kw) => call("serviceList", key, { perPage: "50", "cond[서비스명::LIKE]": kw }).catch(() => [] as Row[]))
    )
  ).flat();

  const { org, isRegionalOrg, isCentral, isMine } = regionOf(q);

  // 순위: 내 시군구 기관 → 내 시도 기관 → 관심 분야(내 지역·중앙 청년 대상) → 중앙부처 청년 서비스
  const local = q.sigungu ? youthRows.filter(isMine) : [];
  const regional = q.sido ? youthRows.filter((r) => isRegionalOrg(org(r)) && !local.includes(r)) : [];
  const interest = interestRows.filter((r) => {
    if (!/청년|19세|34세|39세/.test(`${s(r["서비스명"])} ${s(r["지원대상"])}`)) return false;
    if (!q.sido) return true;
    return isCentral(r) || isRegionalOrg(org(r)) || isMine(r);
  });
  const central = youthRows.filter(isCentral);

  const seen = new Set<string>();
  const rows = [...local, ...regional, ...interest, ...central]
    .filter((r) => {
      const id = s(r["서비스ID"]);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 8);

  // 상세(신청기한·구비서류)는 앞의 6개만
  const details = await Promise.all(
    rows.slice(0, 6).map((r) =>
      call("serviceDetail", key, { perPage: "1", "cond[서비스ID::EQ]": s(r["서비스ID"]) })
        .then((d) => d[0])
        .catch(() => undefined)
    )
  );
  const today = todayYmd();
  const data = rows
    .map((r, i) => toNotice(r, details[i]))
    .filter((n) => n.id && n.name && (!n.applyEnd || n.applyEnd >= today));
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
