// 한국사회보장정보원 복지로 실시간 조회: 지자체복지서비스 + 중앙부처복지서비스. 응답은 XML.
// 지자체: https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist
//   serviceKey, pageNo, numOfRows, lifeArray(생애주기, 004=청년), ctpvNm(시도 정식 명칭), sggNm(시군구)
// 2026-11-18 실제 호출로 확인: servList 안에 servId·servNm·servDgst·ctpvNm·sggNm·bizChrDeptNm·aplyMtdNm·
//   lifeNmArray·trgterIndvdlNmArray·intrsThemaNmArray·sprtCycNm·srvPvsnNm·servDtlLink.
// 중앙부처: https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001 (callTp=L)
// 2026-11-20 실제 호출로 확인: servList 안에 servId·servNm·servDgst·jurMnofNm·jurOrgNm·lifeArray·trgterIndvdlArray·
//   intrsThemaArray·onapPsbltYn·sprtCycNm·srvPvsnNm·servDtlLink (이름에 Nm이 없고 시도·시군구가 없다).
//   상세 NationalWelfaredetailedV001 (callTp=D, servId) → tgtrDtlCn(지원 대상)·slctCritCn(선정 기준)·alwServCn(지원 내용)·
//   wlfareInfoOutlCn(개요, 모집기간이 들어 있기도 함)·crtrYr(기준 연도).
// 키는 공공데이터포털 일반 인증키(PUBLIC_DATA_API_KEY)를 같이 쓴다.
import type { Gov24Notice } from "./gov24";
import type { OfficialRecord } from "./officialFacts";
import { relevanceScore } from "./relevance";

const ENDPOINT = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist";
const CENTRAL = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001";

// 시도 → 복지로 정식 명칭 (광주·전남은 통합 명칭도 시도)
const CTPV: Record<string, string[]> = {
  서울: ["서울특별시"], 부산: ["부산광역시"], 대구: ["대구광역시"], 인천: ["인천광역시"],
  광주: ["광주광역시", "전남광주통합특별시"], 대전: ["대전광역시"], 울산: ["울산광역시"], 세종: ["세종특별자치시"],
  경기: ["경기도"], 강원: ["강원특별자치도"], 충북: ["충청북도"], 충남: ["충청남도"], 전북: ["전북특별자치도"],
  전남: ["전라남도", "전남광주통합특별시"], 경북: ["경상북도"], 경남: ["경상남도"], 제주: ["제주특별자치도"],
};

// 관심 분야 → 복지로 관심주제 이름에 들어가는 말
const THEME: Record<string, RegExp> = {
  주거: /주거/,
  "일자리·취업": /일자리/,
  창업: /일자리/,
  "금융·자산": /서민금융/,
  "교육·자격증": /교육/,
  "생활·복지": /생활지원/,
  "문화·여가": /문화/,
  "건강·심리": /건강/,
};

// 대상이 특정 집단인 서비스 → 필요한 우대 조건
const GROUP_ONLY: [RegExp, string[]][] = [
  [/장애/, ["장애인"]],
  [/한부모/, ["한부모 가정"]],
  [/다문화/, ["다문화 가정"]],
  [/저소득|기초생활|차상위/, ["기초생활수급", "차상위계층"]],
  [/보훈|국가유공/, ["국가유공자 가족"]],
];

type Item = Record<string, string>;

const decode = (v: string) =>
  v
    .replace(/&#13;/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

// 간단한 XML 파서: <servList>…</servList> 블록마다 <태그>값</태그>를 꺼낸다
export function parseServList(xml: string): Item[] {
  return Array.from(xml.matchAll(/<servList>([\s\S]*?)<\/servList>/g)).map((m) => {
    const item: Item = {};
    for (const t of Array.from(m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g))) item[t[1]] = decode(t[2]);
    return item;
  });
}

