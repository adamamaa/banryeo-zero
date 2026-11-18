"use client";

import React, { useState } from "react";
import { AlertTriangle, CalendarPlus, Check, CircleCheck, ExternalLink, FileText, MessageCircle, RefreshCw, Search, ShieldAlert, Sparkles, Wand2 } from "lucide-react";
import type { DocumentRecipe } from "@/data/policies";
import { nearMiss, limitNearMiss, type NearMissInput } from "@/lib/nearMiss";
import type { PolicyLimit } from "@/lib/card";
import { bestCombo, type BenefitCtx, type NeedKey } from "@/lib/benefits";
import type { Gov24Notice } from "@/lib/gov24";
import type { LiveNotices } from "@/components/SidebarRecs";
import { downloadIcs } from "@/lib/ics";
import { MEDIAN_INCOME_2026 } from "@/lib/standards";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const manwon = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만 원`;

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
  sample: { label: "예시 데이터", cls: "bg-amber-50 text-amber-800 ring-amber-600/25" },
  live: { label: "실시간 API", cls: "bg-purple-50 text-purple-700 ring-purple-600/20" },
};

function Head({ icon, title, desc, badge, action }: { icon: React.ReactNode; title: string; desc?: string; badge: "calc" | "sample" | "live"; action?: React.ReactNode }) {
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

export function NearMissCard({ profile }: { profile: NearMissInput }) {
  const r = nearMiss(profile);
  return (
    <Box target="triage-nearmiss">
      <Head icon={<Sparkles className="h-4 w-4" />} title="한 끗 차이 진단" desc={r.headline} badge="calc" />
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
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
        입력 조건을 바꾸면 바로 다시 계산합니다. 시연용 공고문 기준이며 최종 판정은 접수 기관이 합니다.
      </p>
    </Box>
  );
}

/* ② 받을 돈 최대 조합 */

export function BenefitCombo({
  ctx,
  sigungu,
  onNeed,
  onAsk,
  busy,
}: {
  ctx: BenefitCtx;
  sigungu: string;
  onNeed: (key: NeedKey) => void;
  onAsk: (q: string) => void;
  busy: boolean;
}) {
  const r = bestCombo(ctx);
  const region = [ctx.sido, sigungu].filter(Boolean).join(" ");
  return (
    <>
      <div
        data-agent-target="combo-total"
        className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white px-4 py-4 shadow-sm"
      >
        <div className="text-xs font-medium text-purple-700">겹치지 않게 고른 최대 조합 · 1년 기준</div>
        <div className="tnum mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {r.chosen.length ? `최대 ${won(r.total)}` : "아직 확정된 지원이 없어요"}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {r.chosen.length
            ? `${r.chosen.length}개 정책 · 같이 받을 수 없는 조합 ${r.dropped.length}개를 걸러냈어요`
            : r.unknown.length
            ? "아래 정보를 더 넣으면 받을 수 있는 지원을 계산해요"
            : "입력한 조건으로 받을 수 있는 예시 정책이 없어요"}
        </div>
      </div>

      <Box target="combo-list">
        <Head
          icon={<Sparkles className="h-4 w-4" />}
          title="받을 수 있는 지원"
          desc="정책 목록·금액·중복 규칙은 시연용 예시입니다. 신청 전 공고 원문을 확인하세요."
          badge="sample"
        />
        {r.chosen.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {r.chosen.map((b) => (
              <li key={b.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{b.name}</div>
                  <div className="text-xs text-slate-500">
                    {b.org} · {b.kind} · {b.amountText}
                  </div>
                </div>
                <span className="tnum shrink-0 text-[13px] font-semibold text-slate-900">{manwon(b.amount)}</span>
              </li>
            ))}
          </ul>
        )}

        {r.dropped.length > 0 && (
          <div className="border-t border-slate-100 bg-amber-50/40 px-4 py-3">
            <div className="text-xs font-semibold text-amber-800">같이 받을 수 없어서 뺀 정책</div>
            <ul className="mt-1.5 space-y-1.5">
              {r.dropped.map(({ b, because }) => (
                <li key={b.id} className="text-[13px] text-slate-700">
                  <span className="text-slate-400 line-through">{b.name}</span> ({manwon(b.amount)})
                  <span className="block text-xs text-slate-500">
                    중복 수령 불가 → 금액이 더 큰 &lsquo;{because.name}&rsquo; 선택. 둘 다 받으면 한쪽이 환수될 수 있어요.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {r.unknown.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="text-xs font-semibold text-slate-600">확인이 더 필요한 정책</div>
            <ul className="mt-1.5 space-y-1.5">
              {r.unknown.map(({ b, check }) => (
                <li key={b.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    <span className="text-slate-800">{b.name}</span>
                    <span className="block text-xs text-slate-500">{check.reason}</span>
                  </span>
                  {check.need && (
                    <button
                      type="button"
                      onClick={() => onNeed(check.need!)}
                      className="shrink-0 rounded-lg border border-purple-200 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50"
                    >
                      정보 입력
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {r.ineligible.length > 0 && (
          <details className="group border-t border-slate-100 px-4 py-3">
            <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 hover:text-slate-800">
              대상이 아닌 정책 {r.ineligible.length}개 보기
            </summary>
            <ul className="mt-2 space-y-1.5">
              {r.ineligible.map(({ b, check }) => (
                <li key={b.id} className="text-[13px]">
                  <span className="text-slate-500">{b.name}</span>
                  <span className="block text-xs text-slate-400">{check.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Box>

      {region && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAsk(`${region} 청년이 받을 수 있는 구청·시청 지원사업을 찾아 주세요. 위 조합과 중복되는지도 알려 주세요.`)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-medium text-slate-700 hover:border-purple-200 hover:bg-slate-50 disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" />
          {region} 자체 지원사업도 AI로 찾기
        </button>
      )}
    </>
  );
}

/* ③ 서류 유효기간 역산 캘린더 */

// 시연용 공고 기준 서류별 유효기간(신청일 기준)과 발급 소요일
const VALIDITY: Record<string, { days: number | null; lead: number; note: string }> = {
  "doc-rr": { days: 30, lead: 0, note: "신청일 기준 1개월 이내 발급분만 인정" },
  "doc-family": { days: 90, lead: 0, note: "신청일 기준 3개월 이내 발급분 인정" },
  "doc-lease": { days: null, lead: 1, note: "유효기간 없음. 확정일자가 없으면 주민센터·온라인에서 미리 받기 (당일~1일)" },
  "doc-bank": { days: 30, lead: 0, note: "가입확인서와 월세 이체내역 모두 최근 1개월분" },
};

const DAY = 24 * 3600 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]})`;

