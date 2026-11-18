"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, Plus, X } from "lucide-react";
import { SIDO, SIGUNGU } from "@/data/regions";

// 채팅 전에 받는 내 정보. 숫자 항목은 자격 계산(중위소득·환산 월세·독립 특례)에 그대로 쓰이고,
// 지역·하는 일은 AI 답변을 내 상황에 맞추는 데 쓰인다.
export type InfoKey =
  // 기본 정보 (자격 계산에 직접 쓰임)
  | "sido" | "sigungu" | "age" | "job" | "incomeManwon" | "sepMonths" | "housing" | "depositManwon" | "rentManwon"
  // 추가 조건 (선택: 공고마다 다른 자격·우대 조건)
  | "household" | "marriage" | "children" | "education" | "military" | "homeOwner" | "insurance"
  | "company" | "startup" | "parentIncome" | "assets" | "subscription" | "special" | "interests";
export type InfoValue = string | number | "";
export type InfoValues = Record<InfoKey, InfoValue>;
export type InfoGroup = "basic" | "extra";

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
  // 없으면 기본 정보
  group?: InfoGroup;
  // 여러 개 고르기 (값은 쉼표로 이어 저장)
  multi?: boolean;
}

// 만 원 단위 금액 표시: 1억 이상은 "1억", "1억 5,000만"처럼
const man = (n: number) =>
  n >= 10000
    ? `${Math.floor(n / 10000).toLocaleString("ko-KR")}억${n % 10000 ? ` ${(n % 10000).toLocaleString("ko-KR")}만` : ""}`
    : `${n.toLocaleString("ko-KR")}만`;
