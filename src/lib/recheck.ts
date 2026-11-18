// 알아서 다시 점검: 실시간 추천 공고나 내 조건이 바뀌면 새로 맞춘 공고와 7일 이내 마감을 알려 준다.
// Gemini를 부르지 않고 브라우저에서 규칙으로만 계산한다 (비용 없음).
import type { Gov24Notice } from "./gov24";

export type Verdict = "eligible" | "needs_parent_check" | "ineligible";

export interface Snapshot {
  noticeIds: string[]; // 실시간 추천 공고 id (source:id)
  verdict?: Verdict; // 월세 거주자일 때만 청년월세 판정 추적
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
const noticeId = (n: Gov24Notice) => `${n.source || "gov24"}:${n.id}`;

export function takeSnapshot(notices: Gov24Notice[], verdict?: Verdict): Snapshot {
  return {
    noticeIds: notices.map(noticeId),
    verdict,
    at: Date.now(),
  };
}

// 이전 점검과 비교해 새로 맞춘 실시간 공고, 판정 변동을 찾는다
export function diffSnapshots(prev: Snapshot, curr: Snapshot, notices: Gov24Notice[]): RecheckItem[] {
  const items: RecheckItem[] = [];
  if (Array.isArray(prev.noticeIds)) {
    const prevSet = new Set(prev.noticeIds);
    const added = notices.filter((n) => !prevSet.has(noticeId(n)));
    for (const n of added.slice(0, 2)) {
      items.push({
        kind: "new",
        title: `새로 맞는 실시간 공고: ${shortName(n.name)}`,
        detail: [n.org, n.deadlineText].filter(Boolean).join(" · "),
      });
    }
    if (added.length > 2) {
      items.push({
        kind: "new",
        title: `외 ${added.length - 2}건의 실시간 공고가 조건에 새로 맞아요`,
      });
    }
  }
  if (prev.verdict && curr.verdict && prev.verdict !== curr.verdict) {
    items.push({
      kind: "verdict",
      title: `청년월세 모의 판정이 바뀌었어요: ${VERDICT_LABEL[prev.verdict]} → ${VERDICT_LABEL[curr.verdict]}`,
    });
  }
  return items;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// 실시간 공고 중 접수 중이고 마감이 days일 안에 남은 것
export function upcomingDeadlines(notices: Gov24Notice[], today = new Date(), days = 7): RecheckItem[] {
  const t = startOfDay(today);
  return notices
    .filter((n) => n.applyEnd)
    .map((n) => {
      const end = new Date(`${n.applyEnd}T00:00:00`);
      const start = n.applyStart ? new Date(`${n.applyStart}T00:00:00`) : null;
      if (Number.isNaN(end.getTime())) return null;
      const left = Math.round((end.getTime() - t.getTime()) / 86400000);
      const open = !start || Number.isNaN(start.getTime()) || start <= t;
      return { n, left, open };
    })
    .filter((x): x is { n: Gov24Notice; left: number; open: boolean } => Boolean(x && x.open && x.left >= 0 && x.left <= days))
    .sort((a, b) => a.left - b.left)
    .map(({ n, left }) => ({
      kind: "deadline" as const,
      title: `마감 ${left === 0 ? "오늘" : `D-${left}`}: ${shortName(n.name)}`,
      detail: n.docs.length ? `필요 서류 ${n.docs.length}종을 미리 준비하세요.` : "신청처에서 일정을 확인하세요.",
    }));
}
