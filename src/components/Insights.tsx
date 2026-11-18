"use client";

import React from "react";
import { AlertTriangle, CircleCheck, ExternalLink, FileText, MessageCircle, RefreshCw, ShieldAlert, Sparkles, Wand2 } from "lucide-react";
import { limitNearMiss, type NearMissInput } from "@/lib/nearMiss";
import type { PolicyLimit } from "@/lib/card";
import { deadlineKind } from "@/lib/deadline";
import type { Gov24Notice } from "@/lib/gov24";
import type { LiveNotices } from "@/components/SidebarRecs";

function Box({ target, children }: { target?: string; children: React.ReactNode }) {
  return (
    <section
      data-agent-target={target}
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      {children}
    </section>
  );
}

const BADGE_STYLE = {
  calc: { label: "실계산", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  live: { label: "실시간 API", cls: "bg-purple-50 text-purple-700 ring-purple-600/20" },
};

function Head({ icon, title, desc, badge, action }: { icon: React.ReactNode; title: string; desc?: string; badge: "calc" | "live"; action?: React.ReactNode }) {
  const b = BADGE_STYLE[badge];
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-purple-100/70 text-purple-700">{icon}</span>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">
            {title}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${b.cls}`}>
              {b.label}
            </span>
          </h3>
          {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ① 한 끗 차이 진단 */

const KIND_STYLE = {
  fail: { label: "미충족", cls: "bg-red-50 text-red-700 ring-red-200", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  fix: { label: "이렇게 바꾸면", cls: "bg-purple-50 text-purple-700 ring-purple-200", icon: <Wand2 className="h-3.5 w-3.5" /> },
  risk: { label: "아슬아슬", cls: "bg-amber-50 text-amber-800 ring-amber-200", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  margin: { label: "여유", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: <CircleCheck className="h-3.5 w-3.5" /> },
};

// 채팅에서 고른 정책용 한 끗 차이 진단: AI가 정리한 숫자 조건(limits)과 내 정보를 비교한다
export function PolicyNearMissCard({
  policyName,
  limits,
  profile,
}: {
  policyName: string;
  limits?: PolicyLimit[];
  profile: Partial<Record<keyof NearMissInput, number | null>>;
}) {
  if (!limits?.length) return null;
  const r = limitNearMiss(limits, profile);
  const fails = r.items.filter((x) => x.kind === "fail" || x.kind === "fix").length;
  return (
    <Box target="policy-nearmiss">
      <Head
        icon={<Sparkles className="h-4 w-4" />}
        title="한 끗 차이 진단"
        desc={
          !r.items.length
            ? "내 정보를 입력하면 숫자 조건과 비교해 드려요"
            : fails
            ? `${policyName} · 바꾸면 되는 조건 ${fails}개`
            : `${policyName} · 숫자 조건을 모두 충족해요`
        }
        badge="calc"
      />
      {r.items.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {r.items.map((it, i) => {
            const s = KIND_STYLE[it.kind];
            return (
              <li key={i} className="flex gap-3 px-4 py-3 text-[13px]">
                <span className={`mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium ring-1 ${s.cls}`}>
                  {s.icon}
                  {it.area}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{it.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{it.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
        AI가 정리한 숫자 기준으로 계산합니다{r.missing ? ` · 내 정보가 없어 ${r.missing}개 조건은 건너뜀` : ""}. 중위소득은 1인 가구 기준이며 최종 판정은 접수 기관이 합니다.
      </p>
    </Box>
  );
}

const DAY = 24 * 3600 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const diffDays = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
/* ⑥ 실시간 맞춤 공고 (오른쪽 패널용) */

const SOURCE_NAME: Record<NonNullable<Gov24Notice["source"]>, string> = {
  youth: "온통청년",
  welfare: "복지로",
  gov24: "보조금24",
};

const noticeDday = (applyEnd?: string) => {
  if (!applyEnd) return null;
  const end = new Date(`${applyEnd}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const now = startOfDay(new Date());
  const d = diffDays(end, now);
  return d < 0 ? null : d === 0 ? "오늘 마감" : `D-${d}`;
};

export function LiveBenefitsPanel({
  live,
  onAsk,
  onRefresh,
  busy,
}: {
  live: LiveNotices;
  onAsk: (q: string) => void;
  onRefresh?: () => void;
  busy: boolean;
}) {
  const notices = live.notices;
  const sources = live.sources?.length ? live.sources.join(" · ") : "온통청년 · 복지로 · 보조금24";
  return (
    <Box target="live-benefits">
      <Head
        icon={<Sparkles className="h-4 w-4" />}
        title="내 조건 맞춤 실시간 지원"
        desc={
          live.status === "loading" && !notices.length
            ? "공공 API에서 내 조건에 맞는 공고를 찾는 중..."
            : live.status === "ok"
            ? `${sources} 기준 ${notices.length}건`
            : live.status === "no_key"
            ? "공공 API 키를 설정하면 실시간 맞춤 공고가 표시됩니다."
            : live.status === "error"
            ? "실시간 공고를 불러오지 못했습니다."
            : "내 정보를 바탕으로 실시간 공고를 찾습니다."
        }
        badge="live"
        action={
          onRefresh &&
          live.status !== "loading" && (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-purple-200 hover:bg-slate-50"
            >
              <RefreshCw className="h-3 w-3" />
              새로고침
            </button>
          )
        }
      />

      {live.status === "loading" && !notices.length ? (
        <div className="space-y-2 p-4">
          <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : notices.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-slate-500">
          {live.status === "error"
            ? "일시적인 오류로 조회하지 못했어요. 잠시 후 새로고침을 눌러 보세요."
            : "지금 조건에 맞는 실시간 공고가 없어요. 왼쪽 정보 태그에서 조건을 넓혀 보세요."}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {notices.map((n) => {
            const dday = noticeDday(n.applyEnd);
            const src = SOURCE_NAME[n.source || "gov24"];
            return (
              <li key={`${n.source || "gov24"}:${n.id}`} className="space-y-1.5 px-4 py-3 text-[13px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{n.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {n.org} · {src}
                      {n.deadlineText ? ` · ${n.deadlineText}` : ""}
                    </div>
                  </div>
                  {dday ? (
                    <span className="tnum shrink-0 rounded-md bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700">
                      {dday}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                      {deadlineKind(n) === "always" ? "상시" : "기간 확인"}
                    </span>
                  )}
                </div>
                {n.summary && <p className="line-clamp-2 text-xs leading-relaxed text-slate-600">{n.summary}</p>}
                <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onAsk(`${n.name} (${n.org}) 신청 자격, 기간, 필요 서류를 내 조건 기준으로 정리해 주세요.`)
                    }
                    className="inline-flex items-center gap-1 font-medium text-purple-700 hover:underline disabled:opacity-50"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    자격·서류 분석하기
                  </button>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
                  >
                    신청처 <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
        공고 원문을 눌러 세부 요건을 확인하세요. &lsquo;자격·서류 분석하기&rsquo;를 누르면 조건 판독과 서류 체크리스트가 생성됩니다.
      </p>
    </Box>
  );
}

export function LiveDocsPanel({
  notices,
  onAsk,
  busy,
}: {
  notices: Gov24Notice[];
  onAsk: (q: string) => void;
  busy: boolean;
}) {
  const withDocs = notices.filter((n) => n.docs.length > 0);
  if (!withDocs.length) return null;
  return (
    <Box target="live-docs">
      <Head
        icon={<FileText className="h-4 w-4" />}
        title="실시간 추천 공고 구비서류"
        desc="공고 데이터에서 추출한 제출 서류 목록입니다. 분석하기로 발급처·검수 기준까지 채울 수 있어요."
        badge="live"
      />
      <ul className="divide-y divide-slate-100">
        {withDocs.map((n) => (
          <li key={`${n.source || "gov24"}:${n.id}`} className="space-y-2 px-4 py-3 text-[13px]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{n.name}</div>
                <div className="text-xs text-slate-500">{n.org}</div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onAsk(`${n.name} (${n.org}) 신청 자격, 기간, 필요 서류와 발급 방법을 정리해 주세요.`)
                }
                className="shrink-0 rounded-lg border border-purple-200 bg-purple-50/70 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              >
                자세히 분석
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {n.docs.map((doc) => (
                <span key={doc} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                  {doc}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Box>
  );
}