const opts = (list: string[]) => list.map((s) => ({ label: s, value: s }));
// 부모님과 함께 살면 거주 형태·보증금·월세 질문은 건너뛴다
const livesWithParents = (v: InfoValues) => v.sepMonths === 0;
// 직업을 이미 골랐는데 해당하지 않으면 건너뛴다 (안 골랐으면 묻는다)
const jobIsNot = (v: InfoValues, ...jobs: string[]) => Boolean(v.job) && !jobs.includes(String(v.job));
export const MULTI_NONE = "해당 없음";

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
    key: "housing",
    label: "거주 형태",
    question: "지금 사는 집은 어떤 형태인가요?",
    why: "월세 지원, 전세대출 이자 지원, 주거급여 등 주거 정책은 거주 형태에 따라 대상이 갈립니다.",
    options: opts(["월세", "전세", "자가", "기숙사·고시원"]),
    tag: (v) => String(v),
    skipIf: livesWithParents,
  },
  {
    key: "depositManwon",
    label: "보증금",
    question: (v) => (v.housing === "전세" ? "전세보증금은 얼마인가요?" : "지금 사는 집 보증금은 얼마인가요?"),
    why: "보증금 상한(월세 지원 5천만 원, 전세 지원은 사업마다 다름)과 월세 환산액을 확인합니다.",
    options: (v) =>
      v.housing === "전세"
        ? [3000, 5000, 10000, 20000, 30000].map((n) => ({ label: `${man(n)} 원`, value: n }))
        : [{ label: "보증금 없음", value: 0 }, ...[500, 1000, 3000, 5000].map((n) => ({ label: `${man(n)} 원`, value: n }))],
    unit: "만 원",
    max: 100000,
    tag: (v) => (Number(v) ? `보증금 ${man(Number(v))}` : "보증금 없음"),
    skipIf: (v) => livesWithParents(v) || v.housing === "자가",
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
    skipIf: (v) => livesWithParents(v) || v.housing === "전세" || v.housing === "자가",
  },

  /* ── 추가 조건 (선택) ── */
  {
    key: "household",
    group: "extra",
    label: "가구원 수",
    question: "주민등록상 함께 사는 가구원은 몇 명인가요?",
    why: "기준 중위소득은 가구원 수마다 달라서, 소득 기준을 정확히 계산할 때 씁니다.",
    options: opts(["1인", "2인", "3인", "4인 이상"]),
    tag: (v) => `${v} 가구`,
  },
  {
    key: "marriage",
    group: "extra",
    label: "혼인",
    question: "결혼 여부를 알려 주세요.",
    why: "신혼부부 전세대출, 신혼희망타운, 결혼 장려금처럼 혼인 여부로 갈리는 정책이 많아요.",
    options: opts(["미혼", "결혼 예정", "기혼"]),
    tag: (v) => String(v),
  },
  {
    key: "children",
    group: "extra",
    label: "자녀",
    question: "자녀가 있나요?",
    why: "출산·육아 지원, 다자녀 특별공급, 부모급여 등 자녀 수에 따라 받는 지원이 달라요.",
    options: opts(["없음", "임신 중", "1명", "2명 이상"]),
    tag: (v) => (v === "없음" ? "자녀 없음" : v === "임신 중" ? "임신 중" : `자녀 ${v}`),
  },
  {
    key: "education",
    group: "extra",
    label: "학력",
    question: "최종 학력이나 지금 학업 상태는요?",
    why: "구직 지원은 재학·휴학생을 빼는 경우가 많고, 장학금·학자금은 재학생만 받아요.",
    options: opts(["고등학교 졸업 이하", "대학 재학·휴학", "졸업 유예", "대학 졸업", "대학원"]),
    tag: (v) => String(v),
  },
  {
    key: "military",
    group: "extra",
    label: "병역",
    question: "병역 상태를 알려 주세요.",
    why: "군 복무 기간만큼 청년 나이 상한을 늘려 주는 공고가 많아요 (최대 3년).",
    options: opts(["군필", "미필", "복무 중", "해당 없음"]),
    tag: (v) => (v === "해당 없음" ? "병역 해당 없음" : String(v)),
  },
  {
    key: "homeOwner",
    group: "extra",
    label: "주택 소유",
    question: "본인 명의로 된 집이 있나요?",
    why: "월세·전세 지원과 청약 특별공급은 대부분 무주택자만 신청할 수 있어요.",
    options: opts(["무주택", "주택 보유"]),
    tag: (v) => String(v),
    skipIf: (v) => v.housing === "자가",
  },
  {
    key: "insurance",
    group: "extra",
    label: "고용보험",
    question: "지금 고용보험에 가입돼 있나요?",
    why: "구직 지원금은 고용보험 가입자를 빼고, 일부 재직자 지원은 가입자만 받아요.",
    options: opts(["가입", "미가입", "잘 모름"]),
    tag: (v) => `고용보험 ${v}`,
    skipIf: (v) => jobIsNot(v, "재직 중", "자영업·프리랜서"),
  },
  {
    key: "company",
    group: "extra",
    label: "재직 기업",
    question: "어떤 곳에서 일하고 있나요?",
    why: "중소기업 취업 청년 소득세 감면, 청년내일채움처럼 기업 규모로 갈리는 지원이 있어요.",
    options: opts(["중소기업", "중견기업", "대기업", "공공기관"]),
    tag: (v) => `${v} 재직`,
    skipIf: (v) => jobIsNot(v, "재직 중"),
  },
  {
    key: "startup",
    group: "extra",
    label: "창업 기간",
    question: "사업을 시작한 지 얼마나 됐나요?",
    why: "예비창업패키지(창업 전), 초기창업패키지(3년 이내)처럼 창업 기간별로 사업이 나뉘어요.",
    options: opts(["창업 준비 중", "3년 이내", "3~7년", "7년 이상"]),
    tag: (v) => (v === "창업 준비 중" ? "예비 창업" : `창업 ${v}`),
    skipIf: (v) => jobIsNot(v, "자영업·프리랜서"),
  },
  {
    key: "parentIncome",
    group: "extra",
    label: "부모님 소득",
    question: "부모님(원가구) 소득은 어느 정도인가요?",
    why: "독립 특례에 해당하지 않으면 부모님 소득까지 함께 보는 공고가 많아요.",
    options: opts(["중위 100% 이하", "중위 100% 초과", "잘 모름"]),
    tag: (v) => `부모님 소득 ${v}`,
  },
  {
    key: "assets",
    group: "extra",
    label: "본인 재산",
    question: "본인 재산(예금·전세금·차량 등 합계)은 어느 정도인가요?",
    why: "청년월세는 1.22억, 행복주택은 약 2.5억처럼 재산 상한이 있는 공고가 많아요.",
    options: opts(["5천만 원 이하", "1억 원 이하", "2억 원 이하", "2억 원 초과"]),
    tag: (v) => `재산 ${v}`,
  },
  {
    key: "subscription",
    group: "extra",
    label: "청약통장",
    question: "주택청약 통장이 있나요?",
    why: "청년 주택드림 청약통장, 공공주택 청약, 일부 월세 지원은 청약통장이 필요해요.",
    options: opts(["있음", "없음"]),
    tag: (v) => `청약통장 ${v}`,
  },
  {
    key: "special",
    group: "extra",
    multi: true,
    label: "우대 조건",
    question: "해당하는 것을 모두 골라 주세요.",
    why: "우선 선발·가점·추가 지원이 붙는 조건이에요. 여러 개 고를 수 있어요.",
    options: opts(["기초생활수급", "차상위계층", "한부모 가정", "장애인", "자립준비청년", "다문화 가정", "국가유공자 가족", MULTI_NONE]),
    tag: (v) => String(v).split(",").join(" · "),
  },
  {
    key: "interests",
    group: "extra",
    multi: true,
    label: "관심 분야",
    question: "관심 있는 지원 분야를 모두 골라 주세요.",
    why: "추천 공고와 답변을 관심 분야 위주로 보여 드려요.",
    options: opts(["주거", "일자리·취업", "창업", "금융·자산", "교육·자격증", "생활·복지", "문화·여가", "건강·심리"]),
    tag: (v) => `관심 ${String(v).split(",").join("·")}`,
  },
];

