// 온통청년(한국고용정보원) 청년정책 API 실시간 조회.
// 요청: https://www.youthcenter.go.kr/go/ythip/getPlcy (apiKeyNm, pageNum, pageSize, rtnType=json)
// 응답: result.youthPolicyList. 나이·지역·취업상태·혼인·학력·특화조건이 코드로 와서 내 정보와 바로 대조할 수 있다.
// 키는 서버 환경변수 YOUTHCENTER_API_KEY (온통청년 마이페이지 > OPEN API에서 발급)를 쓴다.
import { splitDocs, type Gov24Notice } from "./gov24";
import { mentionsOtherSigungu } from "@/data/regions";
import { PERIOD_UNKNOWN, byDeadline, trustedPeriod } from "./deadline";
import { ymdOf, type OfficialRecord } from "./officialFacts";
import { relevanceScore } from "./relevance";

const ENDPOINT = "https://www.youthcenter.go.kr/go/ythip/getPlcy";

type Row = Record<string, unknown>;
const s = (v: unknown, max = 300) => (v == null ? "" : String(v).trim().slice(0, max));
const codes = (v: unknown) => s(v, 4000).split(/[,\s]+/).filter(Boolean);

// zipCd 앞 두 자리 = 시도. 2026-11-18 실제 응답 500건에서 확인한 값:
// 서울 11·부산 26·대구 27·세종 36·강원 51·전북 52·경북 47·제주 50, 전남·광주는 '전남광주통합특별시' 12.
// 표본에 없던 시도는 법정동 표준 코드를 쓰고, 광주·전남은 옛 코드(29·46)도 함께 인정한다.
const SIDO_PREFIX: Record<string, string[]> = {
  서울: ["11"], 부산: ["26"], 대구: ["27"], 인천: ["28"], 광주: ["12", "29"], 대전: ["30"], 울산: ["31"], 세종: ["36"],
  경기: ["41"], 강원: ["51", "42"], 충북: ["43"], 충남: ["44"], 전북: ["52", "45"], 전남: ["12", "46"], 경북: ["47"], 경남: ["48"], 제주: ["50"],
};

// 내 정보 → 온통청년 코드 (공식 코드표 기준)
const JOB_CODES: Record<string, string[]> = {
  "재직 중": ["0013001", "0013005", "0013007"],
  "구직 중": ["0013003"],
  학생: ["0013003"],
  "쉬는 중": ["0013003"],
  "자영업·프리랜서": ["0013002", "0013004", "0013006"],
};
const MARRIAGE_CODE: Record<string, string> = { 미혼: "0055002", "결혼 예정": "0055002", 기혼: "0055001" };
const SCHOOL_CODES: Record<string, string[]> = {
  "고등학교 졸업 이하": ["0049001", "0049002", "0049003", "0049004"],
  "대학 재학·휴학": ["0049005"],
  "졸업 유예": ["0049005", "0049006"],
  "대학 졸업": ["0049007"],
  대학원: ["0049008"],
};
const SPECIAL_CODE: Record<string, string> = {
  기초생활수급: "0014003",
  "한부모 가정": "0014004",
  장애인: "0014005",
};
const NO_LIMIT = new Set(["0013010", "0055003", "0049010", "0014010"]);
// 이름에 특정 대상이 드러나는 정책 → 필요한 우대 조건
const GROUP_ONLY: [RegExp, string][] = [
  [/자립준비|보호종료/, "자립준비청년"],
  [/장애/, "장애인"],
  [/한부모/, "한부모 가정"],
  [/다문화/, "다문화 가정"],
  [/기초생활|수급자/, "기초생활수급"],
];

// 관심 분야 → 온통청년 대분류 이름에 들어가는 말
const INTEREST_CLASS: Record<string, string> = {
  주거: "주거",
  "일자리·취업": "일자리",
  창업: "일자리",
  "금융·자산": "주거",
  "교육·자격증": "교육",
  "생활·복지": "복지",
  "문화·여가": "문화",
  "건강·심리": "복지",
};

