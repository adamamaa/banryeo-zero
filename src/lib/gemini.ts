export const GEMINI_MODEL = "gemini-3.8-flash";

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

// Gemini SSE 스트리밍 호출: thinking(thought 파트)은 실시간 콜백으로 전달하고, 최종 텍스트와 출처를 반환한다.
export async function streamGemini(
  apiKey: string,
  body: Record<string, unknown>,
  onThought?: (thoughtText: string) => void,
  signal?: AbortSignal
): Promise<{ ok: true; text: string; sources: WebSource[] } | { ok: false; res: Response }> {
  const genCfg = (body.generationConfig as Record<string, unknown> | undefined) || {};
  const withThinking = {
    ...body,
    generationConfig: { ...genCfg, thinkingConfig: { includeThoughts: true } },
  };

  let res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(withThinking),
      signal,
    }
  );

  // 모델/파라미터가 thinkingConfig를 거부(400)하면 thinkingConfig 없이 재시도
  if (res.status === 400) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal,
      }
    );
  }

  if (!res.ok || !res.body) {
    return { ok: false, res };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let thought = "";
  const seen = new Set<string>();
  const sources: WebSource[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const chunk = JSON.parse(raw);
        const cand = chunk?.candidates?.[0];
        for (const p of cand?.content?.parts || []) {
          if (!p?.text) continue;
          if (p.thought) {
            thought += p.text;
            onThought?.(thought);
          } else {
            text += p.text;
          }
        }
        for (const c of cand?.groundingMetadata?.groundingChunks || []) {
          const url = String(c?.web?.uri || "");
          if (!/^https:\/\//.test(url) || seen.has(url)) continue;
          seen.add(url);
          sources.push({ title: String(c.web.title || new URL(url).hostname).slice(0, 80), url });
        }
      } catch {
        // 불완전 청크 무시
      }
    }
  }

  return { ok: true, text: text.trim(), sources: sources.slice(0, 8) };
}

// 실패 응답을 사용자가 조치할 수 있는 문장으로 바꾼다.
export async function geminiError(res: Response): Promise<string> {
  const msg = String((await res.json().catch(() => null))?.error?.message || "");
  if (res.status === 429 && /spend(ing)? cap/i.test(msg))
    return "Gemini 월 지출 한도를 초과했습니다. AI Studio(https://ai.studio/spend)에서 한도를 올리세요.";
  if (res.status === 429) return "Gemini 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
  if (res.status === 404) return `모델 '${GEMINI_MODEL}'을 찾을 수 없습니다. src/lib/gemini.ts의 모델명을 확인하세요.`;
  if (res.status === 400 && /api key/i.test(msg)) return "Gemini API 키가 올바르지 않습니다. 키를 다시 확인하세요.";
  if (res.status === 401 || res.status === 403) return "Gemini API 키 권한이 없습니다. 키와 프로젝트 설정을 확인하세요.";
  return `Gemini 호출 실패 (${res.status})`;
}

// 재시도해도 결과가 같은 오류 (한도·인증·모델명)
export const isFatalGeminiStatus = (s: number) => [401, 403, 404, 429].includes(s);

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
