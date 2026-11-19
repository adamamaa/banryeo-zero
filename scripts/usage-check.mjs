// node scripts/usage-check.mjs — Gemini 사용량 합산·비용 점검 (서버 불필요)
import assert from "node:assert/strict";
import { recordUsage, usageCost, withUsage } from "../src/lib/gemini.ts";

const logs = [];
const log = console.log;
console.log = (s) => logs.push(s);

await withUsage("test", async () => {
  // 일반 응답: 검색 쿼리는 groundingMetadata
  recordUsage({
    usageMetadata: { promptTokenCount: 10000, cachedContentTokenCount: 4000, toolUsePromptTokenCount: 1000, candidatesTokenCount: 500, thoughtsTokenCount: 1500 },
    candidates: [{ groundingMetadata: { webSearchQueries: ["a", "b"] } }],
  });
  await new Promise((r) => setTimeout(r, 5)); // await를 넘어도 같은 요청으로 모인다
  // 서버 도구 호출 응답: 검색 쿼리는 toolCall 파트
  recordUsage({
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 100 },
    candidates: [{ content: { parts: [{ toolCall: { toolType: "GOOGLE_SEARCH_WEB", args: { queries: ["c"] } } }] } }],
  });
  recordUsage({ candidates: [] }); // usageMetadata 없는 응답은 세지 않는다
});
recordUsage({ usageMetadata: { promptTokenCount: 999 } }); // withUsage 밖은 무시

console.log = log;
assert.equal(logs.length, 1);
const u = JSON.parse(logs[0].replace("[gemini-usage] ", ""));
assert.deepEqual(
  { calls: u.calls, input: u.input, cached: u.cached, output: u.output, thoughts: u.thoughts, searches: u.searches },
  { calls: 2, input: 13000, cached: 4000, output: 600, thoughts: 1500, searches: 3 }
);
// (9000×1.5 + 4000×0.075 + 2100×7.5) / 1e6 + 3×0.014
assert.equal(usageCost(u).toFixed(4), ((9000 * 1.5 + 4000 * 0.075 + 2100 * 7.5) / 1e6 + 0.042).toFixed(4));
assert.equal(u.usd, 0.0716);
console.log("usage-check ok", logs[0]);