export interface YouthQuery {
  sido?: string;
  sigungu?: string;
  age?: number | null;
  job?: string;
  housing?: string;
  marriage?: string;
  children?: string;
  education?: string;
  special?: string[];
  company?: string;
  interests?: string[];
}

const ymd = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

// 신청기간 "20261201 ~ 20261219" (여러 회차면 줄바꿈·\N 구분) → 아직 안 끝난 가장 이른 회차
export function pickPeriod(aplyYmd: string): { start?: string; end?: string } {
  const today = todayYmd();
  const rounds = aplyYmd
    .split(/\\N|\r?\n/)
    .map((r) => r.match(/(\d{8})\s*~\s*(\d{8})/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ start: m[1], end: m[2] }))
    .filter((r) => r.end >= today)
    .sort((a, b) => a.end.localeCompare(b.end));
  return rounds[0] ? { start: ymd(rounds[0].start), end: ymd(rounds[0].end) } : {};
}

// 실제 접수 기간으로 믿을 수 있는 회차 (사업 기간을 그대로 적은 값은 마감일로 쓰지 않는다)
function applyPeriod(r: Row) {
  const raw = s(r.aplyYmd, 400);
  const period = pickPeriod(raw);
  const compact = (v?: string) => (v || "").replace(/-/g, "");
  const single = (raw.match(/\d{8}\s*~\s*\d{8}/g) || []).length === 1;
  const sameAsBusiness =
    single && compact(period.start) === s(r.bizPrdBgngYmd) && compact(period.end) === s(r.bizPrdEndYmd);
  return trustedPeriod(period, { sameAsBusiness });
}

// 내 정보와 맞지 않는 정책을 거르고, 맞는 정도로 점수를 매긴다 (-1이면 제외)
export function scorePolicy(r: Row, q: YouthQuery): number {
  if (s(r.aplyPrdSeCd) === "0057003") return -1; // 마감
  // 특정기간 신청인데 남은 회차가 없으면(모든 회차가 끝났으면) 마감으로 본다
  if (s(r.aplyPrdSeCd) === "0057001" && /\d{8}/.test(s(r.aplyYmd, 400)) && !pickPeriod(s(r.aplyYmd, 400)).end) return -1;
  // 특정 집단 전용 정책(이름에 대상이 드러남)은 내 우대 조건에 그 집단이 있을 때만 보여 준다
  const name = s(r.plcyNm);
  const mine = q.special || [];
  for (const [re, group] of GROUP_ONLY) if (re.test(name) && !mine.includes(group)) return -1;
  const familyFree = q.marriage === "미혼" && (!q.children || q.children === "없음");
  if (familyFree && /신혼부부|결혼|난임|임신|출산|산후/.test(name)) return -1;
  let score = 0;

  // 지역: 코드 목록에 내 시도가 없으면 제외. 목록이 짧으면(지자체 사업) 가산점
  const zips = codes(r.zipCd);
  const prefixes = q.sido ? SIDO_PREFIX[q.sido] : undefined;
  if (prefixes && zips.length) {
    if (!zips.some((z) => prefixes.some((p) => z.startsWith(p)))) return -1;
    // 전국 사업은 시군구 코드가 250개 안팎이라, 짧은 목록이면 지자체 사업으로 보고 가산점
    if (zips.length <= 40) score += 2;
  }
  if (q.sigungu && `${s(r.sprvsnInstCdNm)} ${s(r.operInstCdNm)} ${name}`.includes(q.sigungu)) score += 2;

  // 나이: 제한이 있는 정책만 범위 확인 (최대 0은 상한 없음으로 본다)
  const min = Number(s(r.sprtTrgtMinAge)) || 0;
  const max = Number(s(r.sprtTrgtMaxAge)) || 0;
  if (q.age != null && s(r.sprtTrgtAgeLmtYn) !== "Y") {
    if (min && q.age < min) return -1;
    if (max && q.age > max) return -1;
  }

  // 코드로 오는 조건: 정책이 제한을 두는데 내 코드가 없으면 제외
  const mismatch = (policyCodes: string[], mine: string[] | undefined) =>
    Boolean(mine?.length) && policyCodes.length > 0 && !policyCodes.some((c) => NO_LIMIT.has(c)) && !policyCodes.some((c) => mine!.includes(c));
  if (mismatch(codes(r.jobCd), q.job ? JOB_CODES[q.job] : undefined)) return -1;
  if (mismatch(codes(r.mrgSttsCd), q.marriage ? [MARRIAGE_CODE[q.marriage]].filter(Boolean) : undefined)) return -1;
  if (mismatch(codes(r.schoolCd), q.education ? SCHOOL_CODES[q.education] : undefined)) return -1;

  // 특화 조건(우대): 내 조건과 맞으면 가산점 (중소기업 재직 포함)
  const sbiz = codes(r.sbizCd);
  const mySpecial = [
    ...(q.special || []).map((x) => SPECIAL_CODE[x]).filter(Boolean),
    ...(q.company === "중소기업" ? ["0014001"] : []),
  ];
  if (sbiz.some((c) => mySpecial.includes(c))) score += 3;

  // 관심 분야
  const cls = `${s(r.lclsfNm)} ${s(r.mclsfNm)}`;
  if ((q.interests || []).some((i) => INTEREST_CLASS[i] && cls.includes(INTEREST_CLASS[i]))) score += 2;

  // 곧 마감
  const period = applyPeriod(r);
  if (period.end) {
    const left = (new Date(`${period.end}T00:00:00`).getTime() - Date.now()) / 86400000;
    if (left <= 14) score += 1;
  }
  return score;
}

