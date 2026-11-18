// 알아서 다시 점검: 내 정보가 바뀌거나 마감이 다가오면 자격·받을 수 있는 지원을 다시 계산해 바뀐 점을 알려 준다.
// Gemini를 부르지 않고 브라우저에서 규칙으로만 계산한다 (비용 없음).
import { BENEFITS, type BenefitCtx } from "./benefits";

export type Verdict = "eligible" | "needs_parent_check" | "ineligible";

export interface Snapshot {
  eligible: string[]; // 받을 수 있는 정책 id
  verdict?: Verdict; // 청년월세(시연 공고) 자격 판정
  at: number;
}

export interface RecheckItem {
  kind: "new" | "lost" | "verdict" | "deadline";
  title: string;
  detail?: string;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  eligible: "신청 대상",
  needs_parent_check: "부모님 소득 확인 필요",
  ineligible: "요건 미충족",
};

const shortName = (name: string) => name.replace(/\s*\(.*\)$/, "");

export function takeSnapshot(ctx: BenefitCtx, verdict?: Verdict): Snapshot {
  return {
    eligible: BENEFITS.filter((b) => b.check(ctx).status === "ok").map((b) => b.id),
    verdict,
    at: Date.now(),
  };
}

// 이전 점검과 비교해 새로 받을 수 있게 된 것, 빠진 것, 판정이 바뀐 것을 찾는다
export function diffSnapshots(prev: Snapshot, curr: Snapshot, ctx: BenefitCtx): RecheckItem[] {
  const items: RecheckItem[] = [];
  for (const id of curr.eligible.filter((x) => !prev.eligible.includes(x))) {
    const b = BENEFITS.find((x) => x.id === id);
    if (b) items.push({ kind: "new", title: `새로 받을 수 있어요: ${shortName(b.name)}`, detail: b.amountText });
  }
  for (const id of prev.eligible.filter((x) => !curr.eligible.includes(x))) {
    const b = BENEFITS.find((x) => x.id === id);
    if (b) items.push({ kind: "lost", title: `대상에서 빠졌어요: ${shortName(b.name)}`, detail: b.check(ctx).reason });
  }
  if (prev.verdict && curr.verdict && prev.verdict !== curr.verdict) {
    items.push({
      kind: "verdict",
      title: `청년월세 판정이 바뀌었어요: ${VERDICT_LABEL[prev.verdict]} → ${VERDICT_LABEL[curr.verdict]}`,
    });
  }
  return items;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// 받을 수 있는 정책 중 접수 중이고 마감이 days일 안에 남은 것
export function upcomingDeadlines(ctx: BenefitCtx, today = new Date(), days = 7): RecheckItem[] {
  const t = startOfDay(today);
  return BENEFITS.filter((b) => b.applyEnd && b.check(ctx).status === "ok")
    .map((b) => {
      const end = new Date(`${b.applyEnd}T00:00:00`);
      const start = b.applyStart ? new Date(`${b.applyStart}T00:00:00`) : null;
      const left = Math.round((end.getTime() - t.getTime()) / 86400000);
      return { b, left, open: !start || start <= t };
    })
    .filter((x) => x.open && x.left >= 0 && x.left <= days)
    .sort((a, b) => a.left - b.left)
    .map(({ b, left }) => ({
      kind: "deadline" as const,
      title: `마감 ${left === 0 ? "오늘" : `D-${left}`}: ${shortName(b.name)}`,
      detail: b.docs.length ? `필요 서류 ${b.docs.length}종을 미리 준비하세요.` : "신청처에서 바로 신청할 수 있어요.",
    }));
}
