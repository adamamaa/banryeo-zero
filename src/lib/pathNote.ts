import type { EligibilitySummary } from "./eligibility";

// 되묻기 전에 이미 정해진 것을 알린다. 특례처럼 "또는"으로 갈리는 경로 중 일부가 미충족이면
// 남은 경로의 조건을 채워야만 받을 수 있다는 조건부 결론을 만든다 (예: 특례 불가 → 원가구 기준을 충족해야 함).
export function pathNote(s?: EligibilitySummary): string {
  if (!s || s.verdict !== "needs_check") return "";
  const bare = (label: string) => label.replace(/^\[[^\]]+\]\s*/, "");
  const groups = Array.from(new Set(s.checks.map((c) => c.group).filter((g): g is string => Boolean(g))));
  const inGroup = (g: string) => s.checks.filter((c) => c.group === g);
  const failed = groups.filter((g) => inGroup(g).some((c) => c.status === "fail"));
  const open = groups.filter((g) => !failed.includes(g));
  // 이미 통과한 경로가 있으면 다른 경로는 볼 필요가 없다
  if (!failed.length || !open.length || open.some((g) => inGroup(g).every((c) => c.status === "pass"))) return "";
  const why = failed.flatMap((g) => inGroup(g).filter((c) => c.status === "fail").map((c) => `${bare(c.label)}: ${c.mine}`));
  const need = open.flatMap((g) => inGroup(g).filter((c) => c.status !== "pass").map((c) => bare(c.label)));
  return `${s.policyName}: ${failed.join(", ")}에는 해당하지 않습니다 (${why.join(" / ")}). 그래서 ${open.join(", ")} 조건(${need.join(", ")})을 충족해야 받을 수 있고, 충족하지 못하면 받을 수 없습니다.`;
}
