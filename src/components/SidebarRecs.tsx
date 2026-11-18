"use client";

import React, { useEffect, useState } from "react";
import { Bell, BellRing, CalendarPlus, ExternalLink, FileText, Megaphone, MessageCircle, Plus, X } from "lucide-react";
import { BENEFITS, bestCombo, type Benefit, type BenefitCtx } from "@/lib/benefits";
import { downloadIcs } from "@/lib/ics";
import { guessValidDays, type Gov24Notice } from "@/lib/gov24";

// 보조금24 실시간 공고 조회 상태 (page에서 받아 온다)
export interface LiveNotices {
  status: "idle" | "loading" | "ok" | "no_key" | "error";
  notices: Gov24Notice[];
  // 연결된 출처 (보조금24, 온통청년)
  sources?: string[];
}

// 알림 일정을 만드는 데 필요한 공고 정보 (예시 정책과 실시간 공고 공통)
type AlarmSource = Pick<Benefit, "id" | "name" | "applyStart" | "applyEnd" | "url" | "docs">;

const liveId = (n: Gov24Notice) => `${n.source || "gov24"}:${n.id}`;
const sourceLabel = (n?: Gov24Notice) => (n?.source === "youth" ? "온통청년" : n?.source === "welfare" ? "복지로" : "보조금24");
const liveToBenefit = (n: Gov24Notice): Benefit => ({
  id: liveId(n),
  name: n.name,
  org: n.org,
  amount: 0,
  amountText: n.summary || "지원 내용은 신청처에서 확인하세요",
  kind: "현금",
  conflicts: [],
  check: () => ({ status: "ok", reason: `${sourceLabel(n)} 실시간 공고` }),
  applyStart: n.applyStart,
  applyEnd: n.applyEnd,
  url: n.url,
  docs: n.docs.map((d) => ({ name: d, validDays: guessValidDays(d) })),
});

// 왼쪽 사이드바: 내 정보 기반 추천 공고 + 공고(마감)·서류(발급일) 알림.
// 알림 설정은 브라우저(localStorage)에만 저장하고, 사이트가 열려 있으면 브라우저 알림을 띄운다.
// 사이트를 닫아도 받으려면 '캘린더에 넣기'(.ics)로 휴대폰·구글 캘린더에 등록한다.

type AlarmKind = "deadline" | "docs";
// 실시간 공고는 목록이 바뀌어도 알림이 유지되게 공고 정보(src)를 함께 저장한다
type Prefs = Record<string, Partial<Record<AlarmKind, boolean>> & { src?: AlarmSource }>;

interface AlarmEvent {
  id: string;
  benefitId: string;
  kind: AlarmKind;
  date: Date;
  title: string;
  desc: string;
}

const PREFS_KEY = "gonggopass_alarms";
const SEEN_KEY = "gonggopass_alarm_seen";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parse = (s?: string) => (s ? new Date(`${s}T00:00:00`) : null);
const diff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

const dday = (d: Date, today: Date) => {
  const n = diff(d, today);
  return n === 0 ? "오늘" : n > 0 ? `D-${n}` : `D+${-n}`;
};