export const groupOf = (q: Question): InfoGroup => q.group ?? "basic";
export const questionsOf = (g: InfoGroup) => INFO_QUESTIONS.filter((q) => groupOf(q) === g);
// 숫자로 저장하는 항목 (자격 계산용). 나머지는 문자열
export const NUMERIC_INFO_KEYS = ["age", "incomeManwon", "sepMonths", "depositManwon", "rentManwon"] as const;
export const TEXT_INFO_KEYS = INFO_QUESTIONS.map((q) => q.key).filter(
  (k) => !(NUMERIC_INFO_KEYS as readonly string[]).includes(k)
) as Exclude<InfoKey, (typeof NUMERIC_INFO_KEYS)[number]>[];

const isFilled = (v: InfoValue | undefined) => v !== "" && v !== undefined;

export const firstMissing = (v: InfoValues, g: InfoGroup = "basic") =>
  questionsOf(g).find((q) => !isFilled(v[q.key]) && !q.skipIf?.(v))?.key;

// 채팅에 함께 보낼 추가 조건 요약 (예: ["1인 가구", "미혼", "기초생활수급 · 한부모 가정"])
export const extraSummary = (v: InfoValues) =>
  questionsOf("extra")
    .filter((q) => isFilled(v[q.key]))
    .map((q) => `${q.label}: ${q.tag(v[q.key] as string | number)}`);

