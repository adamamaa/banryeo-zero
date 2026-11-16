// 개발 서버가 떠 있을 때 실행: node scripts/smoke.mjs
// 기준 수치·규칙 검수가 깨지면 실패한다.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const base = process.env.BASE_URL || "http://localhost:3000";
const post = async (path, body) =>
  (await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const set = (dir) =>
  readdirSync(`public/sample-docs/${dir}`).filter((f) => f.endsWith(".txt")).map((f) => ({
    fileName: f,
    mimeType: "text/plain",
    base64OrText: readFileSync(`public/sample-docs/${dir}/${f}`, "utf8"),
  }));
const risks = (r) => r.auditResult.findings.filter((f) => f.severity !== "pass");

const ex = await post("/api/agent/execute", {});
assert.equal(ex.tools.length, 9);
assert.equal(ex.summary.medianRatioPercent, 50.7); // 1,300,000 / 2,564,238
assert.equal(ex.summary.totalConvertedRentKRW, 795833); // 45,833 + 750,000
assert.equal(ex.summary.verdict, "eligible");

const over = await post("/api/agent/execute", { monthlyIncomeManwon: 200 });
assert.equal(over.summary.verdict, "ineligible"); // 78% > 60%
const young = await post("/api/agent/execute", { separateLivingMonths: 6 });
assert.equal(young.summary.verdict, "needs_parent_check");

const a = await post("/api/agent/run", { action: "ocr_audit_docs", uploadedDocs: set("A_미비세트") });
assert.equal(a.mode, "local_rules");
assert.equal(risks(a).length, 5, JSON.stringify(risks(a).map((f) => f.title)));
assert.ok(!JSON.stringify(a).includes("1234567"), "주민번호 뒷자리가 마스킹되지 않음");

const b = await post("/api/agent/run", { action: "ocr_audit_docs", uploadedDocs: set("B_보완세트") });
assert.equal(risks(b).length, 0, JSON.stringify(risks(b).map((f) => f.title)));
assert.ok(b.auditResult.crossCheckMatrix.every((m) => m.status === "pass"));

// 키 없는 채팅: 월세 조건 질문은 자격 계산, 그 밖의 질문은 일반 답변 경로
const chat = (userMessage) => post("/api/agent/run", { action: "agent_chat", apiKey: "", userMessage });
if (!process.env.GEMINI_API_KEY) {
  const rent = await chat("월세가 70만 원을 넘어도 받을 수 있나요?");
  assert.equal(rent.kind, "eligibility");
  assert.equal(rent.summary.medianRatioPercent, 50.7);
  const general = await chat("국민취업지원제도는 누가 신청할 수 있나요?");
  assert.equal(general.kind, "general");
  assert.equal(general.needsKey, true);
  assert.equal(general.summary, undefined);
}

console.log("smoke ok");