async function fetchList(key: string, params: Record<string, string>): Promise<Item[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("lifeArray", "004"); // 청년
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000); // 가끔 느려서 20초에서 끊는다
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!res.ok) throw new Error(`복지로 응답 ${res.status}`);
    return parseServList(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

async function getXml(url: URL, what: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!res.ok) throw new Error(`${what} 응답 ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 중앙부처 복지서비스 목록. 지자체 응답과 같은 필드 이름으로 맞춰 아래 거르기·점수 규칙을 그대로 쓴다.
async function fetchCentral(key: string, params: Record<string, string>, youthOnly = true): Promise<Item[]> {
  const url = new URL(`${CENTRAL}/NationalWelfarelistV001`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("callTp", "L");
  url.searchParams.set("pageNo", "1");
  if (youthOnly) url.searchParams.set("lifeArray", "004"); // 청년
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return parseServList(await getXml(url, "복지로 중앙부처")).map((x) => ({
    ...x,
    lifeNmArray: x.lifeArray || "",
    trgterIndvdlNmArray: x.trgterIndvdlArray || "",
    intrsThemaNmArray: x.intrsThemaArray || "",
    bizChrDeptNm: [x.jurMnofNm, x.jurOrgNm].filter(Boolean).join(" "),
    aplyMtdNm: x.onapPsbltYn === "Y" ? "복지로 온라인 신청 가능" : "",
  }));
}

const tagOf = (xml: string, name: string) => decode(xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] || "");

// 공식 원문 확인: 정책 이름으로 중앙부처 복지서비스를 찾아 상세(지원 대상·선정 기준·지원 내용)를 가져온다
export async function officialWelfare(key: string, name: string): Promise<Omit<OfficialRecord, "query" | "exact">[]> {
  const items = (await fetchCentral(key, { numOfRows: "5", searchWrd: name, srchKeyCode: "001" }, false)).slice(0, 2);
  const details = await Promise.allSettled(
    items.map((x) => {
      const url = new URL(`${CENTRAL}/NationalWelfaredetailedV001`);
      url.searchParams.set("serviceKey", key);
      url.searchParams.set("callTp", "D");
      url.searchParams.set("servId", x.servId);
      return getXml(url, "복지로 중앙부처 상세");
    })
  );
  return items.flatMap((x, i) => {
    const d = details[i];
    if (d.status !== "fulfilled") return [];
    const xml = d.value;
    const year = tagOf(xml, "crtrYr");
    const outline = tagOf(xml, "wlfareInfoOutlCn") || x.servDgst || "";
    return [
      {
        source: "복지로" as const,
        name: (tagOf(xml, "servNm") || x.servNm).slice(0, 60),
        org: (tagOf(xml, "jurMnofNm") || x.bizChrDeptNm).slice(0, 40),
        updated: /^20\d{2}$/.test(year) ? `${year}-01-01` : "",
        benefit: tagOf(xml, "alwServCn").slice(0, 700),
        target: [tagOf(xml, "tgtrDtlCn").slice(0, 500), tagOf(xml, "slctCritCn").slice(0, 300)].filter(Boolean).join(" "),
        deadline: (outline.match(/모집기간[^)\n]*/)?.[0] || "").slice(0, 80),
        url: /^https:\/\//.test(x.servDtlLink || "") ? x.servDtlLink : "https://www.bokjiro.go.kr",
      },
    ];
  });
}

export interface WelfareQuery {
  sido?: string;
  sigungu?: string;
  special?: string[];
  interests?: string[];
  marriage?: string;
  children?: string;
  job?: string;
  housing?: string;
}

const cache = new Map<string, { at: number; data: Gov24Notice[] }>();

// 대상 집단·가족 상황이 내 조건과 맞는지
const fitsMe = (x: Item, q: WelfareQuery) => {
  const mine = q.special || [];
  const who = `${x.trgterIndvdlNmArray || ""} ${x.servNm || ""}`;
  if (GROUP_ONLY.some(([re, need]) => re.test(who) && !need.some((n) => mine.includes(n)))) return false;
  // 미혼이고 자녀·임신이 없으면 난임·임신·출산·신혼 서비스는 뺀다
  const familyFree = q.marriage === "미혼" && (!q.children || q.children === "없음");
  return !(familyFree && /난임|임신|출산|신혼|산모|육아/.test(x.servNm || ""));
};

const toNotice = (x: Item): Gov24Notice => ({
  source: "welfare",
  id: x.servId,
  name: x.servNm.slice(0, 60),
  org: (x.bizChrDeptNm || [x.ctpvNm, x.sggNm].filter(Boolean).join(" ")).slice(0, 40),
  summary: (x.servDgst || "").slice(0, 160),
  target: [x.trgterIndvdlNmArray, x.intrsThemaNmArray].filter(Boolean).join(" · ").slice(0, 120),
  deadlineText: x.sprtCycNm ? `지원 주기: ${x.sprtCycNm}` : "",
  docs: [],
  applyAt: (x.aplyMtdNm || "").slice(0, 40),
  url: /^https:\/\//.test(x.servDtlLink || "") ? x.servDtlLink : "https://www.bokjiro.go.kr",
  // '서민금융'은 금융과 상관없는 서비스에도 붙어 있어 분야 판단에서 뺀다
  topics: (x.intrsThemaNmArray || "").replace(/서민금융/g, "").slice(0, 60),
});

// 대안 찾기: 서비스명·내용을 키워드로 검색한다 (시도 공통 사업, 내 시군구 사업, 중앙부처 사업)
export async function searchWelfare(key: string, q: WelfareQuery, keywords: string[], limit = 6): Promise<Gov24Notice[]> {
  const ctpvs = q.sido ? CTPV[q.sido] : undefined;
  const results = await Promise.allSettled([
    ...(ctpvs || []).flatMap((ctpvNm) =>
      keywords.map((searchWrd) => fetchList(key, { numOfRows: "20", ctpvNm, searchWrd, srchKeyCode: "003" }))
    ),
    ...keywords.map((searchWrd) => fetchCentral(key, { numOfRows: "20", searchWrd, srchKeyCode: "003" })),
  ]);
  if (!results.length) return [];
  if (results.every((r) => r.status === "rejected")) throw new Error("복지로 검색 실패");
  const seen = new Set<string>();
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((x) => {
      if (!x.servId || !x.servNm || seen.has(x.servId)) return false;
      seen.add(x.servId);
      return (!x.sggNm || !q.sigungu || x.sggNm === q.sigungu) && fitsMe(x, q);
    })
    .sort((a, b) => Number(b.sggNm === q.sigungu) - Number(a.sggNm === q.sigungu))
    .slice(0, limit)
    .map(toNotice);
}

export async function recommendWelfare(
  key: string,
  q: WelfareQuery,
  opts?: { bypassCache?: boolean }
): Promise<Gov24Notice[]> {
  const ctpvs = q.sido ? CTPV[q.sido] : undefined;
  const cacheKey = JSON.stringify(q);
  const hit = !opts?.bypassCache ? cache.get(cacheKey) : undefined;
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;

  // 중앙부처 사업은 사는 곳과 관계없이 함께 가져온다 (지자체 조회와 동시에)
  const centralP = fetchCentral(key, { numOfRows: "50" }).then(
    (v) => ({ ok: true, v }),
    () => ({ ok: false, v: [] as Item[] })
  );
  let items: Item[] = [];
  let anyOk = false;
  for (const ctpvNm of ctpvs || []) {
    const [localRes, sidoRes] = await Promise.allSettled([
      q.sigungu ? fetchList(key, { numOfRows: "30", ctpvNm, sggNm: q.sigungu }) : Promise.resolve([] as Item[]),
      fetchList(key, { numOfRows: "50", ctpvNm }),
    ]);
    const localOk = Boolean(q.sigungu) && localRes.status === "fulfilled";
    const sidoOk = sidoRes.status === "fulfilled";
    if (!localOk && !sidoOk) continue;
    anyOk = true;
    const local = localRes.status === "fulfilled" ? localRes.value : [];
    const sido = sidoRes.status === "fulfilled" ? sidoRes.value : [];
    // 시도 전체 목록에서는 시도 공통 사업(시군구 없음)과 내 시군구 사업만 남긴다
    items = [...local, ...sido.filter((x) => !x.sggNm || x.sggNm === q.sigungu)];
    if (items.length) break;
  }
  const central = await centralP;
  if (central.ok) anyOk = true;
  if (!anyOk) throw new Error("복지로 조회 실패");
  items = [...items, ...central.v];

  const seen = new Set<string>();
  const data = items
    .filter((x) => {
      if (!x.servId || seen.has(x.servId)) return false;
      seen.add(x.servId);
      return fitsMe(x, q);
    })
    .map((x) => {
      let score = 0;
      if (x.sggNm && x.sggNm === q.sigungu) score += 3; // 내 시군구 사업
      if (/^청년$|청년/.test(x.lifeNmArray || "") && !/중장년|노년/.test(x.lifeNmArray || "")) score += 1; // 청년 전용에 가까움
      if ((q.interests || []).some((i) => THEME[i]?.test(x.intrsThemaNmArray || ""))) score += 2;
      const notice = toNotice(x);
      const related = relevanceScore(notice, q);
      return { notice, related, score: score + related * 2 };
    })
    .filter((x) => x.related >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.notice);
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
