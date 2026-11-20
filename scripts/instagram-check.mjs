// node scripts/instagram-check.mjs — 인스타그램 링크 인식과 캡션·대본 해석 점검
// .env.local에 TREG_API_KEY가 있으면 실제 릴스·게시물도 가져와 본다 (호출당 약 $0.002, 하루 캐시 적중 시 0)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findInstagramUrl, parseCaption, parseTranscript, fetchInstagramPost } from "../src/lib/instagram.ts";

// 1. 링크 인식: 질문 안의 게시물·릴스 링크를 표준 주소로 바꾼다
assert.equal(findInstagramUrl("이거 받을 수 있어? https://www.instagram.com/reel/De0ixlMBub4/?igsh=abc"), "https://www.instagram.com/reel/De0ixlMBub4/");
assert.equal(findInstagramUrl("https://instagram.com/p/DfoIsuYiSJ0"), "https://www.instagram.com/p/DfoIsuYiSJ0/");
assert.equal(findInstagramUrl("https://www.instagram.com/weareyouth_kr/reel/De0ixlMBub4/"), "https://www.instagram.com/reel/De0ixlMBub4/");
assert.equal(findInstagramUrl("https://www.instagram.com/reels/De0ixlMBub4/"), "https://www.instagram.com/reel/De0ixlMBub4/");
assert.equal(findInstagramUrl("https://www.instagram.com/weareyouth_kr/"), null); // 계정 주소는 게시물이 아니다
assert.equal(findInstagramUrl("청년월세 받을 수 있어?"), null);

// 2. 캡션 해석: ScrapeCreators 문서의 응답 형식 (data.xdt_shortcode_media)
const post = {
  success: true,
  data: {
    xdt_shortcode_media: {
      __typename: "XDTGraphVideo",
      is_video: true,
      taken_at_timestamp: 1759795200, // 2026-10-07 09:00 KST
      edge_media_to_caption: { edges: [{ node: { text: "2026 청년정책 공모전\n접수 2026.10.7~10.30" } }] },
    },
  },
};
const c = parseCaption(post);
assert.equal(c.caption, "2026 청년정책 공모전\n접수 2026.10.7~10.30");
assert.equal(c.isVideo, true);
assert.match(c.postedAt, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(parseCaption({ data: {} }).caption, "");

// 3. 대본 해석: transcripts[].text, 말소리가 없으면 null
assert.equal(parseTranscript({ success: true, transcripts: [{ id: "1", shortcode: "x", text: "청년이라면 지금 신청하세요" }] }), "청년이라면 지금 신청하세요");
assert.equal(parseTranscript({ transcripts: [{ text: "첫째" }, { text: null }, { text: "둘째" }] }), "첫째\n둘째");
assert.equal(parseTranscript({ success: true, transcripts: null }), "");
assert.equal(parseTranscript({ transcript: "단일 문자열 형식" }), "단일 문자열 형식");
// 2026-11-20 실제 응답: 말소리 없는 릴스는 text: null
assert.equal(parseTranscript({ success: true, transcripts: [{ id: "4013986108659918584", shortcode: "De0ixlMBub4", text: null, transcript_with_timestamp: null }] }), "");
console.log("instagram-check offline ok");

// 4. 실제 호출 (키가 있을 때만)
let token = process.env.TREG_API_KEY || "";
try {
  const m = readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^TREG_API_KEY=(.+)$/m);
  if (!token && m) token = m[1].trim();
} catch {}
if (!token) {
  console.log("TREG_API_KEY가 없어 실제 호출은 건너뜀 (.env.local에 넣으면 실행)");
} else {
  const urls = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["https://www.instagram.com/reel/De0ixlMBub4/", "https://www.instagram.com/p/DfoIsuYiSJ0/"];
  for (const raw of urls) {
    const url = findInstagramUrl(raw) || raw;
    const t0 = Date.now();
    const r = await fetchInstagramPost(url, token);
    console.log(
      JSON.stringify(
        {
          url,
          kind: r.kind,
          postedAt: r.postedAt,
          caption: r.caption.slice(0, 120),
          transcript: r.transcript.slice(0, 200),
          transcriptNote: r.transcriptNote,
          problems: r.problems,
          seconds: ((Date.now() - t0) / 1000).toFixed(1),
        },
        null,
        2
      )
    );
  }
}