const toNotice = (r: Row): Gov24Notice => {
  const always = s(r.aplyPrdSeCd) === "0057002";
  const { start, end, uncertain } = always
    ? { start: undefined, end: undefined, uncertain: false }
    : applyPeriod(r);
  const no = s(r.plcyNo, 40);
  const url = /^https:\/\//.test(s(r.aplyUrlAddr)) ? s(r.aplyUrlAddr) : `https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/${no}`;
  return {
    source: "youth",
    id: no,
    name: s(r.plcyNm, 60),
    org: s(r.sprvsnInstCdNm || r.operInstCdNm, 40),
    summary: s(r.plcySprtCn || r.plcyExplnCn, 160),
    target: [s(r.addAplyQlfcCndCn, 120), s(r.earnEtcCn, 60)].filter(Boolean).join(" · "),
    deadlineText: always
      ? "상시 신청"
      : uncertain
      ? PERIOD_UNKNOWN
      : s(r.aplyYmd, 60).replace(/\\N/g, " / ").replace(/(\d{4})(\d{2})(\d{2})/g, "$1-$2-$3"),
    applyStart: start,
    applyEnd: end,
    docs: splitDocs(s(r.sbmsnDcmntCn, 800)),
    applyAt: s(r.operInstCdNm || r.sprvsnInstCdNm, 40),
    url,
    // 대분류·키워드는 너무 넓어서('금융･복지･문화', '교육지원') 중분류만 쓴다
    topics: s(r.mclsfNm, 30),
  };
};

// 같은 조건은 10분 동안 다시 부르지 않는다
const cache = new Map<string, { at: number; data: Gov24Notice[] }>();