// 공고 하나에 대해 켜 둔 알림의 일정을 만든다
function eventsFor(b: AlarmSource, pref: Partial<Record<AlarmKind, boolean>>, today: Date): AlarmEvent[] {
  const out: AlarmEvent[] = [];
  const start = parse(b.applyStart);
  const end = parse(b.applyEnd);
  const short = b.name.replace(/\s*\(.*\)$/, "");

  if (pref.deadline && end) {
    const marks: [Date | null, string][] = [
      [start, "신청 시작"],
      [addDays(end, -3), "마감 3일 전"],
      [addDays(end, -1), "마감 하루 전"],
    ];
    for (const [date, label] of marks) {
      if (!date || date < today) continue;
      out.push({
        id: `${b.id}:deadline:${ymd(date)}`,
        benefitId: b.id,
        kind: "deadline",
        date,
        title: `${short} ${label}`,
        desc: `신청 기간 ${b.applyStart ?? "상시"} ~ ${b.applyEnd}. 신청처: ${b.url}`,
      });
    }
  }

  if (pref.docs) {
    // 마감 3일 전 제출을 목표로, 유효기간 안에 들어오는 가장 늦은 날(제출 3일 전)에 발급하도록 잡는다
    const submit = end ? addDays(end, -3) : addDays(today, 14);
    for (const doc of b.docs) {
      let date = doc.validDays ? addDays(submit, -3) : today;
      const validFrom = doc.validDays ? addDays(submit, -(doc.validDays - 1)) : today;
      if (date < validFrom) date = validFrom;
      if (date < today) date = today;
      out.push({
        id: `${b.id}:docs:${doc.name}`,
        benefitId: b.id,
        kind: "docs",
        date,
        title: `${doc.name} 발급 (${short})`,
        desc: doc.validDays
          ? `신청일 기준 ${doc.validDays}일 이내 발급분만 인정돼요. 이날 이전에 떼면 제출 때 만료될 수 있어요.`
          : "유효기간은 없지만 미리 준비해 두세요.",
      });
    }
  }
  return out;
}

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function SidebarRecs({
  ctx,
  hasInfo,
  onStartInfo,
  onAsk,
  busy,
  search,
  live,
}: {
  ctx: BenefitCtx;
  hasInfo: boolean;
  onStartInfo: () => void;
  onAsk: (q: string) => void;
  busy: boolean;
  search: string;
  live?: LiveNotices;
}) {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const today = startOfDay(new Date());

  useEffect(() => {
    setPrefs(loadJson<Prefs>(PREFS_KEY, {}));
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  // 추천: 받을 수 있는 정책 중 마감 안 지난 것. 겹치는 정책은 '중복 주의'로 뒤에 둔다
  const combo = hasInfo ? bestCombo(ctx) : null;
  const notExpired = (b: Benefit) => !b.applyEnd || parse(b.applyEnd)! >= today;
  // 보조금24 실시간 공고를 맨 위에, 그다음 예시 정책 조합
  const liveNotices = hasInfo && live?.status === "ok" ? live.notices : [];
  const liveById = new Map(liveNotices.map((n) => [liveId(n), n]));
  const recs = combo
    ? [
        ...liveNotices.map((n) => ({ b: liveToBenefit(n), note: "" })),
        ...combo.chosen.map((b) => ({ b, note: "" })),
        ...combo.dropped.map((d) => ({ b: d.b, note: `중복 주의: ${d.because.name.replace(/\s*\(.*\)$/, "")}` })),
      ]
        .filter((r) => notExpired(r.b))
        .filter((r) => !search || r.b.name.toLowerCase().includes(search))
    : [];

  const events = Object.entries(prefs)
    .flatMap(([id, pref]) => {
      const src: AlarmSource | undefined =
        BENEFITS.find((b) => b.id === id) || (liveById.has(id) ? liveToBenefit(liveById.get(id)!) : pref.src);
      return src ? eventsFor(src, pref, today) : [];
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const due = events.filter((e) => diff(e.date, today) <= 0);

  // 사이트가 열려 있는 동안 오늘 알림을 브라우저 알림으로 띄운다 (한 번만)
  useEffect(() => {
    if (perm !== "granted") return;
    const check = () => {
      const seen = new Set(loadJson<string[]>(SEEN_KEY, []));
      const now = startOfDay(new Date());
      let changed = false;
      for (const e of events) {
        if (diff(e.date, now) > 0 || seen.has(e.id)) continue;
        try {
          new Notification(`공고패스 · ${e.title}`, { body: e.desc, tag: e.id });
        } catch {
          // 알림을 띄울 수 없는 환경
        }
        seen.add(e.id);
        changed = true;
      }
      if (changed) localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
    };
    check();
    const t = window.setInterval(check, 60_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm, JSON.stringify(prefs)]);

  const setPref = async (id: string, kind: AlarmKind, on: boolean) => {
    const live = liveById.get(id);
    const src = live ? (({ id: i, name, applyStart, applyEnd, url, docs }) => ({ id: i, name, applyStart, applyEnd, url, docs }))(liveToBenefit(live)) : prefs[id]?.src;
    const next: Prefs = { ...prefs, [id]: { ...prefs[id], [kind]: on, ...(src && { src }) } };
    if (!next[id].deadline && !next[id].docs) delete next[id];
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    if (on && perm === "default" && typeof Notification !== "undefined") {
      setPerm(await Notification.requestPermission());
    }
  };

  const exportAll = () =>
    downloadIcs(
      "공고패스_알림.ics",
      events.map((e) => ({ date: e.date, title: `공고패스 · ${e.title}`, desc: e.desc }))
    );

  const period = (b: Benefit) =>
    b.applyEnd ? `${b.applyStart ? md(parse(b.applyStart)!) : ""} ~ ${md(parse(b.applyEnd)!)}` : "상시 신청";

  return (
    <>
      <div>
        <span className="mb-1.5 flex items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          추천 공고
          {hasInfo && live?.status === "loading" && <span className="font-normal normal-case tracking-normal">· 실시간 공고 조회 중</span>}
          {hasInfo && live?.status === "ok" && (
            <span className="font-normal normal-case tracking-normal text-purple-600">
              · 실시간 {live.notices.length}건{live.sources?.length ? ` (${live.sources.join("·")})` : ""}
            </span>
          )}
        </span>
        {!hasInfo ? (
          <button
            type="button"
            onClick={onStartInfo}
            className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-lg border border-dashed border-purple-300 px-2.5 py-2 text-left text-[11px] leading-snug text-purple-700 hover:bg-purple-50"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            내 정보를 입력하면 맞는 공고를 추천해요
          </button>
        ) : recs.length === 0 ? (
          <p className="px-2.5 py-1 text-[11px] leading-relaxed text-slate-400">
            지금 조건으로 추천할 공고가 없어요. 내 정보를 더 넣어 보세요.
          </p>
        ) : (
          <div className="space-y-0.5">
            {recs.map(({ b, note }) => {
              const pref = prefs[b.id] || {};
              const on = Boolean(pref.deadline || pref.docs);
              const open = openId === b.id;
              const end = parse(b.applyEnd);
              const notStarted = b.applyStart && parse(b.applyStart)! > today;
              return (
                <div key={b.id} className={`rounded-lg ${open ? "bg-white ring-1 ring-slate-200" : "hover:bg-slate-100"}`}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : b.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
                  >
                    <span className={`min-w-0 flex-1 truncate ${note ? "text-slate-500" : "text-slate-700"}`}>{b.name}</span>
                    {liveById.has(b.id) && (
                      <span
                        className={`shrink-0 rounded px-1 py-px text-[9px] font-semibold text-white ${
                          liveById.get(b.id)?.source === "youth" ? "bg-purple-500" : "bg-purple-700"
                        }`}
                        title={`${sourceLabel(liveById.get(b.id))} 실시간 공고`}
                      >
                        실시간
                      </span>
                    )}
                    {end ? (
                      <span
                        className={`tnum shrink-0 rounded px-1 py-px text-[10px] font-medium ${
                          notStarted ? "bg-slate-100 text-slate-500" : diff(end, today) <= 7 ? "bg-red-50 text-red-600" : "bg-purple-50 text-purple-700"
                        }`}
                      >
                        {notStarted ? `${md(parse(b.applyStart)!)} 시작` : dday(end, today)}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] text-slate-500">상시</span>
                    )}
                    {on ? (
                      <BellRing className="h-3 w-3 shrink-0 text-purple-600" aria-label="알림 켜짐" />
                    ) : (
                      <Bell className="h-3 w-3 shrink-0 text-slate-300" aria-hidden />
                    )}
                  </button>
                  {open && (
                    <div className="space-y-2 px-2.5 pb-2.5 text-[11px] text-slate-500">
                      <div className="leading-snug">
                        <span className="font-medium text-slate-700">{b.amountText}</span>
                        <span className="block">
                          {b.org} · {!b.applyEnd && liveById.get(b.id)?.deadlineText ? liveById.get(b.id)!.deadlineText : period(b)}
                        </span>
                        {liveById.has(b.id) && <span className="block text-purple-600">출처: {sourceLabel(liveById.get(b.id))} 실시간</span>}
                        {liveById.get(b.id)?.target && (
                          <span className="mt-0.5 block line-clamp-2">대상: {liveById.get(b.id)!.target}</span>
                        )}
                        {note && <span className="block text-amber-700">{note} (둘 중 하나만)</span>}
                      </div>
                      <div className="space-y-1 rounded-md bg-slate-50 p-2">
                        <label className={`flex items-start gap-1.5 ${end ? "cursor-pointer" : "opacity-50"}`}>
                          <input
                            type="checkbox"
                            disabled={!end}
                            checked={Boolean(pref.deadline)}
                            onChange={(e) => setPref(b.id, "deadline", e.target.checked)}
                            className="mt-0.5 h-3.5 w-3.5 accent-purple-600"
                          />
                          <span>
                            <span className="font-medium text-slate-700">공고 알림</span>
                            <span className="block">{end ? "신청 시작 · 마감 3일 전 · 하루 전" : "상시 신청이라 마감 알림이 없어요"}</span>
                          </span>
                        </label>
                        <label className={`flex items-start gap-1.5 ${b.docs.length ? "cursor-pointer" : "opacity-50"}`}>
                          <input
                            type="checkbox"
                            disabled={!b.docs.length}
                            checked={Boolean(pref.docs)}
                            onChange={(e) => setPref(b.id, "docs", e.target.checked)}
                            className="mt-0.5 h-3.5 w-3.5 accent-purple-600"
                          />
                          <span>
                            <span className="font-medium text-slate-700">서류 알림</span>
                            <span className="block">
                              {b.docs.length
                                ? `${b.docs.length}종 · 유효기간 안 지나는 발급일에 알려요`
                                : "제출 서류가 없어요"}
                            </span>
                          </span>
                        </label>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAsk(`${b.name} 신청 자격, 기간, 필요 서류를 내 조건 기준으로 알려 주세요.`)}
                          className="inline-flex items-center gap-1 font-medium text-purple-700 hover:underline disabled:opacity-50"
                        >
                          <MessageCircle className="h-3 w-3" />
                          자세히 묻기
                        </button>
                        <a href={b.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-slate-800">
                          신청처 <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="px-2.5 pt-1 text-[10px] text-slate-400">
              {live?.status === "ok"
                ? "'실시간'은 온통청년·복지로·보조금24 공고, 나머지는 시연용 예시예요. 공고 원문을 확인하세요."
                : live?.status === "no_key"
                ? "일정·서류는 시연용 예시예요. 공공데이터포털·온통청년 키를 넣으면 실시간 공고가 함께 떠요."
                : live?.status === "error"
                ? "보조금24 조회에 실패해 시연용 예시만 보여요."
                : "일정·서류는 시연용 예시예요. 공고 원문을 확인하세요."}
            </p>
          </div>
        )}
      </div>

      <div>
        <span className="mb-1.5 flex items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          알림
          {due.length > 0 && (
            <span className="tnum rounded-full bg-red-500 px-1.5 text-[10px] font-semibold normal-case tracking-normal text-white">
              {due.length}
            </span>
          )}
        </span>
        {events.length === 0 ? (
          <p className="px-2.5 py-1 text-[11px] leading-relaxed text-slate-400">
            추천 공고를 눌러 공고·서류 알림을 켜면 여기에 일정이 모여요.
          </p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {events.slice(0, 6).map((e) => (
                <li key={e.id} className="group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-100" title={e.desc}>
                  {e.kind === "deadline" ? (
                    <Megaphone className="h-3 w-3 shrink-0 text-purple-500" />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0 text-emerald-600" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-slate-700">{e.title}</span>
                  <span
                    className={`tnum shrink-0 text-[10px] font-medium ${diff(e.date, today) <= 0 ? "text-red-600" : "text-slate-400"}`}
                  >
                    {dday(e.date, today)}
                  </span>
                  <button
                    type="button"
                    aria-label={`${e.title} 알림 끄기`}
                    title="이 공고의 이 알림 끄기"
                    onClick={() => setPref(e.benefitId, e.kind, false)}
                    className="hidden h-4 w-4 shrink-0 place-items-center rounded text-slate-400 hover:text-red-600 group-hover:grid"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
            {events.length > 6 && <p className="px-2.5 text-[10px] text-slate-400">외 {events.length - 6}건</p>}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5">
              <button
                type="button"
                onClick={exportAll}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 hover:underline"
              >
                <CalendarPlus className="h-3 w-3" />
                캘린더에 넣기
              </button>
              {perm === "default" && (
                <button
                  type="button"
                  onClick={async () => setPerm(await Notification.requestPermission())}
                  className="text-[11px] text-slate-500 hover:text-slate-800"
                >
                  브라우저 알림 켜기
                </button>
              )}
              {perm === "denied" && <span className="text-[10px] text-slate-400">브라우저 알림이 차단돼 있어요</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