export function DocCalendar({ docs, policyTitle }: { docs: DocumentRecipe[]; policyTitle: string }) {
  const today = startOfDay(new Date());
  // 기본 제출일은 40일 뒤: 유효기간 1개월 서류는 "지금 떼면 만료"가 되는 상황을 바로 보여준다
  const [submitStr, setSubmitStr] = useState(() => toInput(addDays(today, 40)));
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(submitStr) ? new Date(`${submitStr}T00:00:00`) : addDays(today, 40);
  const submit = parsed < today ? today : parsed;
  const span = Math.max(1, diffDays(submit, today) + 1);

  const plan = docs.map((d) => {
    const v = VALIDITY[d.id] || { days: null, lead: 0, note: "유효기간 정보 없음" };
    const end = addDays(submit, -v.lead);
    const validFrom = v.days ? addDays(submit, -(v.days - 1)) : today;
    const from = validFrom > today ? validFrom : today;
    const tooLate = end < today;
    const wait = Boolean(v.days) && validFrom > today;
    let rec = v.days ? addDays(submit, -3) : today;
    if (rec < from) rec = from;
    if (rec > end) rec = end < from ? from : end;
    return { d, v, from, end, rec, wait, tooLate };
  });

  const pos = (day: Date) => (Math.min(span - 1, Math.max(0, diffDays(day, today))) / span) * 100;

  const exportIcs = () =>
    downloadIcs("공고패스_서류발급일정.ics", [
      ...plan.map((p) => ({
        date: p.rec,
        title: `공고패스 · ${p.d.title.replace(/\s*\(.*\)$/, "")} 발급`,
        desc: [`${policyTitle} 제출용`, p.v.note, ...p.d.checkboxOptions.map((c) => `□ ${c.label}`), p.d.issuerUrl].join("\n"),
      })),
      { date: submit, title: `공고패스 · ${policyTitle} 신청서 제출`, desc: "발급한 서류를 제출 탭에서 먼저 점검하세요." },
    ]);

  return (
    <Box target="recipe-timeline">
      <Head
        icon={<CalendarPlus className="h-4 w-4" />}
        title="언제 떼야 헛수고가 없을까"
        desc="제출일에서 거꾸로 계산해 유효기간이 지나지 않는 발급일을 잡아 드려요."
        badge="calc"
        action={
          <button
            type="button"
            onClick={exportIcs}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-purple-200 hover:bg-slate-50"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            캘린더에 넣기
          </button>
        }
      />
      <div className="space-y-4 p-4">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          제출 예정일
          <input
            type="date"
            min={toInput(today)}
            value={submitStr}
            onChange={(e) => setSubmitStr(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-[13px] text-slate-800 focus:border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-200"
          />
          <span className="text-slate-400">· 오늘부터 {span - 1}일</span>
        </label>

        <div className="space-y-3">
          {plan.map((p) => (
            <div key={p.d.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
                <span className="font-medium text-slate-900">{p.d.title.replace(/\s*\(.*\)$/, "")}</span>
                <span
                  className={`text-xs font-medium ${p.tooLate ? "text-red-700" : p.wait ? "text-amber-700" : "text-emerald-700"}`}
                >
                  {p.tooLate
                    ? "제출일이 너무 가까워요"
                    : p.wait
                    ? `${md(p.from)}부터 떼세요 · 추천 ${md(p.rec)}`
                    : `지금 떼도 돼요 · 추천 ${md(p.rec)}`}
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-slate-100">
                <span
                  className={`absolute top-0 h-full rounded-full ${p.wait ? "bg-amber-300/80" : "bg-emerald-300/80"}`}
                  style={{ left: `${pos(p.from)}%`, width: `${Math.max(2, pos(p.end) - pos(p.from) + 100 / span)}%` }}
                />
                <span
                  title={`추천 발급일 ${md(p.rec)}`}
                  className="absolute -top-0.5 h-3.5 w-1 rounded-full bg-purple-600"
                  style={{ left: `calc(${pos(p.rec)}% + ${50 / span}% - 2px)` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{p.v.note}</div>
            </div>
          ))}
        </div>

        <div className="flex justify-between text-[11px] text-slate-400">
          <span>오늘 {md(today)}</span>
          <span>제출 {md(submit)}</span>
        </div>
        {plan.some((p) => p.wait) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            노란 서류는 지금 떼면 제출일에 유효기간이 지나 다시 떼야 해요. 표시된 날짜 이후에 발급하세요.
          </p>
        )}
      </div>
    </Box>
  );
}

/* ⑤ 받은 뒤 환수 방어 */

const MONTHLY = 200_000;
const TOTAL_MONTHS = 12;

const OBLIGATIONS = [
  { title: "매달 월세 이체 기록 남기기", when: "매월", detail: "현금으로 내면 납부 증빙이 안 돼 지급이 멈출 수 있어요. 계좌이체로 내세요." },
  { title: "이사·재계약하면 변경 신고", when: "변동 시", detail: "주소나 보증금·월세가 바뀌면 바로 알려야 해요. 새 집도 요건을 충족해야 계속 받아요." },
  { title: "소득·재산 확인조사 대비", when: "정기", detail: "지원 중에도 소득을 다시 확인해요. 기준을 넘으면 다음 달부터 중지돼요." },
  { title: "다른 월세 지원과 겹치지 않기", when: "신청 전", detail: "주거급여·지자체 청년월세와 동시에 받으면 중복 수령으로 환수될 수 있어요." },
];

export function AfterCare({ profile, policyTitle }: { profile: NearMissInput | null; policyTitle: string }) {
  const [months, setMonths] = useState(6);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const remaining = (TOTAL_MONTHS - months) * MONTHLY;
  const received = months * MONTHLY;

  const max60 = Math.floor(MEDIAN_INCOME_2026[1] * 0.6);
  const income = profile ? profile.incomeManwon * 10000 : null;
  const incomeLine =
    income === null
      ? `월 소득이 기준(중위 60%, 월 ${won(max60)})을 넘으면 다음 확인조사 뒤 지급이 중지돼요.`
      : income > max60
      ? `지금 소득(월 ${won(income)})이 이미 기준(월 ${won(max60)})을 넘어요.`
      : `월 소득이 ${won(max60 - income + 1)}만 늘어도 기준(월 ${won(max60)})을 넘어 지급이 중지돼요.`;

  const scenarios = [
    {
      id: "move",
      label: "다른 집으로 이사해요",
      what: "이사 전에 변경 신청하면 계속 받을 수 있어요. 새 집도 보증금·월세 요건을 충족해야 해요.",
      todo: "새 계약서(확정일자)와 전입신고 후 등본으로 변경 신청",
      risk: remaining,
    },
    {
      id: "home",
      label: "부모님 집으로 들어가요",
      what: "부모님과 따로 산다는 요건이 깨져 지급이 중지돼요.",
      todo: "전입하기 전에 지원 중단 신청",
      risk: remaining,
    },
    {
      id: "income",
      label: "취업·이직으로 소득이 올라요",
      what: incomeLine,
      todo: "소득이 바뀐 달에 바로 신고",
      risk: remaining,
    },
    {
      id: "double",
      label: "다른 월세 지원도 받으려고 해요",
      what: "같은 목적의 지원을 겹쳐 받으면 이미 받은 금액까지 환수될 수 있어요.",
      todo: "'받을 돈' 탭에서 금액이 큰 쪽 하나만 신청",
      risk: received + remaining,
    },
  ];

  const exportIcs = () => {
    const now = new Date();
    downloadIcs("공고패스_수급관리알림.ics", [
      ...Array.from({ length: TOTAL_MONTHS }, (_, i) => ({
        date: new Date(now.getFullYear(), now.getMonth() + i + 1, 25),
        title: "공고패스 · 월세 계좌이체 확인",
        desc: `${policyTitle} 수급 유지: 이번 달 월세를 계좌이체로 냈는지 확인하세요.`,
      })),
      ...[3, 6, 9].map((m) => ({
        date: new Date(now.getFullYear(), now.getMonth() + m, 1),
        title: "공고패스 · 소득 변동 점검",
        desc: "소득이 바뀌었으면 신고하세요. 신고하지 않으면 받은 금액이 환수될 수 있어요.",
      })),
    ]);
  };

  return (
    <Box target="package-aftercare">
      <Head
        icon={<ShieldAlert className="h-4 w-4" />}
        title="받은 뒤 환수 방어"
        desc="지원금은 받은 뒤에도 조건을 지켜야 해요. 놓치면 돌려줘야 합니다."
        badge="sample"
        action={
          <button
            type="button"
            onClick={exportIcs}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-purple-200 hover:bg-slate-50"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            알림 넣기
          </button>
        }
      />
      <ul className="divide-y divide-slate-100">
        {OBLIGATIONS.map((o, i) => (
          <li key={o.title}>
            <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 text-[13px] hover:bg-slate-50">
              <input
                type="checkbox"
                checked={Boolean(checked[i])}
                onChange={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span className="min-w-0 flex-1">
                <span className={checked[i] ? "text-slate-400 line-through" : "font-medium text-slate-900"}>{o.title}</span>
                <span className="block text-xs text-slate-500">{o.detail}</span>
              </span>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{o.when}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">이런 일이 생기면?</span>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            지금까지 받은 개월
            <input
              type="range"
              min={1}
              max={TOTAL_MONTHS - 1}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="w-24 accent-purple-600"
            />
            <span className="tnum w-8 text-slate-800">{months}개월</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setOn((x) => ({ ...x, [s.id]: !x[s.id] }))}
              aria-pressed={Boolean(on[s.id])}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                on[s.id] ? "bg-purple-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-purple-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {scenarios
          .filter((s) => on[s.id])
          .map((s) => (
            <div key={s.id} className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-[13px]">
              <div className="font-medium text-slate-900">{s.label}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{s.what}</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-700">
                  <span className="font-medium text-purple-700">할 일</span> {s.todo}
                </span>
                <span className="tnum font-semibold text-red-700">신고 안 하면 환수 위험 최대 {won(s.risk)}</span>
              </div>
            </div>
          ))}
        {!Object.values(on).some(Boolean) && (
          <p className="text-xs text-slate-400">상황을 고르면 할 일과 환수 위험 금액을 계산해 드려요.</p>
        )}
      </div>
    </Box>
  );
}

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
                    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">상시·안내</span>
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
