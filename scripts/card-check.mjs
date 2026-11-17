// node scripts/card-check.mjs — 카드 파서 점검 (서버 불필요)
import assert from "node:assert/strict";
import { parseCard, cardToText } from "../src/lib/card.ts";

const sites = [{ name: "고용24", url: "https://www.work24.go.kr", host: "work24.go.kr" }];
const reply = '```json\n{"summary":"만 15~69세 구직자","facts":[{"label":"대상","value":"15~69세"},{"label":"","value":"빈 라벨"}],"steps":["고용24 접속"],"links":[{"name":"고용24","url":"https://www.work24.go.kr/deep/fake"},{"name":"복지로","url":"https://www.bokjiro.go.kr/x/y"},{"name":"블로그","url":"https://blog.example.com"},{"name":"평문","url":"http://www.gov.kr"}],"caution":"","followUps":["수당은 얼마?"]}\n```';

const c = parseCard(reply, sites);
assert.equal(c.summary, "만 15~69세 구직자");
assert.equal(c.facts.length, 1); // 빈 라벨 제거
assert.deepEqual(c.links, [
  { name: "고용24", url: "https://www.work24.go.kr" }, // 등록 사이트는 등록 주소로
  { name: "복지로", url: "https://www.bokjiro.go.kr" }, // 정부 도메인은 첫 화면으로
]); // 비정부 도메인, http 제거
assert.equal(c.caution, undefined);
assert.ok(cardToText(c).includes("- 대상: 15~69세"));

assert.deepEqual(c.policies, []); // 없으면 빈 배열

const withPolicy = parseCard(JSON.stringify({
  summary: "s",
  policies: [
    { name: "국민취업지원제도", benefit: "월 60만×6개월", conditions: ["15~69세", ""], documents: [{ name: "주민등록등본", where: "정부24" }, "통장 사본", { name: "" }] },
    { name: "" },
  ],
}));
assert.equal(withPolicy.policies.length, 1); // 이름 없는 정책 제거
assert.deepEqual(withPolicy.policies[0].conditions, ["15~69세"]);
assert.deepEqual(withPolicy.policies[0].documents, [{ name: "주민등록등본", where: "정부24" }, { name: "통장 사본" }]);
assert.ok(cardToText(withPolicy).includes("다룬 정책: 국민취업지원제도"));

assert.equal(parseCard("그냥 글로 된 답변입니다."), null);
assert.equal(parseCard('{"summary":""}'), null);
assert.equal(parseCard("{깨진 json"), null);
console.log("card ok");
