// 추천 공고 관련성: 사용자 상황과 관련 있는 공고만 남긴다.
// 지역이 다르거나, 지금 상황으로 신청할 수 없거나, 개인이 신청하는 사업이 아니면 뺀다.
import { isOtherSidoOrg, mentionsOtherSigungu } from "../data/regions";
import type { Gov24Notice } from "./gov24";

export interface RelevanceProfile {
  sido?: string;
  sigungu?: string;
  job?: string;
  housing?: string;
  marriage?: string;
  children?: string;
  interests?: string[];
}

const TOPIC: Record<string, RegExp> = {
  주거: /주거|주택|월세|전세|임차|임대|보증금|이사|중개|거주지/,
  "일자리·취업": /일자리|취업|구직|채용|면접|인턴|직무|고용|커리어/,
  창업: /창업|스타트업|예비\s*창업/,
  "금융·자산": /금융|자산|저축|통장|적금|신용|대출|부채|재무/,
  "교육·자격증": /교육(비|과정|훈련|이용권)|평생교육|온라인교육|직업훈련|훈련|자격|시험|응시|어학|학자금|장학|평생학습|미래역량/,
  "생활·복지": /생활|복지|돌봄|식비|식사|교통|수당|취약계층|1인\s*가구/,
  "문화·여가": /문화|예술|공연|전시|체육|여가|여행/,
  "건강·심리": /건강|심리|마음|상담|의료|검진/,
};

// 지금 상황에서 자연스럽게 필요한 분야
const JOB_TOPICS: Record<string, string[]> = {
  "구직 중": ["일자리·취업", "교육·자격증"],
  "쉬는 중": ["일자리·취업", "생활·복지"],
  학생: ["교육·자격증"],
  "자영업·프리랜서": ["창업", "금융·자산"],
  "재직 중": ["금융·자산"],
};
const HOUSING_TOPICS: Record<string, string[]> = {
  월세: ["주거"],
  전세: ["주거"],
  "기숙사·고시원": ["주거"],
};

// 시설 운영·행사처럼 개인이 신청해 받는 지원이 아닌 사업
const OPERATION = /(운영|설치|조성|구축|지정|협의체)(\s*지원)?\s*(사업)?$/;
const PERSONAL_SERVICE = /서비스|프로그램|교육과정|학교|아카데미|바우처|상담|수당|장학/;
const NOT_PERSONAL = /예방교육|인식\s*개선|캠페인|축제|공모전|협의체|위탁|기관\s*지원|상권|활성화|^\(변경|^\(중지/;
// 특정 직종 종사자나 그 진입을 준비하는 사람을 위한 사업
const OTHER_TRADE = /창업농|영농|후계농|농업인|어업인|귀농|귀어/;
const FAMILY_ONLY = /신혼|결혼|난임|임신|출산|산후|산모|육아/;
// 일하고 있어야 신청할 수 있는 조건
const WORKER_ONLY = /재직자|재직\s*중|근로자|직장인|국민연금\s*가입자|고용보험\s*가입|사업자\s*등록/;
const NOT_WORKING = ["구직 중", "쉬는 중", "학생"];
// 일하지 않아야 신청할 수 있는 사업
const JOBSEEKER_ONLY = /구직활동|구직\s*지원|미취업/;
const WORKING = ["재직 중", "자영업·프리랜서"];

const dayAfter = (today: Date, days: number) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const wantedTopics = (p: RelevanceProfile) => ({
  picked: (p.interests || []).filter((t) => TOPIC[t]),
  situation: [...(JOB_TOPICS[p.job || ""] || []), ...(HOUSING_TOPICS[p.housing || ""] || [])],
});

// 관련 없으면 -1, 관련 있으면 맞는 정도 (관심 분야 2점, 상황 1점)
export function relevanceScore(n: Gov24Notice, p: RelevanceProfile, today = new Date()) {
  const where = `${n.org} ${n.name}`;
  if (isOtherSidoOrg(n.org, p.sido) || mentionsOtherSigungu(where, p.sido, p.sigungu)) return -1;
  // 한 달 안에 시작하지 않는 공고는 아직 신청할 수 없다
  if (n.applyStart && n.applyStart > dayAfter(today, 30)) return -1;
  if (NOT_PERSONAL.test(n.name) || OTHER_TRADE.test(n.name)) return -1;
  if (OPERATION.test(n.name) && !PERSONAL_SERVICE.test(n.name)) return -1;

  const familyFree = p.marriage === "미혼" && (!p.children || p.children === "없음");
  if (familyFree && FAMILY_ONLY.test(n.name)) return -1;
  if (NOT_WORKING.includes(p.job || "") && WORKER_ONLY.test(`${n.name} ${n.target} ${n.topics || ""}`)) return -1;
  if (WORKING.includes(p.job || "") && JOBSEEKER_ONLY.test(n.name)) return -1;

  const { picked, situation } = wantedTopics(p);
  if (!picked.length && !situation.length) return 0;
  // 요약문은 넓게 걸리므로 공고 이름과 분류로만 판단한다
  const text = `${n.name} ${n.topics || ""}`;
  const hit = (t: string) => TOPIC[t].test(text);
  const score = picked.filter(hit).length * 2 + Array.from(new Set(situation)).filter(hit).length;
  return score > 0 ? score : -1;
}