async function fetchPage(key: string, params: Record<string, string>): Promise<Row[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("apiKeyNm", key);
  url.searchParams.set("pageNum", params.pageNum || "1");
  url.searchParams.set("pageSize", "100");
  delete params.pageNum;
  url.searchParams.set("rtnType", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res = await fetch(url, { cache: "no-store" });
  // 같은 요청도 가끔 500이 오고 바로 다시 부르면 정상이라 (2026-11-18 확인) 한 번만 재시도한다
  if (res.status >= 500) {
    await new Promise((done) => setTimeout(done, 400));
    res = await fetch(url, { cache: "no-store" });
  }
  if (!res.ok) throw new Error(`온통청년 응답 ${res.status}`);
  const json = await res.json();
  const list = json?.result?.youthPolicyList;
  return Array.isArray(list) ? list : [];
}

// 정책 원본 묶음: 600건(100건 × 6쪽)을 한 번 받아 30분 동안 모든 사용자 조건에 함께 쓴다
let pool: { at: number; rows: Row[] } | null = null;
const POOL_PAGES = 6;

async function loadPool(key: string): Promise<Row[]> {
  if (pool && Date.now() - pool.at < 30 * 60 * 1000) return pool.rows;
  const pages = await Promise.allSettled(
    Array.from({ length: POOL_PAGES }, (_, i) => fetchPage(key, { pageNum: String(i + 1) }))
  );
  const rows = pages.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
  if (!rows.length) throw new Error("온통청년 정책을 받지 못했습니다");
  pool = { at: Date.now(), rows };
  return rows;
}

// 공식 원문 확인: 정책 이름으로 찾아 지원 내용과 수정일을 그대로 돌려준다
export async function officialYouth(key: string, name: string): Promise<Omit<OfficialRecord, "query" | "exact">[]> {
  const rows = await fetchPage(key, { plcyNm: name });
  return rows.map((r) => {
    const n = toNotice(r);
    const minAge = s(r.sprtTrgtMinAge);
    const maxAge = s(r.sprtTrgtMaxAge);
    return {
      source: "온통청년",
      name: n.name,
      org: n.org,
      updated: ymdOf(s(r.lastMdfcnDt, 20)),
      benefit: s(r.plcySprtCn || r.plcyExplnCn, 700),
      target: [
        s(r.sprtTrgtAgeLmtYn) !== "Y" && Number(minAge) && Number(maxAge) ? `만 ${minAge}~${maxAge}세` : "",
        s(r.addAplyQlfcCndCn, 500),
        s(r.earnEtcCn, 300),
        s(r.ptcpPrpTrgtCn, 300),
      ]
        .filter(Boolean)
        .join(" "),
      deadline: n.deadlineText,
      url: n.url,
    };
  });
}

// 대안 찾기: 키워드로 전체 정책(약 4천 건)을 검색하고 내 조건에 맞는 것만 남긴다
export async function searchYouth(key: string, q: YouthQuery, keywords: string[], limit = 6): Promise<Gov24Notice[]> {
  const pages = await Promise.allSettled(
    keywords.flatMap((kw) => [fetchPage(key, { plcyNm: kw }), fetchPage(key, { plcyExplnCn: kw })])
  );
  if (pages.every((p) => p.status === "rejected")) throw new Error("온통청년 검색 실패");
  const seen = new Set<string>();
  return pages
    .flatMap((p) => (p.status === "fulfilled" ? p.value : []))
    .filter((r) => {
      const no = s(r.plcyNo);
      if (!no || seen.has(no)) return false;
      seen.add(no);
      return !mentionsOtherSigungu(`${s(r.sprvsnInstCdNm)} ${s(r.operInstCdNm)} ${s(r.plcyNm)}`, q.sido, q.sigungu);
    })
    .map((r) => {
      const fit = scorePolicy(r, q);
      // 사업명에 검색어가 있으면 설명에만 있는 것보다 앞에 둔다
      const hit = keywords.filter((kw) => s(r.plcyNm).includes(kw)).length;
      return { r, fit, score: fit + hit * 3 };
    })
    .filter((x) => x.fit >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => toNotice(x.r))
    .filter((n) => n.id && n.name);
}

export async function recommendYouth(
  key: string,
  q: YouthQuery,
  opts?: { bypassCache?: boolean }
): Promise<Gov24Notice[]> {
  const cacheKey = JSON.stringify(q);
  const hit = !opts?.bypassCache ? cache.get(cacheKey) : undefined;
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;

  const seen = new Set<string>();
  const data = (await loadPool(key))
    .filter((r) => {
      const no = s(r.plcyNo);
      if (!no || seen.has(no)) return false;
      seen.add(no);
      return true;
    })
    .map((r) => {
      const notice = toNotice(r);
      const fit = scorePolicy(r, q);
      const related = relevanceScore(notice, q);
      return { notice, fit, related, score: fit + related * 2 };
    })
    .filter((x) => x.fit >= 0 && x.related >= 0 && x.notice.id && x.notice.name)
    .sort((a, b) => byDeadline(a.notice, b.notice) || b.score - a.score)
    .slice(0, 10)
    .map((x) => x.notice);
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