export function InfoOnboarding({
  values,
  onSet,
  onClose,
  onFinish,
  startKey,
  single,
  variant = "card",
  group = "basic",
}: {
  values: InfoValues;
  onSet: (key: InfoKey, value: InfoValue) => void;
  onClose: () => void;
  // 마지막 질문까지 끝났을 때 (없으면 onClose)
  onFinish?: () => void;
  startKey?: InfoKey;
  // true: 태그를 눌러 한 항목만 고치는 모드
  single?: boolean;
  // modal: 첫 방문 환영 팝업 안에서 크게 보여준다 (아래 group 기본값: 기본 정보)
  variant?: "card" | "modal";
  // 이어서 물을 질문 묶음 (한 항목 수정 모드는 전체에서 찾는다)
  group?: InfoGroup;
}) {
  const big = variant === "modal";
  const qs = single ? INFO_QUESTIONS : questionsOf(group);
  const [idx, setIdx] = useState(() => Math.max(0, qs.findIndex((q) => q.key === startKey)));
  const q = qs[Math.min(idx, qs.length - 1)];
  const options = typeof q.options === "function" ? q.options(values) : q.options;
  const questionText = typeof q.question === "function" ? q.question(values) : q.question;
  const [draft, setDraft] = useState("");
  const selected = q.multi ? String(values[q.key] || "").split(",").filter(Boolean) : [];

  // 여러 개 고르기: '해당 없음'은 다른 항목과 함께 고를 수 없다
  const toggleMulti = (v: string) => {
    const next =
      v === MULTI_NONE
        ? selected.includes(MULTI_NONE)
          ? []
          : [MULTI_NONE]
        : selected.includes(v)
        ? selected.filter((x) => x !== v)
        : [...selected.filter((x) => x !== MULTI_NONE), v];
    onSet(q.key, next.join(","));
  };

  useEffect(() => {
    const v = values[q.key];
    setDraft(typeof v === "number" ? String(v) : "");
    // 질문이 바뀔 때만 입력칸을 현재 값으로 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.key]);

  const go = (vals: InfoValues) => {
    if (single) return onClose();
    let n = idx + 1;
    while (n < qs.length && qs[n].skipIf?.(vals)) n++;
    if (n >= qs.length) (onFinish ?? onClose)();
    else setIdx(n);
  };

  const back = () => {
    let n = idx - 1;
    while (n > 0 && qs[n].skipIf?.(values)) n--;
    setIdx(Math.max(0, n));
  };

  const pick = (v: string | number) => {
    onSet(q.key, v);
    const next = { ...values, [q.key]: v };
    // 시도를 바꾸면 시군구는 다시 고르게 한다 (한 항목 수정 모드여도)
    if (q.key === "sido" && v !== values.sido) {
      next.sigungu = "";
      if (single && (SIGUNGU[String(v)] || []).length) return setIdx(qs.findIndex((x) => x.key === "sigungu"));
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
    <div
      className={
        big
          ? "w-full"
          : "w-full animate-fade-up rounded-2xl border border-purple-200/80 bg-white p-4 shadow-[0_10px_28px_-16px_rgba(109,40,217,0.25)]"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`tnum font-semibold text-purple-600 ${big ? "text-xs" : "text-[11px]"}`}>
          {single
            ? `내 정보 수정 · ${q.label}`
            : big
            ? `${group === "extra" ? "추가 조건 · " : ""}${idx + 1} / ${qs.length} · ${q.label}`
            : `맞춤 답변을 위한 내 정보 ${idx + 1} / ${qs.length}`}
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
          {qs.map((x, i) => (
            <span
              key={x.key}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < idx ? "bg-purple-400" : i === idx ? "bg-purple-600" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      )}

      <h3 className={`font-semibold text-slate-900 ${big ? "mt-5 text-xl tracking-tight" : "mt-3 text-[15px]"}`}>{questionText}</h3>
      <p className={`text-slate-500 ${big ? "mt-1 text-[13px]" : "mt-0.5 text-xs"}`}>{q.why}</p>

      <div
        className={`flex flex-wrap ${big ? "mt-5 gap-2" : "mt-3 gap-1.5"} ${
          options.length > 20 ? (big ? "max-h-56 overflow-y-auto pr-1" : "max-h-40 overflow-y-auto pr-1") : ""
        }`}
      >
        {options.map((o) => {
          const on = q.multi ? selected.includes(String(o.value)) : values[q.key] === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => (q.multi ? toggleMulti(String(o.value)) : pick(o.value))}
              aria-pressed={on}
              className={`rounded-full transition-colors ${big ? "px-4 py-2 text-sm" : "px-3 py-1 text-[13px]"} ${
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

      <div
        className={`flex items-center justify-between border-t border-slate-100 ${big ? "mt-6 pt-3.5 text-[13px]" : "mt-3 pt-2.5 text-xs"}`}
      >
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
          {q.multi ? (
            // 여러 개 고르기는 자동으로 넘어가지 않으니 '다음' 버튼으로 넘긴다
            <button
              type="button"
              onClick={() => go(values)}
              className={`rounded-lg font-medium ${
                selected.length ? "bg-purple-600 px-3 py-1.5 text-white hover:bg-purple-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {single ? "완료" : selected.length ? `다음 (${selected.length}개 선택)` : "건너뛰기"}
            </button>
          ) : (
            <button type="button" onClick={() => go(values)} className="font-medium text-slate-500 hover:text-slate-800">
              {single ? "닫기" : "건너뛰기"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 첫 방문 환영 팝업: 쇼핑몰의 '맞춤 정보 입력'처럼 환영 → 질문 → 요약 순서로 진행한다.
// intro가 false면 환영 화면 없이 질문부터 시작한다 (나중에 '내 정보 입력하기'로 열었을 때).
export function WelcomeModal({
  values,
  onSet,
  onClose,
  startKey,
  intro = true,
  startGroup = "basic",
}: {
  values: InfoValues;
  onSet: (key: InfoKey, value: InfoValue) => void;
  onClose: () => void;
  startKey?: InfoKey;
  intro?: boolean;
  // 기본 정보부터 / 추가 조건부터
  startGroup?: InfoGroup;
}) {
  const [stage, setStage] = useState<"welcome" | "questions" | "done">(intro ? "welcome" : "questions");
  const [group, setGroup] = useState<InfoGroup>(startGroup);
  // 추가 조건 단계에 처음 들어갈 때는 첫 질문부터 (startKey는 처음 연 묶음에만 쓴다)
  const [qStart, setQStart] = useState<InfoKey | undefined>(startKey);
  const filled = INFO_QUESTIONS.filter((q) => isFilled(values[q.key]));
  const extraLeft = questionsOf("extra").filter((q) => !isFilled(values[q.key]) && !q.skipIf?.(values)).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/45 p-4 backdrop-blur-[3px] animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="내 정보 입력"
        className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-scale-in sm:p-7"
      >
        {stage === "welcome" && (
          <div className="text-center">
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-purple-100 text-2xl">🎁</div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">공고패스에 오신 걸 환영해요</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              몇 가지만 알려 주시면 받을 수 있는 지원금과
              <br />
              필요한 서류를 바로 찾아 드려요. 1분이면 끝나요.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {["#사는 곳", "#나이", "#하는 일", "#월 소득", "#독립 여부", "#거주 형태"].map((t) => (
                <span key={t} className="rounded-full bg-purple-50 px-3 py-1 text-[13px] font-medium text-purple-700 ring-1 ring-purple-200/70">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-2.5 text-xs text-slate-400">원하면 혼인·자녀·학력·병역·우대 조건 등 추가 조건도 입력할 수 있어요.</p>
            <button
              type="button"
              onClick={() => setStage("questions")}
              className="mt-7 w-full rounded-2xl bg-purple-600 py-3.5 text-[15px] font-semibold text-white shadow-sm shadow-purple-500/30 transition-colors hover:bg-purple-700"
            >
              내 정보 입력하기
            </button>
            <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-[13px] text-slate-500 hover:text-slate-800">
              나중에 할게요
            </button>
            <p className="mt-2 text-[11px] text-slate-400">입력한 정보는 이 브라우저에만 저장되고 언제든 고칠 수 있어요.</p>
          </div>
        )}

        {stage === "questions" && (
          <InfoOnboarding
            key={group}
            values={values}
            onSet={onSet}
            onClose={onClose}
            onFinish={() => setStage("done")}
            startKey={qStart}
            variant="modal"
            group={group}
          />
        )}

        {stage === "done" && (
          <div className="text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-2xl">✨</div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
              {filled.length ? "준비 완료!" : "나중에 언제든 입력할 수 있어요"}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {filled.length ? "이 정보로 받을 수 있는 지원금을 찾아 드릴게요." : "입력창 위 버튼으로 다시 시작할 수 있어요."}
            </p>
            {filled.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                {filled.map((q) => (
                  <span
                    key={q.key}
                    className="tnum rounded-full bg-purple-50 px-3 py-1 text-[13px] font-medium text-purple-700 ring-1 ring-purple-200/70"
                  >
                    #{q.tag(values[q.key] as string | number)}
                  </span>
                ))}
              </div>
            )}
            {/* 기본 정보를 마쳤으면 추가 조건을 이어서 입력할 수 있게 */}
            {group === "basic" && extraLeft > 0 && (
              <button
                type="button"
                onClick={() => {
                  setGroup("extra");
                  setQStart(firstMissing(values, "extra"));
                  setStage("questions");
                }}
                className="mt-6 w-full rounded-2xl border border-purple-200 bg-purple-50/60 px-4 py-3 text-left transition-colors hover:bg-purple-50"
              >
                <span className="block text-sm font-semibold text-purple-800">추가 조건도 입력하기 · 선택</span>
                <span className="mt-0.5 block text-xs text-purple-700/80">
                  혼인·자녀·학력·병역·재산·우대 조건 등 {extraLeft}개 · 더 많은 공고를 정확히 걸러 드려요
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`${group === "basic" && extraLeft > 0 ? "mt-2.5" : "mt-7"} w-full rounded-2xl bg-purple-600 py-3.5 text-[15px] font-semibold text-white shadow-sm shadow-purple-500/30 transition-colors hover:bg-purple-700`}
            >
              {group === "basic" && extraLeft > 0 ? "이대로 시작하기" : "공고패스 시작하기"}
            </button>
            {filled.length > 0 && <p className="mt-2 text-[11px] text-slate-400">입력창 위 태그를 누르면 언제든 고칠 수 있어요.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function InfoTags({
  values,
  onEdit,
  onStart,
  onStartExtra,
}: {
  values: InfoValues;
  onEdit: (key: InfoKey) => void;
  onStart: () => void;
  // 기본 정보를 다 채운 뒤 추가 조건을 이어서 입력
  onStartExtra?: () => void;
}) {
  const filled = INFO_QUESTIONS.filter((q) => isFilled(values[q.key]));
  const left = (g: InfoGroup) => questionsOf(g).filter((q) => !isFilled(values[q.key]) && !q.skipIf?.(values)).length;
  const missing = left("basic");
  const extraLeft = left("extra");
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
        className="inline-flex max-w-full items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 ring-1 ring-purple-200/70 transition-colors hover:bg-purple-100"
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
    <div className="order-first flex w-full flex-wrap items-center gap-1.5">
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
      {missing === 0 && extraLeft > 0 && onStartExtra && (
        <button
          type="button"
          onClick={onStartExtra}
          title="혼인·자녀·학력·병역·재산·우대 조건 등"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-purple-300 px-2.5 py-0.5 text-[11px] font-medium text-purple-600 transition-colors hover:bg-purple-50"
        >
          <Plus className="h-3 w-3" />
          추가 조건 {extraLeft}개
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
