"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, Plus, X } from "lucide-react";
import { SIDO, SIGUNGU } from "@/data/regions";

// 채팅 전에 받는 내 정보. 숫자 항목은 자격 계산(중위소득·환산 월세·독립 특례)에 그대로 쓰이고,
// 지역·하는 일은 AI 답변을 내 상황에 맞추는 데 쓰인다.
export type InfoKey = "sido" | "sigungu" | "age" | "job" | "incomeManwon" | "sepMonths" | "depositManwon" | "rentManwon";
export type InfoValue = string | number | "";
export type InfoValues = Record<InfoKey, InfoValue>;

type Opt = { label: string; value: string | number };

interface Question {
  key: InfoKey;
  label: string;
  question: string | ((v: InfoValues) => string);
  why: string;
  options: Opt[] | ((v: InfoValues) => Opt[]);
  unit?: string;
  max?: number;
  tag: (v: string | number) => string;
  skipIf?: (v: InfoValues) => boolean;
}

const man = (n: number) => `${n.toLocaleString("ko-KR")}만`;
const opts = (list: string[]) => list.map((s) => ({ label: s, value: s }));
// 부모님과 함께 살면 보증금·월세 질문은 건너뛴다
const livesWithParents = (v: InfoValues) => v.sepMonths === 0;

export const INFO_QUESTIONS: Question[] = [
  {
    key: "sido",
    label: "거주 지역",
    question: "지금 어디에 살고 계세요?",
    why: "지자체마다 따로 하는 지원사업을 찾을 때 씁니다.",
    options: opts(SIDO),
    tag: (v) => String(v),
  },
  {
    key: "sigungu",
    label: "시군구",
    question: (v) => `${v.sido} 어느 ${String(v.sido).match(/서울|부산|대구|인천|광주|대전|울산/) ? "구·군" : "시·군"}에 사세요?`,
    why: "구청·시청이 따로 하는 청년 지원(월세·교통비·면접 수당 등)까지 찾습니다.",
    options: (v) => opts(SIGUNGU[String(v.sido)] || []),
    tag: (v) => String(v),
    // 시도를 안 골랐거나 세종처럼 하위 구역이 없으면 건너뜀
    skipIf: (v) => !(SIGUNGU[String(v.sido)] || []).length,
  },
  {
    key: "age",
    label: "나이",
    question: "만 나이가 어떻게 되세요?",
    why: "청년 정책은 대부분 만 19~34세가 대상이고, 만 30세부터는 독립가구 특례가 적용됩니다.",
    options: [20, 23, 26, 29, 32].map((n) => ({ label: `만 ${n}세`, value: n })),
    unit: "세",
    max: 99,
    tag: (v) => `만 ${v}세`,
  },
  {
    key: "job",
    label: "하는 일",
    question: "지금 어떤 일을 하고 계세요?",
    why: "재직·구직 여부에 따라 받을 수 있는 정책이 달라집니다.",
    options: opts(["재직 중", "구직 중", "학생", "자영업·프리랜서", "쉬는 중"]),
    tag: (v) => String(v),
  },
  {
    key: "incomeManwon",
    label: "월 소득",
    question: "한 달 소득은 얼마쯤인가요?",
    why: "기준 중위소득 대비 비율(60% 이하인지)을 계산합니다. 세전 기준으로 골라 주세요.",
    options: [{ label: "소득 없음", value: 0 }, ...[100, 130, 160, 200].map((n) => ({ label: `${n}만 원`, value: n }))],
    unit: "만 원",
    max: 10000,
    tag: (v) => (Number(v) ? `월소득 ${man(Number(v))}` : "소득 없음"),
  },
  {
    key: "sepMonths",
    label: "독립 기간",
    question: "부모님과 따로 산 지 얼마나 됐나요?",
    why: "1년 넘게 따로 살았으면 부모님 소득을 빼고 심사받을 수 있습니다.",
    options: [
      { label: "함께 살아요", value: 0 },
      { label: "1년 미만", value: 6 },
      { label: "1~2년", value: 18 },
      { label: "2년 이상", value: 30 },
    ],
    unit: "개월",
    max: 600,
    tag: (v) => (Number(v) ? `독립 ${v}개월` : "부모님과 함께"),
  },
  {
    key: "depositManwon",
    label: "보증금",
    question: "지금 사는 집 보증금은 얼마인가요?",
    why: "보증금을 월세로 환산해 상한(합산 90만 원)을 확인합니다.",
    options: [{ label: "보증금 없음", value: 0 }, ...[500, 1000, 3000, 5000].map((n) => ({ label: `${man(n)} 원`, value: n }))],
    unit: "만 원",
    max: 100000,
    tag: (v) => (Number(v) ? `보증금 ${man(Number(v))}` : "보증금 없음"),
    skipIf: livesWithParents,
  },
  {
    key: "rentManwon",
    label: "월세",
    question: "월세는 얼마인가요?",
    why: "청년월세 지원의 월세 요건(70만 원 이하)을 확인합니다.",
    options: [40, 50, 60, 70, 80].map((n) => ({ label: `${n}만 원`, value: n })),
    unit: "만 원",
    max: 1000,
    tag: (v) => `월세 ${man(Number(v))}`,
    skipIf: livesWithParents,
  },
];

