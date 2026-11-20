// 인스타그램 게시물 링크에서 캡션과 대본(음성을 글자로 바꾼 것)만 가져온다.
// 영상·이미지 파일은 받지도, AI로 보내지도 않는다. 가져오기는 Treg(API 게이트웨이)를 거쳐 ScrapeCreators API를 쓴다.
// 캡션: GET https://treg.to/call/scrapecreators.x.v1-instagram-post?url=<링크>
// 대본: GET https://treg.to/call/scrapecreators.x.v2-instagram-media-transcript?url=<링크> (음성 인식은 ScrapeCreators가 한다)

const TREG = "https://treg.to/call";
const POST_ID = "scrapecreators.x.v1-instagram-post";
const TRANSCRIPT_ID = "scrapecreators.x.v2-instagram-media-transcript";
// 같은 게시물을 하루 안에 다시 넣으면 Treg가 저장해 둔 실제 응답을 돌려준다 (호출 비용 0)
const CACHE = "1d";

export interface InstagramPost {
  url: string;
  kind: "reel" | "post";
  caption: string;
  transcript: string;
  postedAt?: string; // YYYY-MM-DD
  // 가져오지 못한 부분 (화면과 AI에 그대로 알린다)
  problems: string[];
}

// 질문 안의 인스타그램 게시물·릴스 링크 하나를 찾는다
export function findInstagramUrl(text: string): string | null {
  const m = (text || "").match(/https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  if (!m) return null;
  const kind = m[1] === "p" ? "p" : "reel";
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

async function callTreg(id: string, url: string, token: string, timeoutMs: number, signal?: AbortSignal) {
  const q = new URLSearchParams({ url, cache_max_age: CACHE });
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${TREG}/${id}?${q}`, {
    headers: { "X-Treg-Token": token, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return json;
}

// 응답 안에서 이름이 맞는 값을 깊이 우선으로 찾는다 (업체 응답 형식이 조금 달라도 동작하게)
function dig(obj: unknown, keys: string[], depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  for (const k of keys) if (k in (obj as Record<string, unknown>)) return (obj as Record<string, unknown>)[k];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const hit = dig(v, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+\n/g, "\n").trim().slice(0, max) : "");

export function parseCaption(json: unknown): { caption: string; postedAt?: string; isVideo?: boolean } {
  const media = (dig(json, ["xdt_shortcode_media", "shortcode_media"]) || json) as Record<string, unknown>;
  const edges = dig(media, ["edge_media_to_caption"]) as { edges?: { node?: { text?: string } }[] } | undefined;
  const caption =
    clean(edges?.edges?.[0]?.node?.text, 3000) ||
    clean((dig(media, ["caption"]) as { text?: string } | undefined)?.text, 3000) ||
    clean(dig(media, ["caption"]), 3000);
  const ts = Number(dig(media, ["taken_at_timestamp", "taken_at"]));
  const postedAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000 + 9 * 3600 * 1000).toISOString().slice(0, 10) : undefined;
  const isVideo = dig(media, ["is_video"]);
  return { caption, postedAt, isVideo: typeof isVideo === "boolean" ? isVideo : undefined };
}

export function parseTranscript(json: unknown): string {
  // 문서 예: { transcripts: [{ id, shortcode, text }] }. 말하는 사람이 없으면 null
  const list = dig(json, ["transcripts"]);
  if (Array.isArray(list)) {
    return clean(
      list
        .map((t) => (typeof t === "string" ? t : (t as { text?: unknown })?.text))
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .join("\n"),
      4000
    );
  }
  return clean(dig(json, ["transcript", "text"]), 4000);
}

// 캡션과 대본을 함께 가져온다. 하나가 실패해도 나머지는 쓴다.
export async function fetchInstagramPost(url: string, token: string, signal?: AbortSignal): Promise<InstagramPost> {
  const kind = /\/p\//.test(url) ? "post" : "reel";
  const problems: string[] = [];
  const [post, script] = await Promise.allSettled([
    callTreg(POST_ID, url, token, 20_000, signal),
    callTreg(TRANSCRIPT_ID, url, token, 45_000, signal),
  ]);
  const meta = post.status === "fulfilled" ? parseCaption(post.value) : { caption: "" };
  if (post.status === "rejected") problems.push(`캡션을 가져오지 못함 (${post.reason instanceof Error ? post.reason.message : "오류"})`);
  else if (!meta.caption) problems.push("캡션 없음");
  const transcript = script.status === "fulfilled" ? parseTranscript(script.value) : "";
  if (script.status === "rejected") problems.push(`대본을 가져오지 못함 (${script.reason instanceof Error ? script.reason.message : "오류"})`);
  else if (!transcript && kind === "reel") problems.push("대본 없음 (말소리가 없거나 인식하지 못함)");
  return { url, kind: meta.isVideo === false ? "post" : kind, caption: meta.caption, transcript, postedAt: meta.postedAt, problems };
}
