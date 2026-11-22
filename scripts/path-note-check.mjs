// node scripts/path-note-check.mjs — 되묻기 앞 조건부 결론(pathNote) 점검 (서버 불필요)
import assert from "node:assert/strict";
import { pathNote } from "../src/lib/pathNote.ts";

const check = (label, status, mine, group) => ({ label: group ? `[${group}] ${label}` : label, mine, status, basis: "원문", group });
const base = (checks, verdict = "needs_check") => ({ policyName: "청년월세 지원사업", verdict, checks, others: [], basis: "", percents: [] });

// P04: 특례 둘 다 미충족, 원가구 기준만 모름 → 조건부 결론
const p04 = base([
  check("만 19~34세", "pass", "만 24세"),
  check("원가구 중위소득 100% 이하", "unknown", "정보 없음", "원가구 기준"),
  check("만 30세 이상", "fail", "만 24세", "30세 이상 특례"),
  check("본인 소득 중위소득 50% 이상", "fail", "공제 후 27.3%", "30세 미만 독립 특례"),
]);
const note = pathNote(p04);
assert.match(note, /30세 이상 특례, 30세 미만 독립 특례에는 해당하지 않습니다/);
assert.match(note, /본인 소득 중위소득 50% 이상: 공제 후 27\.3%/);
assert.match(note, /원가구 기준 조건\(원가구 중위소득 100% 이하\)을 충족해야/);

// 통과한 경로가 있거나, 실패한 경로가 없거나, 이미 불가면 붙이지 않는다
assert.equal(pathNote(base([check("만 30세 이상", "pass", "만 31세", "30세 이상 특례"), check("원가구 중위소득 100% 이하", "unknown", "정보 없음", "원가구 기준")])), "");
assert.equal(pathNote(base([check("원가구 중위소득 100% 이하", "unknown", "정보 없음", "원가구 기준")])), "");
assert.equal(pathNote({ ...p04, verdict: "ineligible" }), "");
assert.equal(pathNote(undefined), "");
console.log("path-note-check ok\n" + note);
