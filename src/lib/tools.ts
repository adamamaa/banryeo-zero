// 각 도구 결과가 어디서 왔는지 화면에 그대로 표시한다.
// calc: 입력값으로 실제 계산 · live: 외부 API·AI 실시간 응답
export type ToolSource = "calc" | "live";

export interface ToolExecution {
  step: number;
  toolName: string;
  title: string;
  basis: string;
  url?: string;
  source: ToolSource;
  input: Record<string, string>;
  output: Record<string, string>;
  status: "done" | "warn";
}

export interface Gov24Service {
  name: string;
  org: string;
  summary: string;
  url: string;
}

// ponytail: 질문에서 주제어를 목록 대조로 고른다. 목록에 없는 주제는 "청년"으로 조회됨.
// 조회 품질이 부족하면 LLM 키워드 추출로 교체.
const TOPICS = [
  "월세", "전세", "주거", "취업", "구직", "일자리", "창업", "적금", "저축", "자산", "대출",
  "장학", "학자금", "교육", "훈련", "자격증", "면접", "교통", "문화", "건강", "심리", "출산", "육아", "결혼",
];
export const subsidyKeyword = (question: string) =>
  TOPICS.find((t) => question.includes(t)) || "청년";

export async function fetchGov24Services(key: string, keyword = "청년"): Promise<Gov24Service[]> {
  try {
    const url = new URL("https://api.odcloud.kr/api/gov24/v3/serviceList");
    url.searchParams.set("page", "1");
    url.searchParams.set("perPage", "5");
    url.searchParams.set("cond[서비스명::LIKE]", keyword);
    const res = await fetch(url, { headers: { Authorization: `Infuser ${key}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data || [])
      .filter((d: Record<string, string>) => d["서비스명"])
      .map((d: Record<string, string>) => ({
        name: String(d["서비스명"]),
        org: String(d["소관기관명"] || ""),
        summary: String(d["서비스목적요약"] || d["지원내용"] || "").slice(0, 200),
        url: /^https:\/\//.test(d["상세조회URL"] || "") ? d["상세조회URL"] : "",
      }));
  } catch {
    return [];
  }
}