const isFilled = (v: InfoValue | undefined) => v !== "" && v !== undefined;

export const firstMissing = (v: InfoValues) =>
  INFO_QUESTIONS.find((q) => !isFilled(v[q.key]) && !q.skipIf?.(v))?.key;

export function InfoOnboarding({
  values,
  onSet,
  onClose,
  startKey,
  single,
}: {
  values: InfoValues;
  onSet: (key: InfoKey, value: InfoValue) => void;
  onClose: () => void;
  startKey?: InfoKey;
  // true: 태그를 눌러 한 항목만 고치는 모드
  single?: boolean;
}) {
  const [idx, setIdx] = useState(() => Math.max(0, INFO_QUESTIONS.findIndex((q) => q.key === startKey)));
  const q = INFO_QUESTIONS[idx];
  const options = typeof q.options === "function" ? q.options(values) : q.options;
  const questionText = typeof q.question === "function" ? q.question(values) : q.question;
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const v = values[q.key];
    setDraft(typeof v === "number" ? String(v) : "");
    // 질문이 바뀔 때만 입력칸을 현재 값으로 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.key]);

  const go = (vals: InfoValues) => {
    if (single) return onClose();
    let n = idx + 1;
    while (n < INFO_QUESTIONS.length && INFO_QUESTIONS[n].skipIf?.(vals)) n++;
    if (n >= INFO_QUESTIONS.length) onClose();
    else setIdx(n);
  };

  const back = () => {
    let n = idx - 1;
    while (n > 0 && INFO_QUESTIONS[n].skipIf?.(values)) n--;
    setIdx(Math.max(0, n));
  };

  const pick = (v: string | number) => {
    onSet(q.key, v);
    const next = { ...values, [q.key]: v };
    // 시도를 바꾸면 시군구는 다시 고르게 한다 (한 항목 수정 모드여도)
    if (q.key === "sido" && v !== values.sido) {
      next.sigungu = "";
      if (single && (SIGUNGU[String(v)] || []).length) return setIdx(idx + 1);
    }
    go(next);
  };

  const submitDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0 || (q.max !== undefined && n > q.max)) return;
    pick(Math.round(n));
  };

  return (
    <div className="w-full animate-fade-up rounded-2xl border border-purple-200/80 bg-white p-4 shadow-[0_10px_28px_-16px_rgba(109,40,217,0.25)]">
      <div className="flex items-center justify-between gap-2">
        <span className="tnum text-[11px] font-semibold text-purple-600">
          {single ? `내 정보 수정 · ${q.label}` : `맞춤 답변을 위한 내 정보 ${idx + 1} / ${INFO_QUESTIONS.length}`}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          title={single ? "닫기" : "나중에 입력하기"}
          className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {!single && (
        <div className="mt-2 flex gap-1" aria-hidden>
          {INFO_QUESTIONS.map((x, i) => (
            <span
              key={x.key}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < idx ? "bg-purple-400" : i === idx ? "bg-purple-600" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      )}

      <h3 className="mt-3 text-[15px] font-semibold text-slate-900">{questionText}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{q.why}</p>

      <div className={`mt-3 flex flex-wrap gap-1.5 ${options.length > 20 ? "max-h-40 overflow-y-auto pr-1" : ""}`}>
        {options.map((o) => {
          const on = values[q.key] === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => pick(o.value)}
              aria-pressed={on}
              className={`rounded-full px-3 py-1 text-[13px] transition-colors ${
                on
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-purple-50/80 text-purple-800 ring-1 ring-purple-200/70 hover:bg-purple-100"
              }`}
            >
              #{o.label}
            </button>
          );
        })}
      </div>

      {q.unit && (
        <form onSubmit={submitDraft} className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span className="shrink-0">직접 입력</span>
          <span className="flex w-36 items-center rounded-lg border border-slate-200 bg-white focus-within:border-purple-300 focus-within:ring-2 focus-within:ring-purple-200">
            <input
              type="number"
              min={0}
              max={q.max}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`${q.label} 직접 입력`}
              placeholder="숫자"
              className="tnum w-full min-w-0 bg-transparent px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none"
            />
            <span className="shrink-0 pr-2 text-slate-400">{q.unit}</span>
          </span>
          <button
            type="submit"
            disabled={draft.trim() === ""}
            className="rounded-lg bg-purple-600 px-2.5 py-1.5 font-medium text-white hover:bg-purple-700 disabled:opacity-40"
          >
            확인
          </button>
        </form>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
        {!single && idx > 0 ? (
          <button type="button" onClick={back} className="inline-flex items-center gap-0.5 text-slate-500 hover:text-slate-800">
            <ChevronLeft className="h-3.5 w-3.5" />
            이전
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {single && isFilled(values[q.key]) && (
            <button
              type="button"
              onClick={() => {
                onSet(q.key, "");
                onClose();
              }}
              className="text-slate-500 hover:text-red-600"
            >
              지우기
            </button>
          )}
          <button type="button" onClick={() => go(values)} className="font-medium text-slate-500 hover:text-slate-800">
            {single ? "닫기" : "건너뛰기"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InfoTags({
  values,
  onEdit,
  onStart,
}: {
  values: InfoValues;
  onEdit: (key: InfoKey) => void;
  onStart: () => void;
}) {
  const filled = INFO_QUESTIONS.filter((q) => isFilled(values[q.key]));
  const missing = INFO_QUESTIONS.filter((q) => !isFilled(values[q.key]) && !q.skipIf?.(values)).length;
  // 접힌 상태는 브라우저에 기억한다
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(localStorage.getItem("gonggopass_tags_collapsed") === "1"), []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("gonggopass_tags_collapsed", next ? "1" : "0");
  };
  if (!filled.length && !missing) return null;

  if (collapsed && filled.length) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-expanded={false}
        title="내 정보 펼치기"
        className="inline-flex max-w-full items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-medium text-purple-700 ring-1 ring-purple-200/70 transition-colors hover:bg-purple-100"
      >
        <span className="truncate">
          내 정보 {filled.length}개 · {filled.slice(0, 2).map((q) => `#${q.tag(values[q.key] as string | number)}`).join(" ")}
          {filled.length > 2 ? " …" : ""}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filled.map((q) => (
        <button
          key={q.key}
          type="button"
          onClick={() => onEdit(q.key)}
          title={`${q.label} 수정`}
          className="tnum rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-medium text-purple-700 ring-1 ring-purple-200/70 transition-colors hover:bg-purple-100"
        >
          #{q.tag(values[q.key] as string | number)}
        </button>
      ))}
      {missing > 0 && (
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-purple-300 px-2.5 py-0.5 text-[11px] font-medium text-purple-600 transition-colors hover:bg-purple-50"
        >
          <Plus className="h-3 w-3" />
          {filled.length ? `정보 ${missing}개 더 입력` : "내 정보 입력하고 맞춤 답변 받기"}
        </button>
      )}
      {filled.length > 0 && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded
          aria-label="내 정보 접기"
          title="내 정보 접기"
          className="grid h-5 w-5 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
