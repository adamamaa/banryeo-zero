export const GEMINI_MODEL = "gemini-4-hydrogen";

// 키는 URL이 아니라 헤더로 보낸다 (URL 쿼리는 서버·프록시 로그에 남는다).
export function callGemini(apiKey: string, body: Record<string, unknown>) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    }
  );
}

export interface WebSource {
  title: string;
  url: string;
}

// 답변 본문과, 구글 검색 그라운딩을 썼다면 그 출처 목록을 함께 꺼낸다.
export async function geminiParse(res: Response): Promise<{ text: string; sources: WebSource[] }> {
  const cand = (await res.json())?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .map((p: { text?: string }) => p.text || "")
    .join("")
    .trim();
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const c of cand?.groundingMetadata?.groundingChunks || []) {
    const url = String(c?.web?.uri || "");
    if (!/^https:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: String(c.web.title || new URL(url).hostname).slice(0, 80), url });
  }
  return { text, sources: sources.slice(0, 8) };
}

export const geminiText = async (res: Response) => (await geminiParse(res)).text;

export function maskPii(text: string) {
  let count = 0;
  const masked = (text || "")
    // 주민등록번호 뒷자리
    .replace(/(\d{6})-([1-4])\d{6}/g, (_, a, b) => (count++, `${a}-${b}******`))
    // 휴대전화
    .replace(/\b(01\d)-(\d{3,4})-(\d{4})\b/g, (_, a, _b, c) => (count++, `${a}-****-${c}`))
    // 계좌번호 (숫자-숫자-숫자, 총 10자리 이상)
    .replace(/\b\d{2,6}-\d{2,6}-\d{4,8}\b/g, (m) =>
      m.replace(/\D/g, "").length >= 10 && !/^01\d-/.test(m) ? (count++, "***-***-******") : m
    );
  return { masked, count };
}
