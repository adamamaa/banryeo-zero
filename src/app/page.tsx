"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Paperclip,
  Plus,
  Square,
  ListChecks,
  Plug,
  Trash2,
  X,
} from "lucide-react";
import type { ToolExecution, ToolSource } from "@/lib/tools";
import type { AuditResult } from "@/lib/docRules";
import type { AnswerCard, PolicyDetail } from "@/lib/card";
import type { AgentAsk, AgentChecklist, AgentDraft, PlanStep } from "@/lib/agent";
import type { Verification } from "@/lib/verify";
import { downloadFile, downloadName, fileMeta, parseBlocks, type GeneratedFile } from "@/lib/fileExport";
import type { EligibilitySummary } from "@/lib/eligibility";
import { similarName } from "@/lib/officialFacts";
import { AgentOverlay, AgentPlanCard, type AgentPlanStep, type AgentTarget } from "@/components/AgentOverlay";
import {
  InfoOnboarding,
  InfoTags,
  WelcomeModal,
  TEXT_INFO_KEYS,
  extraSummary,
  firstMissing,
  type InfoGroup,
  type InfoKey,
  type InfoValue,
  type InfoValues,
} from "@/components/InfoOnboarding";
import { LiveBenefitsPanel, LiveDocsPanel, PolicyNearMissCard } from "@/components/Insights";
import { SidebarRecs, type LiveNotices } from "@/components/SidebarRecs";

// 패널 탭: 받을 돈(combo) → 서류 준비(recipe) → 제출(audit: 사전 검수 + 신청 패키지)
type View = "answer" | "combo" | "recipe" | "audit";
const PANEL_VIEWS: View[] = ["answer", "combo", "recipe", "audit"];
// 예전 대화에 저장된 탭: 신청 패키지는 제출로, 실행 내역·자격 판정은 받을 돈으로 연다
const toView = (v: string): View => (v === "package" ? "audit" : PANEL_VIEWS.includes(v as View) ? (v as View) : "combo");
type Verdict = EligibilitySummary["verdict"];
type Summary = EligibilitySummary;

interface Profile {
  age: number;
  incomeManwon: number;
  depositManwon: number;
  rentManwon: number;
  sepMonths: number;
}

type ProfileInput = Record<keyof Profile, number | "">;

const EMPTY_PROFILE: ProfileInput = {
  age: "",
  incomeManwon: "",
  depositManwon: "",
  rentManwon: "",
  sepMonths: "",
};

const toProfile = (p: ProfileInput): Profile => ({
  age: Number(p.age) || 0,
  incomeManwon: Number(p.incomeManwon) || 0,
  depositManwon: Number(p.depositManwon) || 0,
  rentManwon: Number(p.rentManwon) || 0,
  sepMonths: Number(p.sepMonths) || 0,
});

const hasProfileInput = (p: ProfileInput) => Object.values(p).some((v) => v !== "");

// 숫자 계산에 쓰지 않는 내 정보 (지역·하는 일·거주 형태와 추가 조건 전부, 문자열로 저장)
type ExtraKey = (typeof TEXT_INFO_KEYS)[number];
type ExtraInfo = Record<ExtraKey, string>;
const EMPTY_EXTRA = Object.fromEntries(TEXT_INFO_KEYS.map((k) => [k, ""])) as ExtraInfo;
const PROFILE_KEYS: (keyof Profile)[] = ["age", "incomeManwon", "depositManwon", "rentManwon", "sepMonths"];
// AI 되묻기(ask_user)의 field → 내 정보 항목과 단위
const ASK_FIELDS: Record<string, { key?: keyof Profile; unit: string; type: "number" | "date" | "text" }> = {
  age: { key: "age", unit: "세", type: "number" },
  income: { key: "incomeManwon", unit: "만 원", type: "number" },
  deposit: { key: "depositManwon", unit: "만 원", type: "number" },
  rent: { key: "rentManwon", unit: "만 원", type: "number" },
  sepMonths: { key: "sepMonths", unit: "개월", type: "number" },
  householdSize: { unit: "명", type: "number" },
  parentIncome: { unit: "만 원", type: "number" },
  parentHouseholdSize: { unit: "명", type: "number" },
  moveInDate: { unit: "", type: "date" },
};
const isProfileKey = (k: InfoKey): k is keyof Profile => (PROFILE_KEYS as string[]).includes(k);

// 첫 방문 질문으로 저장한 내 정보 (브라우저에만 저장)
const loadSavedInfo = () => {
  const saved = loadLocal<{ profile?: Partial<ProfileInput>; extra?: Partial<ExtraInfo> } | null>("gonggopass_profile", null);
  const profile = { ...EMPTY_PROFILE };
  for (const k of PROFILE_KEYS) {
    const v = saved?.profile?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) profile[k] = v;
  }
  const extra = { ...EMPTY_EXTRA };
  for (const k of TEXT_INFO_KEYS) {
    const v = saved?.extra?.[k];
    if (typeof v === "string") extra[k] = v.slice(0, 120);
  }
  return { profile, extra };
};

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  pending?: boolean;
  error?: boolean;
  attachments?: string[];
  traces?: ToolExecution[];
  artifact?: { view: View; title: string; meta: string };
  sources?: { title: string; url: string; registered?: boolean }[];
  // AI가 판정에 필요한 정보를 되물은 경우. answer는 사용자가 답한 값
  ask?: AgentAsk & { answer?: string };
  // 실행 단계 산출물: AI가 쓴 제출용 초안과 제출 직전 체크리스트 (사용자가 고치고 체크한 상태 포함)
  draft?: AgentDraft;
  checklist?: AgentChecklist;
  // AI가 만든 파일 (내용만 저장하고 다운로드할 때 파일로 만든다)
  files?: GeneratedFile[];
  // 서버가 답변을 도구 결과·오늘 날짜·공식 도메인과 대조한 결과
  verification?: Verification;
  // AI가 처음 세운 실행 계획과 단계별 실행 여부
  plan?: PlanStep[];
  // 이 답변에 쓴 모델과 추론 수준 (AI가 질문 난이도를 보고 고름)
  reasoning?: { model: string; level: "medium" | "high"; reason: string; by: "ai" | "rule" };
  card?: AnswerCard;
}

interface Staged {
  fileName: string;
  mimeType: string;
  base64OrText: string;
}

// 사이드바·오른쪽 패널 너비 범위 (px)
const SIDE_DEFAULT = 270;
const SIDE_MIN = 220;
const SIDE_MAX = 420;
const PANEL_MIN = 360;

interface Site {
  id: string;
  name: string;
  url: string;
  desc: string;
  keywords?: string[];
  custom?: boolean;
}

interface Chat {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

// 도구로 모을 수 있는 정부 사이트. 로그인은 각 사이트에서 직접 한다.
const CATALOG: Site[] = [
  { id: "gov24", name: "정부24", url: "https://www.gov.kr", desc: "주민등록등본 등 민원서류 발급", keywords: ["등본", "초본", "정부24", "민원", "발급"] },
  { id: "bokjiro", name: "복지로", url: "https://www.bokjiro.go.kr", desc: "복지 급여 온라인 신청", keywords: ["복지로", "신청", "월세"] },
  { id: "youth", name: "온통청년", url: "https://www.youthcenter.go.kr", desc: "청년 정책 공고 검색", keywords: ["온통청년", "공고", "정책", "지원금"] },
  { id: "efamily", name: "전자가족관계등록시스템", url: "https://efamily.scourt.go.kr", desc: "가족관계증명서 발급", keywords: ["가족관계"] },
  { id: "rtms", name: "부동산거래관리시스템", url: "https://rtms.molit.go.kr", desc: "주택임대차 신고필증 발급", keywords: ["확정일자", "신고필증", "임대차", "계약서"] },
  { id: "applyhome", name: "청약홈", url: "https://www.applyhome.co.kr", desc: "청약통장 가입 확인", keywords: ["청약"] },
  { id: "work24", name: "고용24", url: "https://www.work24.go.kr", desc: "국민취업지원제도 신청", keywords: ["취업", "구직", "고용"] },
  { id: "nhis", name: "국민건강보험", url: "https://www.nhis.or.kr", desc: "건강보험료 납부 확인", keywords: ["건보", "건강보험"] },
  { id: "hometax", name: "홈택스", url: "https://www.hometax.go.kr", desc: "소득금액증명 발급", keywords: ["홈택스", "소득금액", "소득 증명"] },
];
const DEFAULT_TOOLS = ["gov24", "bokjiro", "youth"];

const isHttpUrl = (v: string) => {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

const VIEWS: { id: View; label: string }[] = [
  { id: "combo", label: "받을 돈" },
  { id: "recipe", label: "서류 준비" },
  { id: "audit", label: "제출" },
];

const SOURCE: Record<ToolSource, { label: string; cls: string; hint: string }> = {
  calc: {
    label: "실계산",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    hint: "입력값으로 실제 계산한 결과",
  },
  live: {
    label: "실시간 API",
    cls: "bg-brand-50 text-brand-700 ring-brand-600/20",
    hint: "외부 API 실시간 응답",
  },
};

const VERDICT: Record<Verdict, { title: string; body: string; cls: string }> = {
  eligible: {
    title: "확인한 조건을 모두 충족합니다",
    body: "최종 판정은 접수 기관이 합니다. 신청 전 공고 원문을 확인하세요.",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  needs_check: {
    title: "확인이 더 필요합니다",
    body: "아래에서 정보가 없거나 직접 확인해야 하는 조건을 살펴보세요.",
    cls: "border-amber-200 bg-amber-50 text-amber-900",
  },
  ineligible: {
    title: "충족하지 못한 조건이 있습니다",
    body: "아래 미충족 조건을 확인하세요.",
    cls: "border-red-200 bg-red-50 text-red-900",
  },
};

const CHECK_STATUS: Record<EligibilitySummary["checks"][number]["status"], { label: string; cls: string }> = {
  pass: { label: "충족", cls: "bg-emerald-50 text-emerald-700" },
  fail: { label: "미충족", cls: "bg-red-50 text-red-700" },
  unknown: { label: "정보 없음", cls: "bg-slate-100 text-slate-600" },
};
const now = () =>
  new Date().toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
const risksOf = (a: { findings: { severity: string }[] }) =>
  a.findings.filter((f) => f.severity !== "pass").length;

export default function Page() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 마우스로 조절하는 너비 (브라우저에 기억). 오른쪽 패널 null = 기본 46%
  const [sideW, setSideW] = useState(SIDE_DEFAULT);
  const [panelW, setPanelW] = useState<number | null>(null);
  const [resizing, setResizing] = useState<null | "side" | "panel">(null);
  const widthsRef = useRef<{ side: number; panel: number | null }>({ side: SIDE_DEFAULT, panel: null });
  const saveWidths = (side: number, panel: number | null) => {
    widthsRef.current = { side, panel };
    localStorage.setItem("gonggopass_widths", JSON.stringify(widthsRef.current));
  };
  const clampSide = (w: number) => Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)));
  const clampPanel = (w: number) => Math.round(Math.min(window.innerWidth * 0.7, Math.max(PANEL_MIN, w)));
  // 경계선을 끌면 너비가 바뀐다 (끄는 동안은 애니메이션을 끄고 글자 선택을 막는다)
  const startResize = (kind: "side" | "panel") => (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(kind);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => {
      if (kind === "side") {
        const w = clampSide(ev.clientX);
        widthsRef.current.side = w;
        setSideW(w);
      } else {
        const w = clampPanel(window.innerWidth - ev.clientX);
        widthsRef.current.panel = w;
        setPanelW(w);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setResizing(null);
      saveWidths(widthsRef.current.side, widthsRef.current.panel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // 키보드(←/→)로도 조절
  const nudge = (kind: "side" | "panel", dx: number) => {
    if (kind === "side") {
      const w = clampSide(widthsRef.current.side + dx);
      setSideW(w);
      saveWidths(w, widthsRef.current.panel);
    } else {
      const base = widthsRef.current.panel ?? window.innerWidth * 0.46;
      const w = clampPanel(base - dx);
      setPanelW(w);
      saveWidths(widthsRef.current.side, w);
    }
  };
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [view, setView] = useState<View>("combo");

  const [publicKey, setPublicKey] = useState("");
  const [apiConnected, setApiConnected] = useState(false);
  const [apiMsg, setApiMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [publicOk, setPublicOk] = useState(false);
  const [publicMsg, setPublicMsg] = useState("");

  // 브라우저(localStorage)에만 저장되는 상태
  const [loaded, setLoaded] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState(() => `c-${Date.now()}`);
  const [addedIds, setAddedIds] = useState<string[]>(DEFAULT_TOOLS);
  const [custom, setCustom] = useState<Site[]>([]);
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteError, setSiteError] = useState("");
  const [maskOnScreen, setMaskOnScreen] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const [profile, setProfile] = useState<ProfileInput>(EMPTY_PROFILE);
  const [extra, setExtra] = useState<ExtraInfo>(EMPTY_EXTRA);
  // 내 정보 질문 카드: 첫 방문이면 자동으로 열리고, 태그를 누르면 그 항목만 고친다
  const [onboard, setOnboard] = useState<{ startKey?: InfoKey; single: boolean } | null>(null);
  // 첫 방문 환영 팝업 (intro: 환영 화면부터, false면 질문부터)
  const [welcome, setWelcome] = useState<{ intro: boolean; startKey?: InfoKey; group?: InfoGroup } | null>(null);
  // 실시간 공고 (온통청년·복지로·보조금24, 내 정보 기준)
  const [live, setLive] = useState<LiveNotices>({ status: "idle", notices: [] });
  const [liveNonce, setLiveNonce] = useState(0);
  const forceRefreshRef = useRef(false);
  const refreshLive = () => {
    forceRefreshRef.current = true;
    setLiveNonce((n) => n + 1);
  };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [upload, setUpload] = useState<{ result: AuditResult; mode: string; note?: string } | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [working, setWorking] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 오른쪽 패널 '답변 근거' 탭이 보여주는 답변
  const [focusId, setFocusId] = useState<string | null>(null);
  // AI가 되물은 정보의 상태: waiting(답 대기) → resolved(답 반영 후 재판정)
  const [askState, setAskState] = useState<{ status: "waiting" | "resolved"; question: string; reason?: string; answer?: string } | null>(null);
  // 패널 탭들의 기준 정책: "메시지id#정책순번"
  const [ctx, setCtx] = useState("");
  // 정책별 자격 응답·서류 준비·검수 결과 (브라우저에 저장)
  const [policyState, setPolicyState] = useState<Record<string, PolicyState>>({});
  // 이전에 안내한 정책 정보. 다음 질문에 함께 보내 같은 정책은 같은 값으로 답하게 한다.
  const [facts, setFacts] = useState<Record<string, PolicyDetail & { at: number }>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  // 사용자가 위로 올려 읽는 중이 아니면 AI 진행 상황의 맨 아래를 따라간다
  const followRef = useRef(true);
  const lastUserScrollRef = useRef(0);

  // AI 에이전트 시각적 연출(플랜 HUD, 가상 커서, 빨간 네모 하이라이트, 스캔 라인, 긴급 중지)
  const [agentActive, setAgentActive] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [agentScanning, setAgentScanning] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentPlanStep[]>([]);
  const [agentThought, setAgentThought] = useState("");
  const [agentTarget, setAgentTarget] = useState<AgentTarget | null>(null);
  const [markedTargets, setMarkedTargets] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  const stoppedRef = useRef(false);
  const agentTimersRef = useRef<number[]>([]);
  const pendingMsgIdRef = useRef<string | null>(null);

  const allTools = [...CATALOG, ...custom];
  const focusMsg = messages.find((m) => m.id === focusId && m.card);
  const allPolicyOptions = messages.flatMap((m) =>
    (m.card?.policies || []).map((p, i) => ({ key: `${m.id}#${i}`, msgId: m.id, p, steps: m.card!.steps, links: m.card!.links }))
  );
  const active = allPolicyOptions.find((o) => o.key === ctx) || null;
  // 같은 정책을 여러 번 물었으면 선택지에는 가장 최근 것만 (현재 선택은 유지)
  const policyOptions = allPolicyOptions.filter(
    (o, i, a) => a.findLastIndex((x) => x.p.name === o.p.name) === i || o.key === ctx
  );
  const pst: PolicyState = active ? policyState[active.key] || {} : {};
  const setPst = (patch: Partial<PolicyState>) => {
    if (active) setPolicyState((s) => ({ ...s, [active.key]: { ...s[active.key], ...patch } }));
  };
  const linkedMsg = active ? messages.find((m) => m.id === active.msgId) : undefined;
  const choosePolicy = (key: string, v?: View) => {
    setCtx(key);
    const o = allPolicyOptions.find((x) => x.key === key);
    if (o) setFocusId(o.msgId);
    if (v) setView(v);
    setCanvasOpen(true);
  };
  const myTools = allTools.filter((t) => addedIds.includes(t.id));

  const panelHasData =
    messages.length > 0 ||
    summary !== null ||
    upload !== null ||
    hasProfileInput(profile) ||
    Object.values(extra).some((v) => v !== "") ||
    live.notices.length > 0;

  const info: InfoValues = { ...extra, ...profile };
  // 패널은 사용자가 넣은 정보·서류가 있을 때만 채운다
  const hasAnyInfo = Object.values(info).some((v) => v !== "");
  // 여러 항목을 이어서 입력할 때는 팝업으로 (한 항목 수정은 입력창 위 작은 카드)
  const startInfo = () => setWelcome({ intro: false, startKey: firstMissing(info), group: "basic" });
  const startExtra = () => setWelcome({ intro: false, startKey: firstMissing(info, "extra"), group: "extra" });
  // 내 정보 한 항목을 바꾸고 브라우저에 저장한다
  const setInfo = (key: InfoKey, value: InfoValue) => {
    let nextProfile: ProfileInput = isProfileKey(key)
      ? { ...profile, [key]: value === "" ? "" : Math.max(0, Number(value) || 0) }
      : profile;
    // 거주 형태가 바뀌면 해당 없는 금액은 지운다 (전세·자가는 월세 없음, 자가는 보증금도 없음)
    if (key === "housing" && (value === "전세" || value === "자가")) {
      nextProfile = { ...nextProfile, rentManwon: "", ...(value === "자가" ? { depositManwon: "" as const } : {}) };
    }
    const nextExtra = isProfileKey(key)
      ? extra
      : {
          ...extra,
          [key]: String(value),
          // 시도가 바뀌면 이전 시군구는 버린다
          ...(key === "sido" && value !== extra.sido ? { sigungu: "" } : {}),
        };
    setProfile(nextProfile);
    setExtra(nextExtra);
    localStorage.setItem("gonggopass_profile", JSON.stringify({ profile: nextProfile, extra: nextExtra }));
  };
  const closeOnboard = () => {
    if (onboard && !onboard.single) localStorage.setItem("gonggopass_onboarded", "1");
    setOnboard(null);
  };
  const closeWelcome = () => {
    localStorage.setItem("gonggopass_onboarded", "1");
    setWelcome(null);
  };

  const newChat = () => {
    if (working) return;
    setMessages([]);
    setChatId(`c-${Date.now()}`);
    setSummary(null);
    setUpload(null);
    setProfile(loadSavedInfo().profile);
    setFocusId(null);
    setAskState(null);
    setCtx("");
    setMarkedTargets({});
    setView("combo");
  };
  // 답변의 기준 정책: 서류 검수 결과가 있는 정책을 먼저 고른다
  const policyKeyOf = (m: Message) => {
    const policies = m.card?.policies || [];
    if (!policies.length) return null;
    const i = policies.findIndex((_, n) => policyState[`${m.id}#${n}`]?.audit);
    return `${m.id}#${Math.max(i, 0)}`;
  };
  const focusAnswer = (m: Message) => {
    setFocusId(m.id);
    const key = policyKeyOf(m);
    if (key) setCtx(key);
  };
  const openChat = (id: string) => {
    const c = chats.find((x) => x.id === id);
    if (!c || working) return;
    setMessages(c.messages);
    setChatId(id);
    // 다시 열어도 패널이 그 대화의 정책과 검수 결과를 보여 주게 한다
    const last = [...c.messages].reverse().find((m) => m.card?.policies?.length);
    setCtx(last ? policyKeyOf(last) || "demo" : "demo");
    setFocusId(last?.id ?? null);
  };
  const deleteChat = (id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === chatId) newChat();
  };

  // 질문과 관련된 내 도구를 링크로 덧붙인다 (답변에 이미 있는 주소는 제외)
  const relatedLinks = (question: string, reply: string) => {
    const hits = myTools.filter(
      (t) => !reply.includes(t.url) && [t.name, ...(t.keywords || [])].some((k) => question.includes(k))
    );
    return hits.length ? `\n\n관련 사이트\n${hits.map((t) => `- ${t.name}: ${t.url}`).join("\n")}` : "";
  };

  const scrollDown = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  // 글이 줄어들 때도 스크롤 위치가 바뀌므로, 실제 휠·터치 입력만 '위로 올려 읽는 중'으로 본다
  const stopFollowing = () => {
    followRef.current = false;
    lastUserScrollRef.current = Date.now();
  };
  const onChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el || Date.now() - lastUserScrollRef.current < 300) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) followRef.current = true;
  };
  // 진행 단계와 AI 판단 글이 늘어나면 화면도 함께 내려간다
  const followProgress = () => {
    const el = chatScrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  };

  const uploadAudit = upload?.result || null;
  const uploadRisks = uploadAudit ? risksOf(uploadAudit) : 0;
  const uploadFields = uploadAudit?.autoFilledFields || [];

  const display = (v: string) =>
    maskOnScreen ? v.replace(/(\d{6})-([1-4])\d{6}/g, "$1-$2******") : v;

  // Gemini 키는 서버(.env.local)에만 둔다. 브라우저는 연결 상태만 확인한다.
  const verifyKey = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping" }),
      });
      const data = await res.json();
      setApiConnected(Boolean(data.connected));
      setApiMsg(data.message || "");
    } catch {
      setApiConnected(false);
      setApiMsg("서버에 연결하지 못했습니다.");
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    // 예전 버전이 브라우저에 저장한 키는 지운다 (남아 있으면 서버 키보다 먼저 쓰여, 한도 초과 키가 계속 쓰였다)
    localStorage.removeItem("gonggopass_gemini_key");
    setPublicKey(localStorage.getItem("gonggopass_public_key") || "");
    verifyKey();
    setChats(loadLocal<Chat[]>("gonggopass_chats", []));
    const saved = loadLocal<{ added: string[]; custom: Site[] } | null>("gonggopass_tools", null);
    if (saved) {
      const safe = (saved.custom || []).filter((c) => isHttpUrl(c.url)).map((c) => ({ ...c, custom: true }));
      setCustom(safe);
      setAddedIds(saved.added || DEFAULT_TOOLS);
    }
    // 지난번에 조절한 사이드바·패널 너비
    const savedW = loadLocal<{ side?: number; panel?: number | null }>("gonggopass_widths", {});
    const sw = typeof savedW.side === "number" ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, savedW.side)) : SIDE_DEFAULT;
    const pw = typeof savedW.panel === "number" ? Math.min(window.innerWidth * 0.7, Math.max(PANEL_MIN, savedW.panel)) : null;
    widthsRef.current = { side: sw, panel: pw };
    setSideW(sw);
    setPanelW(pw);
    const savedInfo = loadSavedInfo();
    setProfile(savedInfo.profile);
    setExtra(savedInfo.extra);
    if (!localStorage.getItem("gonggopass_onboarded")) setWelcome({ intro: true });
    setPolicyState(loadLocal<Record<string, PolicyState>>("gonggopass_policy_state", {}));
    // 30일 지난 정책 정보는 버린다 (정책이 바뀌었을 수 있음)
    const month = Date.now() - 30 * 24 * 3600 * 1000;
    setFacts(
      Object.fromEntries(
        Object.entries(loadLocal<Record<string, PolicyDetail & { at: number }>>("gonggopass_policy_facts", {})).filter(
          ([, v]) => v.at > month
        )
      )
    );
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 실시간 공고: 내 정보가 채워지거나 조건이 바뀌면 온통청년·복지로·보조금24에서 조회한다 (서버 10분 캐시)
  const liveKey = [
    extra.sido, extra.sigungu, extra.interests, profile.age, extra.job, extra.housing, extra.marriage, extra.children, extra.education, extra.special, extra.company,
  ].join("|");
  useEffect(() => {
    if (!loaded || welcome) return;
    if (!hasAnyInfo) {
      setLive({ status: "idle", notices: [] });
      return;
    }
    let cancelled = false;
    const refresh = forceRefreshRef.current;
    forceRefreshRef.current = false;
    const t = window.setTimeout(async () => {
      setLive((l) => ({ ...l, status: "loading" }));
      try {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "gov24_recommend",
            publicDataApiKey: publicKey || undefined,
            refresh,
            sido: extra.sido,
            sigungu: extra.sigungu,
            interests: extra.interests ? extra.interests.split(",") : [],
            // 온통청년은 나이·취업상태·혼인·학력·우대 조건 코드로 거른다
            age: profile.age === "" ? undefined : profile.age,
            job: extra.job,
            housing: extra.housing,
            marriage: extra.marriage,
            children: extra.children,
            education: extra.education,
            special: extra.special ? extra.special.split(",") : [],
            company: extra.company,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        setLive(
          data.connected
            ? {
                status: "ok",
                notices: Array.isArray(data.notices) ? data.notices : [],
                sources: Array.isArray(data.sources) ? data.sources : [],
              }
            : { status: data.reason === "no_key" ? "no_key" : "error", notices: [] }
        );
      } catch {
        if (!cancelled) setLive({ status: "error", notices: [] });
      }
    }, refresh ? 0 : 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, hasAnyInfo, liveNonce, loaded, welcome]);

  useEffect(() => {
    if (loaded) localStorage.setItem("gonggopass_policy_state", JSON.stringify(policyState));
  }, [policyState, loaded]);

  useEffect(() => {
    if (loaded) localStorage.setItem("gonggopass_policy_facts", JSON.stringify(facts));
  }, [facts, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("gonggopass_chats", JSON.stringify(chats));
    } catch {
      // 브라우저 저장 공간이 가득 차면 이번 기록만 저장하지 않는다 (화면의 대화는 그대로)
    }
  }, [chats, loaded]);

  useEffect(() => {
    if (loaded) localStorage.setItem("gonggopass_tools", JSON.stringify({ added: addedIds, custom }));
  }, [addedIds, custom, loaded]);

  // 대화가 끝날 때마다 히스토리에 반영 (최근 30개)
  useEffect(() => {
    if (!loaded || !messages.length || messages.some((m) => m.pending)) return;
    setChats((prev) => {
      if (prev.find((c) => c.id === chatId)?.messages === messages) return prev;
      const title = messages.find((m) => m.role === "user")?.content.slice(0, 40) || "새 대화";
      return [{ id: chatId, title, updatedAt: Date.now(), messages }, ...prev.filter((c) => c.id !== chatId)].slice(0, 30);
    });
  }, [messages, chatId, loaded]);

  const saveKeys = async () => {
    localStorage.setItem("gonggopass_public_key", publicKey);
    await verifyKey();
    if (publicKey) {
      try {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ping_gov24", publicDataApiKey: publicKey }),
        });
        const data = await res.json();
        setPublicOk(Boolean(data.connected));
        setPublicMsg(data.message || "");
      } catch {
        setPublicOk(false);
        setPublicMsg("서버에 연결하지 못했습니다.");
      }
    } else {
      setPublicOk(false);
      setPublicMsg("");
    }
  };

  const patch = (id: string, m: Partial<Message>) =>
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, ...m, pending: false } : x)));

  const pushTurn = (user: Partial<Message> & { content: string }) => {
    const id = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", time: now(), ...user },
      { id, role: "assistant", content: "", time: now(), pending: true },
    ]);
    setWorking(true);
    followRef.current = true;
    scrollDown();
    return id;
  };

  // 탭을 전환하거나 스크롤해도 AI가 짚어준 빨간 상자 표시를 계속 유지
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-agent-target]").forEach((el) => {
      const key = el.getAttribute("data-agent-target") || "";
      const label = markedTargets[key];
      if (label) el.setAttribute("data-agent-marked", label);
      else el.removeAttribute("data-agent-marked");
    });
  }, [markedTargets, view, canvasOpen, summary, upload, messages]);

  const clearAgentTimers = () => {
    agentTimersRef.current.forEach((t) => window.clearTimeout(t));
    agentTimersRef.current = [];
  };

  const stopAgent = () => {
    stoppedRef.current = true;
    pausedRef.current = false;
    clearAgentTimers();
    abortRef.current?.abort();
    abortRef.current = null;
    if (pendingMsgIdRef.current) {
      patch(pendingMsgIdRef.current, { content: "사용자에 의해 작업이 중지되었습니다." });
      pendingMsgIdRef.current = null;
    }
    setWorking(false);
    setAgentActive(false);
    setAgentPaused(false);
    setAgentScanning(false);
    setAgentTarget(null);
  };

  const toggleAgentPause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setAgentPaused(next);
  };

  const waitWhilePaused = async () => {
    while (pausedRef.current && !stoppedRef.current) {
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  const finishAgentWithTarget = (
    finalThought: string,
    targets?:
      | { tab?: View; selector: string; label: string }[]
      | { tab?: View; selector: string; label: string }
      | null
  ) => {
    if (stoppedRef.current) return;
    clearAgentTimers();
    setAgentScanning(false);
    setAgentSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));
    setAgentThought(finalThought);

    const list = !targets ? [] : Array.isArray(targets) ? targets : [targets];
    if (list.length === 0) {
      const hideTimer = window.setTimeout(() => {
        setAgentTarget(null);
        setAgentActive(false);
      }, 1600);
      agentTimersRef.current.push(hideTimer);
      return;
    }

    const tabLabelMap: Record<View, string> = {
      answer: "답변 근거",
      combo: "받을 돈",
      recipe: "서류 준비",
      audit: "제출",
    };

    (async () => {
      let currentTab: View | undefined;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        await waitWhilePaused();
        if (stoppedRef.current) return;

        // 지정된 탭이 있으면 커서가 탭 버튼을 직접 클릭해 전환
        if (item.tab && item.tab !== currentTab) {
          setAgentTarget({
            selector: `tab-${item.tab}`,
            query: `[data-tab="${item.tab}"]`,
            label: `${tabLabelMap[item.tab]} 탭`,
            highlightBox: false,
            id: Date.now() + i * 10,
          });
          await new Promise((r) => setTimeout(r, 1250));
          await waitWhilePaused();
          if (stoppedRef.current) return;
          setView(item.tab);
          currentTab = item.tab;
          await new Promise((r) => setTimeout(r, 320));
        }

        await waitWhilePaused();
        if (stoppedRef.current) return;
        setAgentTarget({
          selector: item.selector,
          label: item.label,
          id: Date.now() + i * 10 + 1,
        });
        // 커서가 도착하는 순간(약 1초 뒤) 대상 요소에 빨간 상자를 붙이고 계속 유지한다
        await new Promise((r) => setTimeout(r, 1000));
        if (stoppedRef.current) return;
        setMarkedTargets((prev) => ({ ...prev, [item.selector]: item.label }));
        await new Promise((r) => setTimeout(r, 1200));
      }
      await waitWhilePaused();
      if (stoppedRef.current) return;
      setAgentTarget(null);
      setAgentActive(false);
    })();
  };

  const readFiles = (list: FileList | null) =>
    Promise.all(
      Array.from(list || []).map(
        (file) =>
          new Promise<Staged>((resolve) => {
            const binary = file.type.startsWith("image/") || file.type === "application/pdf";
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ fileName: file.name, mimeType: binary ? file.type : "text/plain", base64OrText: String(reader.result || "") });
            if (binary) reader.readAsDataURL(file);
            else reader.readAsText(file, "utf-8");
          })
      )
    );

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const files = await readFiles(el.files);
    setStaged((prev) => [...prev, ...files]);
    el.value = "";
  };

  // 패널 '사전 검수'에서 올린 서류는 채팅에도 남도록 같은 경로로 보낸다
  const uploadForPolicy = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const files = await readFiles(el.files);
    el.value = "";
    if (files.length) send(undefined, active ? `${active.p.name} 서류를 검수해 주세요.` : "", files);
  };
  // /api/agent/run SSE 스트리밍 호출: 서버 단계(step)와 Gemini 추론(thought)을 실시간으로 HUD에 반영한다.
  const callRunStream = async (payload: Record<string, unknown>, signal: AbortSignal) => {
    const res = await fetch("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ ...payload, stream: true }),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream") || !res.body) {
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalOk = true;
    let gotFinal = false; // result 또는 error 이벤트를 받았는지
    let finalData: Record<string, unknown> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split(/\r?\n\r?\n/);
      buf = blocks.pop() || "";

      for (const block of blocks) {
        let ev = "message";
        let dataStr = "";
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (ev === "step") {
            if (Array.isArray(parsed.steps)) setAgentSteps(parsed.steps);
            if (typeof parsed.thought === "string") setAgentThought(parsed.thought);
          } else if (ev === "thought" && typeof parsed.text === "string") {
            setAgentThought(parsed.text);
          } else if (ev === "result") {
            finalOk = true;
            gotFinal = true;
            finalData = parsed;
          } else if (ev === "error") {
            finalOk = false;
            gotFinal = true;
            finalData = parsed;
          }
        } catch {
          // 불완전 이벤트 무시
        }
      }
    }

    // 결과 이벤트 없이 스트림이 끝났으면 연결이 끊긴 것 (서버 재시작, 네트워크 등)
    if (!gotFinal) {
      return { ok: false, data: { message: "답변을 받는 도중 연결이 끊겼습니다. 같은 질문을 다시 보내 주세요." } };
    }
    return { ok: finalOk, data: finalData };
  };

  // AI 되묻기에 답하면: 내 정보를 갱신하고(저장) 같은 대화를 이어서 다시 판정한다
  const answerAsk = (msgId: string, a: AgentAsk, value: string, label: string) => {
    const key = ASK_FIELDS[a.field || ""]?.key;
    const num = Number(value);
    const override = key && value !== "" && Number.isFinite(num) ? { [key]: Math.max(0, num) } : undefined;
    if (key && override) setInfo(key, num);
    setMessages((prev) => prev.map((m) => (m.id === msgId && m.ask ? { ...m, ask: { ...m.ask, answer: label } } : m)));
    setAskState({ status: "resolved", question: a.question, answer: label });
    send(undefined, `${a.question} → ${label}`, undefined, override);
  };

  // ask: 후속 질문 칩처럼 입력창을 거치지 않고 바로 보내는 질문, filesArg: 패널에서 올린 서류
  const send = async (e?: React.FormEvent, ask?: string, filesArg?: Staged[], profileOverride?: Partial<ProfileInput>) => {
    const prof: ProfileInput = { ...profile, ...profileOverride };
    e?.preventDefault();
    const typed = (ask ?? input).trim();
    const files = filesArg ?? (ask ? [] : staged);
    if (working || (!typed && !files.length)) return;
    const text = typed || `첨부한 서류 ${files.length}건을 제출 전에 검수해 주세요.`;
    if (!ask) {
      setInput("");
      setStaged([]);
    }
    const auditFor = active; // 보낸 시점의 기준 정책
    const id = pushTurn({ content: text, attachments: files.map((f) => f.fileName) });
    pendingMsgIdRef.current = id;

    const isAudit = Boolean(files.length && (!typed || /검수|점검|반려/.test(text)));
    const ac = new AbortController();
    abortRef.current = ac;

    clearAgentTimers();
    stoppedRef.current = false;
    pausedRef.current = false;
    setAgentPaused(false);
    setAgentActive(true);
    setAgentScanning(isAudit || files.length > 0);
    setAgentTarget(null);
    setMarkedTargets({});
    setAgentSteps(
      isAudit
        ? [
            { label: "첨부 서류 전처리", status: "active" },
            { label: "서류 판독 · 점검", status: "pending" },
            { label: "교차 검증 리포트", status: "pending" },
          ]
        : [
            { label: "질문 의도 분석", status: "active" },
            { label: "정책·등록 사이트 탐색", status: "pending" },
            { label: "근거 카드 정리", status: "pending" },
          ]
    );
    setAgentThought("서버와 연결해 실시간 분석을 시작합니다...");

    try {
      // 첨부만 보내거나 검수를 요청하면 서류 검수, 질문을 함께 쓰면 첨부 문서 기반 답변
      if (isAudit) {
        const { ok, data } = await callRunStream(
          {
            action: "ocr_audit_docs",
            uploadedDocs: files,
            ...(auditFor && { policy: auditFor.p }),
          },
          ac.signal
        );
        await waitWhilePaused();
        if (stoppedRef.current) return;
        pendingMsgIdRef.current = null;
        if (!ok || !data.auditResult) {
          patch(id, { content: String(data.message || "서류 검수에 실패했습니다."), error: true });
          setAgentActive(false);
          setAgentScanning(false);
          return;
        }
        const result = data.auditResult as AuditResult;
        const n = risksOf(result);
        if (auditFor) {
          setPolicyState((s) => ({ ...s, [auditFor.key]: { ...s[auditFor.key], audit: result } }));
        } else {
          setUpload({ result, mode: String(data.mode || "local_rules"), note: data.note ? String(data.note) : undefined });
        }
        setView("audit");
        setCanvasOpen(true);
        patch(id, {
          content: n
            ? `첨부하신 서류 ${result.documents.length}건에서 **반려 위험 ${n}건**을 찾았습니다.\n\n${result.findings
                .filter((f) => f.severity !== "pass")
                .map((f, i) => `${i + 1}. ${f.title}`)
                .join("\n")}`
            : `첨부하신 서류 ${result.documents.length}건에서 **점검 기준에 걸리는 항목을 찾지 못했습니다.**`,
          artifact: {
            view: "audit",
            title: auditFor ? `${auditFor.p.name} 서류 검수` : "업로드 서류 검수 리포트",
            meta: `AI 판독 · 반려 위험 ${n}건`,
          },
        });
        finishAgentWithTarget(
          n ? `반려 위험 ${n}건을 찾았습니다. 빨간 표시 영역을 확인하세요.` : "서류 검수 완료 — 반려 위험이 없습니다.",
          [
            { tab: "audit", selector: "audit-risk", label: n ? `반려 위험 ${n}건` : "검수 완료" },
            ...(n ? [{ tab: "audit" as View, selector: "audit-findings", label: "보완할 항목" }] : []),
            { tab: "audit", selector: "audit-crosscheck", label: "서류 간 교차 검증" },
          ]
        );
        return;
      }

      const { ok, data } = await callRunStream(
        {
          action: "agent_chat",
          publicDataApiKey: publicKey,
          userMessage: text,
          uploadedDocs: files,
          knownPolicies: (() => {
            const recent = (text + messages.slice(-4).map((m) => m.content).join(" ")).replace(/\s+/g, "");
            return Object.entries(facts)
              .filter(([k]) => recent.includes(k))
              .sort((a, b) => b[1].at - a[1].at)
              .slice(0, 8)
              .map(([, { at: _at, ...p }]) => p); // eslint-disable-line @typescript-eslint/no-unused-vars
          })(),
          history: messages
            .filter((m) => !m.pending && !m.error && m.content)
            .slice(-8)
            .map(({ role, content }) => ({ role, content })),
          sites: myTools.map(({ name, url }) => ({ name, url })),
          // 입력하지 않은 항목은 보내지 않는다. 0은 0으로 보낸다.
          userProfile:
            hasProfileInput(prof) || Object.values(extra).some(Boolean)
              ? {
                  sigungu: extra.sigungu || undefined,
                  age: prof.age === "" ? undefined : prof.age,
                  income: prof.incomeManwon === "" ? undefined : prof.incomeManwon,
                  deposit: prof.depositManwon === "" ? undefined : prof.depositManwon,
                  rent: prof.rentManwon === "" ? undefined : prof.rentManwon,
                  sepMonths: prof.sepMonths === "" ? undefined : prof.sepMonths,
                  sido: extra.sido || undefined,
                  job: extra.job || undefined,
                  housing: extra.housing || undefined,
                  // 대안 찾기에서 실시간 공고를 내 조건으로 거를 때 쓰는 값
                  marriage: extra.marriage || undefined,
                  children: extra.children || undefined,
                  education: extra.education || undefined,
                  company: extra.company || undefined,
                  special: extra.special ? extra.special.split(",") : [],
                  interests: extra.interests ? extra.interests.split(",") : [],
                  // 추가 조건 (혼인·자녀·학력·병역·우대 조건 등)을 "항목: 값" 문장으로
                  more: extraSummary(info),
                }
              : undefined,
        },
        ac.signal
      );
      await waitWhilePaused();
      if (stoppedRef.current) return;
      pendingMsgIdRef.current = null;

      if (!ok || !data.reply) {
        patch(id, { content: String(data.message || "AI가 빈 답을 보냈습니다. 같은 질문을 다시 보내 주세요."), error: true });
        setAgentActive(false);
        setAgentScanning(false);
        return;
      }
      const replyText = String(data.reply);
      const cardData = data.card as AnswerCard | undefined;
      const eligibility = data.kind === "eligibility";
      const askData = data.kind === "ask" ? (data.ask as AgentAsk | undefined) : undefined;
      if (askData) {
        setAskState({ status: "waiting", question: askData.question, reason: askData.reason });
        if (window.innerWidth >= 1024) {
          setView("combo");
          setCanvasOpen(true);
        }
      } else {
        // 보낼 때의 상태가 아니라 최신 상태를 본다 (답변 직후 보낸 요청은 'resolved'를 유지해야 함)
        setAskState((s) => (s?.status === "waiting" ? null : s));
      }
      if (eligibility) {
        if (data.summary) setSummary(data.summary as Summary);
        if (cardData) {
          setFocusId(id);
          const ps: PolicyDetail[] = cardData.policies || [];
          if (ps.length) {
            setCtx(`${id}#0`);
            setFacts((f) => ({
              ...f,
              ...Object.fromEntries(ps.map((p) => [p.name.replace(/\s+/g, ""), { ...p, at: Date.now() }])),
            }));
          }
        }
        setView("combo");
        if (window.innerWidth >= 1024) setCanvasOpen(true);
      } else if (cardData) {
        setFocusId(id);
        setView("answer");
        const ps: PolicyDetail[] = cardData.policies || [];
        if (ps.length) {
          setCtx(`${id}#0`);
          setFacts((f) => ({
            ...f,
            ...Object.fromEntries(ps.map((p) => [p.name.replace(/\s+/g, ""), { ...p, at: Date.now() }])),
          }));
        }
        // 넓은 화면에서만 자동으로 연다 (좁은 화면에선 패널이 채팅을 가린다)
        if (window.innerWidth >= 1024) setCanvasOpen(true);
      }
      // 에이전트가 서류 대조 도구를 썼으면 그 결과를 해당 정책의 '사전 검수' 탭에 넣는다
      if (data.auditResult) {
        // 검수한 정책과 같은 이름의 정책에 붙인다 (없으면 첫 정책)
        const auditName = (data.auditPolicy as PolicyDetail | undefined)?.name;
        const auditIndex = Math.max(0, (cardData?.policies || []).findIndex((p) => p.name === auditName));
        const auditKey = cardData?.policies?.length ? `${id}#${auditIndex}` : null;
        if (auditKey) {
          setPolicyState((s) => ({ ...s, [auditKey]: { ...s[auditKey], audit: data.auditResult as AuditResult } }));
          setCtx(auditKey);
        } else {
          setUpload({ result: data.auditResult as AuditResult, mode: "gemini" });
        }
      }
      patch(id, {
        content:
          replyText +
          (data.needsKey
            ? "\n\n연결 설정에서 AI API 키를 넣으면 등록한 사이트를 검색해 질문 내용에 맞춰 답변합니다."
            : "") +
          (cardData || askData ? "" : relatedLinks(text, replyText)),
        traces: data.toolExecutions as ToolExecution[] | undefined,
        sources: data.sources as { title: string; url: string; registered?: boolean }[] | undefined,
        card: cardData || undefined,
        reasoning: (data.reasoning as Message["reasoning"]) || undefined,
        ask: askData,
        draft: (data.draft as AgentDraft | undefined) || undefined,
        checklist: (data.checklist as AgentChecklist | undefined) || undefined,
        files: (data.files as GeneratedFile[] | undefined)?.length ? (data.files as GeneratedFile[]) : undefined,
        verification: (data.verification as Verification | undefined) || undefined,
        plan: (data.plan as PlanStep[] | undefined) || undefined,
        ...(eligibility && {
          artifact: { view: "combo" as View, title: "자격 확인 결과", meta: "공고 조건과 내 정보 대조" },
        }),
      });
      if (eligibility && window.innerWidth >= 1024) {
        finishAgentWithTarget("자격 확인 결과를 정리했습니다.", [
          { tab: "combo", selector: "triage-calc", label: "자격 확인 결과" },
        ]);
      } else if (cardData && window.innerWidth >= 1024) {
        const hasPolicies = Boolean(cardData.policies && cardData.policies.length > 0);
        finishAgentWithTarget("답변 근거와 자격·발급 서류를 탭별로 정리했습니다.", [
          { tab: "answer", selector: "answer-summary", label: "답변 핵심 근거" },
          ...(cardData.steps?.length ? [{ tab: "answer" as View, selector: "answer-steps", label: "신청 체크리스트" }] : []),
          ...(hasPolicies
            ? [
                { tab: "recipe" as View, selector: "recipe-docs", label: "필요 서류 목록" },
              ]
            : []),
        ]);
      } else {
        finishAgentWithTarget("답변 정리를 완료했습니다.", null);
      }
    } catch (err) {
      if (stoppedRef.current || (err instanceof DOMException && err.name === "AbortError")) return;
      pendingMsgIdRef.current = null;
      patch(id, { content: "요청을 처리하지 못했습니다. 네트워크 상태를 확인하세요.", error: true });
      setAgentActive(false);
      setAgentScanning(false);
    } finally {
      setWorking(false);
      if (followRef.current) scrollDown();
    }
  };

  const downloadPackage = () => {
    if (!uploadAudit) return;
    const lines = [
      `[반려제로] 제출 전 점검 요약`,
      `점검 서류: 업로드 서류 · 반려 위험 ${uploadRisks}건`,
      `※ 사전 점검 결과이며 최종 판정은 접수 기관이 합니다.`,
      ``,
      ...(uploadFields.length
        ? [`1. 추출된 기입 항목`, ...uploadFields.map((f) => `- ${f.label}: ${f.value} [출처: ${f.sourceDoc}]`), ``]
        : []),
      `제출 파일명`,
      ...uploadAudit.documents.map((d, i) => `${i + 1}. ${d.renamedFileName} (원본: ${d.fileName})`),
    ];
    const content = lines.join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "반려제로_서류점검요약.txt";
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  };

  const filteredChats = sidebarSearch.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(sidebarSearch.trim().toLowerCase()))
    : chats;
  // 히스토리는 최근 3개만 보이고 나머지는 '더보기'로 (검색 중엔 전부)
  const HISTORY_PREVIEW = 3;
  const visibleChats =
    historyOpen || sidebarSearch.trim() ? filteredChats : filteredChats.slice(0, HISTORY_PREVIEW);

  const infoCard = onboard ? (
    <InfoOnboarding
      key={`${onboard.startKey || "start"}-${onboard.single}`}
      values={info}
      onSet={setInfo}
      onClose={closeOnboard}
      startKey={onboard.startKey}
      single={onboard.single}
    />
  ) : null;

  const promptCard = (
    // 두 층 입력창: 위 회색 띠(내 정보 · 첨부 파일) + 아래 흰 입력 카드(입력칸 · 첨부 · 보내기/정지)
    <form
      onSubmit={send}
      className="w-full rounded-[20px] border border-purple-100 bg-white/60 shadow-input transition-shadow focus-within:border-purple-300 focus-within:ring-2 focus-within:ring-purple-200"
    >
      {(!onboard || staged.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2">
          {!onboard && (
            <InfoTags
              values={info}
              onEdit={(k) => setOnboard({ startKey: k, single: true })}
              onStart={startInfo}
              onStartExtra={startExtra}
            />
          )}
          {staged.map((f, i) => (
            <FileChip
              key={`${f.fileName}-${i}`}
              name={f.fileName}
              onRemove={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
      <div className="rounded-[20px] bg-white px-3.5 pb-2.5 pt-3 ring-1 ring-purple-100">
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="메시지 입력"
          placeholder="청년 정책을 물어보거나 공고문·서류를 첨부하세요"
          // 기본 두 줄, 길어지면 최대 8줄까지 늘어난다 (field-sizing 미지원 브라우저는 두 줄 고정 + 스크롤)
          className="block min-h-[3rem] w-full resize-none border-0 bg-transparent px-0.5 text-[15px] leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:ring-0 [field-sizing:content] max-h-52"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <label
            aria-label="서류 첨부"
            title="서류 첨부"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Paperclip className="h-4 w-4" />
            <input type="file" multiple accept=".pdf,image/*,.txt" onChange={onFiles} className="sr-only" />
          </label>
          {working ? (
            <button
              type="button"
              onClick={stopAgent}
              aria-label="정지"
              title="정지 (ESC)"
              className="grid h-8 w-8 place-items-center rounded-full text-slate-900 transition-colors hover:bg-slate-100"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() && !staged.length}
              aria-label="보내기"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-white transition-colors hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );

  return (
    <div className="h-dvh w-screen overflow-hidden antialiased text-slate-800 selection:bg-brand-100 selection:text-brand-700">
      {welcome && (
        <WelcomeModal
          key={`${welcome.intro}-${welcome.group || "basic"}-${welcome.startKey || "start"}`}
          values={info}
          onSet={setInfo}
          onClose={closeWelcome}
          startKey={welcome.startKey}
          intro={welcome.intro}
          startGroup={welcome.group}
        />
      )}
      <AgentOverlay
        active={agentActive}
        paused={agentPaused}
        scanning={agentScanning}
        target={agentTarget}
        onStop={stopAgent}
      />
      <div className="flex h-full w-full overflow-hidden bg-white">
        {/* ───────── 사이드바 ───────── */}
        <aside
          aria-hidden={!sidebarOpen}
          style={{ "--side-w": `${sideW}px` } as React.CSSProperties}
          className={`shrink-0 overflow-hidden bg-[#fbfbfb] selection:bg-purple-200 max-lg:hidden ${
            resizing ? "" : "transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          } ${sidebarOpen ? "w-[var(--side-w)] border-r border-slate-100 opacity-100" : "w-0 border-r-0 opacity-0 pointer-events-none"}`}
        >
          <div
            className={`flex h-full w-[var(--side-w)] flex-col justify-between p-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              sidebarOpen ? "translate-x-0" : "-translate-x-4"
            }`}
          >
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between px-1.5 pt-1">
                <div className="flex items-center space-x-2.5">
                  {/* 파비콘과 같은 파일을 로고로 쓴다 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
                  <span className="font-semibold text-[17px] tracking-tight text-slate-900">반려제로</span>
                </div>
                <button
                  aria-label="사이드바 닫기"
                  onClick={() => setSidebarOpen(false)}
                  className="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100"
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={newChat}
                className="w-full bg-[#121212] hover:bg-black text-white text-xs font-medium py-2.5 px-4 rounded-xl flex items-center justify-center space-x-2 shadow-sm transition-all duration-150"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>새 대화</span>
              </button>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path
                      d="M21 21l-4.35-4.35M16.65 11a5.65 5.65 0 11-11.3 0 5.65 5.65 0 0111.3 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <input
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  className="w-full text-xs pl-8 pr-8 py-2 bg-slate-100/80 hover:bg-slate-100 focus:bg-white border border-transparent focus:border-slate-300 rounded-xl focus:outline-none transition-colors placeholder:text-slate-400 text-slate-700"
                  placeholder="공고 · 대화 검색"
                  type="text"
                />
                <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
                  <span className="text-[11px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 font-medium">
                    ⌘
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar pt-4 text-xs space-y-4 pr-1">
              <SidebarRecs
                hasInfo={hasAnyInfo}
                onStartInfo={startInfo}
                onAsk={(q) => send(undefined, q)}
                onRefresh={refreshLive}
                busy={working}
                search={sidebarSearch.trim().toLowerCase()}
                live={live}
              />
              <div>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block px-2.5 mb-1.5">
                  히스토리
                </span>
                {filteredChats.length === 0 ? (
                  <p className="px-2.5 py-1 text-[11px] leading-relaxed text-slate-400">
                    대화를 시작하면 여기에 저장됩니다.
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {visibleChats.map((c) => (
                      <div key={c.id} className="group relative">
                        <button
                          onClick={() => openChat(c.id)}
                          aria-current={c.id === chatId}
                          className={`block w-full text-left px-2.5 py-1.5 pr-7 rounded-lg truncate transition-colors ${
                            c.id === chatId
                              ? "bg-purple-100/70 font-medium text-purple-900"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          {c.title}
                        </button>
                        <button
                          aria-label={`대화 삭제: ${c.title}`}
                          onClick={() => deleteChat(c.id)}
                          className="absolute right-1 top-1 hidden h-6 w-6 place-items-center rounded text-slate-400 hover:text-red-600 focus-visible:grid group-hover:grid"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {!sidebarSearch.trim() && filteredChats.length > HISTORY_PREVIEW && (
                      <button
                        type="button"
                        onClick={() => setHistoryOpen((v) => !v)}
                        aria-expanded={historyOpen}
                        className="flex w-full items-center gap-1 px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-700"
                      >
                        <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
                        {historyOpen ? "접기" : `더보기 (${filteredChats.length - HISTORY_PREVIEW})`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 mt-auto border-t border-slate-100">
              <div
                onClick={() => setShowTools(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setShowTools(true);
                }}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-purple-300 flex items-center justify-center text-white text-xs font-semibold ring-1 ring-slate-200 shrink-0">
                    AI
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-medium text-slate-800 truncate leading-tight">연결 및 개인정보 설정</p>
                    <p className="text-[11px] text-slate-400 truncate leading-tight mt-0.5 flex items-center gap-1.5">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${apiConnected ? "bg-emerald-500" : "bg-slate-400"}`} />
                      {apiConnected ? "AI 연결됨" : "AI 연결 안 됨"}
                    </p>
                  </div>
                </div>
                <span className="text-slate-400 hover:text-slate-700 transition-colors p-1">
                  <Plug className="w-4 h-4" />
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* ───────── 메인 워크스페이스 ───────── */}
        {sidebarOpen && (
          <ResizeHandle
            label="사이드바 너비 조절"
            active={resizing === "side"}
            onPointerDown={startResize("side")}
            onReset={() => {
              setSideW(SIDE_DEFAULT);
              saveWidths(SIDE_DEFAULT, widthsRef.current.panel);
            }}
            onNudge={(dx) => nudge("side", dx)}
          />
        )}

        <main className="flex-1 flex flex-col bg-[#f6f4fe] overflow-hidden relative justify-between min-w-0">
          {/* 버튼만 채팅 위에 띄워서, 대화가 화면 맨 위까지 올라오게 한다 */}
          <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-2.5">
            <div className="pointer-events-auto flex items-center gap-2">
              {!sidebarOpen && (
                <IconButton label="사이드바 열기" onClick={() => setSidebarOpen(true)} className="bg-[#f6f4fe]/90 backdrop-blur max-lg:hidden">
                  <PanelLeft className="h-4 w-4" />
                </IconButton>
              )}
            </div>

            {(messages.length > 0 || !canvasOpen) && (
              <div
                className={`pointer-events-auto flex items-center space-x-1 rounded-xl bg-[#f6f4fe]/90 p-0.5 backdrop-blur ${
                  canvasOpen ? "lg:hidden" : ""
                }`}
              >
                {/* 좁은 화면에는 사이드바가 없어서 새 대화 버튼을 여기에 둔다 */}
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={newChat}
                    className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 lg:hidden"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>새 대화</span>
                  </button>
                )}
                {/* 패널이 열려 있으면 닫기 버튼은 패널 안에 있다 */}
                {!canvasOpen && (
                  <button
                    type="button"
                    aria-label="점검 패널 열기"
                    title="점검 패널 열기"
                    onClick={() => setCanvasOpen(true)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    <PanelRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </header>

          <div
            ref={chatScrollRef}
            onScroll={onChatScroll}
            onWheel={(e) => {
              if (e.deltaY < 0) stopFollowing();
            }}
            onTouchMove={stopFollowing}
            className="flex-1 overflow-y-auto no-scrollbar"
          >
            <div className="px-6 md:px-8 max-w-3xl mx-auto w-full min-h-full flex flex-col items-center pt-12 pb-6">
              {messages.length === 0 ? (
                // 첫 화면: 한 줄 소개 → 주요 기능 (입력창은 맨 아래 고정)
                <div className="flex w-full flex-1 flex-col items-center justify-center">
                  <div className="mb-6 flex flex-col items-center text-center">
                    <h1 className="animate-fade-up delay-2 text-2xl font-bold tracking-tight text-slate-900">
                      신청 전에, 떨어질 이유부터 찾아드려요
                    </h1>
                    <p className="animate-fade-up delay-3 mt-2 text-sm text-slate-500">
                      자격 계산부터 서류 검수, 사유서까지 AI가 먼저 확인합니다
                    </p>
                  </div>

                  <div className="mb-4 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      {
                        tag: "01",
                        label: "맞춤 지원금 찾기",
                        sub: "내 조건에 맞는 실시간 공고와 마감 일정",
                        onClick: () =>
                          hasAnyInfo
                            ? send(undefined, "내 조건에 맞는 청년 정책과 지원 내용, 신청 기간을 정리해 주세요.")
                            : startInfo(),
                      },
                      {
                        tag: "02",
                        label: "자격 조건 판독",
                        sub: "소득·주거 요건과 예외 특례 확인",
                        onClick: () =>
                          send(undefined, "내 소득과 거주 조건으로 신청 가능한 주거·생활 지원 자격을 확인해 주세요."),
                      },
                      {
                        tag: "03",
                        label: "필요 서류 확인",
                        sub: "공고별 제출 서류와 발급처 정리",
                        onClick: () => {
                          if (live.notices.some((n) => n.docs.length > 0)) {
                            setView("recipe");
                            setCanvasOpen(true);
                          } else {
                            send(undefined, "내 조건에서 신청 가능한 대표 청년 지원금의 필요 서류와 발급처를 알려 주세요.");
                          }
                        },
                      },
                      {
                        tag: "04",
                        label: "서류 사전 검수",
                        sub: "올린 서류의 누락·발급일·주소 일치 점검",
                        onClick: () => {
                          setView("audit");
                          setCanvasOpen(true);
                        },
                      },
                    ].map((card, idx) => (
                      <button
                        key={card.tag}
                        onClick={card.onClick}
                        disabled={working}
                        style={{ animationDelay: `${420 + idx * 70}ms` }}
                        className="animate-fade-up hover-lift rounded-xl border border-purple-100 bg-white p-3.5 text-left shadow-sm hover:border-purple-300 group disabled:opacity-50"
                      >
                        <div className="mb-2">
                          <span className="tnum inline-block text-[10px] font-semibold text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded">
                            {card.tag}
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-slate-800 mb-1">{card.label}</h4>
                        <p className="text-[11px] text-slate-400 leading-snug">{card.sub}</p>
                      </button>
                    ))}
                  </div>

                </div>
              ) : (
                <div className="w-full space-y-6 py-2">
                  {messages.map((msg) =>
                    msg.role === "user" ? (
                      <div key={msg.id} className="animate-fade-up flex flex-col items-end gap-1.5">
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {msg.attachments.map((a) => (
                              <FileChip key={a} name={a} />
                            ))}
                          </div>
                        )}
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-purple-50/90 border border-purple-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
                          {msg.content}
                        </div>
                        <span className="text-[11px] text-slate-400">{msg.time}</span>
                      </div>
                    ) : (
                      <div
                        key={msg.id}
                        className={`animate-fade-up space-y-3 transition-all duration-300 ${canvasOpen && view === "answer" && focusId === msg.id ? "-ml-4 border-l-2 border-brand-600 pl-[14px]" : ""}`}
                      >
                        {msg.pending ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2.5 text-sm text-slate-500">
                              <LiquidOrb size="sm" />
                              <span>찾아보고 정리하는 중</span>
                            </div>
                            {agentActive && (
                              <AgentPlanCard
                                paused={agentPaused}
                                steps={agentSteps}
                                thought={agentThought}
                                onGrow={followProgress}
                              />
                            )}
                          </div>
                        ) : (
                          <>
                            {msg.card ? (
                              <CardView card={msg.card} onAsk={(q) => send(undefined, q)} disabled={working}>
                                {msg.files?.map((f) => <FileCard key={downloadName(f)} file={f} />)}
                              </CardView>
                            ) : (
                              <>
                                <div
                                  className={`whitespace-pre-wrap text-sm leading-relaxed ${
                                    msg.error
                                      ? "rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-800"
                                      : "rounded-2xl border border-purple-100/90 bg-white px-4 py-3.5 text-slate-800 shadow-sm"
                                  }`}
                                >
                                  <Rich text={msg.content} />
                                </div>
                                {msg.files?.map((f) => <FileCard key={downloadName(f)} file={f} />)}
                              </>
                            )}

                            {msg.ask && (
                              <AskCard ask={msg.ask} disabled={working} onAnswer={(v, label) => answerAsk(msg.id, msg.ask!, v, label)} />
                            )}

                            {msg.card && (msg.draft || msg.checklist) && (
                              <div className="flex flex-wrap gap-1.5">
                                {msg.checklist && (
                                  <button
                                    onClick={() => {
                                      focusAnswer(msg);
                                      setView("answer");
                                      setCanvasOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50"
                                  >
                                    <ListChecks className="h-3.5 w-3.5" />
                                    제출 체크리스트 {msg.checklist.items.length}단계
                                  </button>
                                )}
                                {msg.draft && (
                                  <button
                                    onClick={() => {
                                      focusAnswer(msg);
                                      setView("answer");
                                      setCanvasOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50"
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    {msg.draft.title} 초안
                                  </button>
                                )}
                              </div>
                            )}

                            {!msg.card && msg.artifact && (
                              <button
                                onClick={() => {
                                  setView(toView(msg.artifact!.view));
                                  setCanvasOpen(true);
                                }}
                                className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-purple-300 hover:bg-purple-50/40"
                              >
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-purple-100/70 text-purple-700">
                                  <FileText className="h-4 w-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium">{msg.artifact.title}</span>
                                  <span className="block truncate text-xs text-slate-500">{msg.artifact.meta}</span>
                                </span>
                                <span className="text-xs text-purple-600 font-medium group-hover:text-purple-800">열기</span>
                              </button>
                            )}

                            <AnswerMeta
                              msg={msg}
                              open={Boolean(expanded[msg.id])}
                              sourcesOpen={Boolean(expanded[`${msg.id}:src`])}
                              onToggle={() => setExpanded((e) => ({ ...e, [msg.id]: !e[msg.id] }))}
                              onToggleSources={() => setExpanded((e) => ({ ...e, [`${msg.id}:src`]: !e[`${msg.id}:src`] }))}
                              onOpenArtifact={
                                msg.card && msg.artifact
                                  ? () => {
                                      setView(toView(msg.artifact!.view));
                                      setCanvasOpen(true);
                                    }
                                  : undefined
                              }
                              onOpenPanel={() => {
                                focusAnswer(msg);
                                setView("answer");
                                setCanvasOpen(true);
                              }}
                            />
                          </>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* 입력창을 화면 맨 아래에 붙인다 (아래 안내 문구 줄은 뺐다) */}
          <div className="shrink-0 px-6 md:px-8 pb-4 max-w-3xl mx-auto w-full space-y-3">
            {infoCard}
            {promptCard}
          </div>
        </main>

      {canvasOpen && (
        <ResizeHandle
          label="점검 패널 너비 조절"
          active={resizing === "panel"}
          onPointerDown={startResize("panel")}
          onReset={() => {
            setPanelW(null);
            saveWidths(widthsRef.current.side, null);
          }}
          onNudge={(dx) => nudge("panel", dx)}
        />
      )}

      {/* ───────── 결과 패널 ───────── */}
      <section
        aria-hidden={!canvasOpen}
        style={panelW ? ({ "--panel-w": `${panelW}px` } as React.CSSProperties) : undefined}
        className={`flex shrink-0 flex-col overflow-hidden bg-[#fbfbfb] max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-full ${
          resizing ? "" : "transition-[width,opacity,transform,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        } ${
          canvasOpen
            ? `${panelW ? "lg:w-[var(--panel-w)]" : "lg:w-[46%]"} lg:border-l lg:border-slate-100 opacity-100 max-lg:translate-x-0`
            : "lg:w-0 lg:border-l-0 opacity-0 pointer-events-none max-lg:translate-x-full"
        }`}
      >
        <div
          className={`flex h-full w-full min-w-[360px] max-lg:min-w-0 flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            canvasOpen ? "translate-x-0" : "lg:translate-x-6"
          }`}
        >
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-white/80 px-4 backdrop-blur">
            {panelHasData ? (
              <PanelTabs
                tabs={focusMsg ? [{ id: "answer" as View, label: "답변 근거" }, ...VIEWS] : VIEWS}
                value={view}
                onChange={setView}
              />
            ) : (
              <span className="text-xs font-medium text-slate-400">점검 결과</span>
            )}
            <IconButton
              label="점검 패널 닫기"
              onClick={() => setCanvasOpen(false)}
              className="shrink-0 bg-purple-50 !text-purple-700 hover:bg-purple-100"
            >
              <PanelRight className="h-4 w-4" />
            </IconButton>
          </div>

          <div key={panelHasData ? view + ctx : "empty"} className="stagger flex-1 space-y-4 overflow-y-auto p-5">
            {!panelHasData ? (
              <div className="flex h-full min-h-[260px] items-center justify-center">
                <Empty text="질문을 입력하거나 서류를 첨부하면 점검 결과가 여기에 표시됩니다." />
              </div>
            ) : (
              <>
                {askState && (
                  <div
                    className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-[13px] ${
                      askState.status === "waiting"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-emerald-200 bg-emerald-50 text-emerald-900"
                    }`}
                  >
                    {askState.status === "waiting" ? (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : working ? (
                      <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {askState.status === "waiting"
                          ? "판정 보류 · 확인이 필요한 정보가 있습니다"
                          : working
                          ? "답변을 반영해 다시 판정하는 중"
                          : "답변을 반영해 다시 판정했습니다"}
                      </div>
                      <div className="mt-0.5 opacity-90">
                        {askState.question}
                        {askState.status === "resolved" && askState.answer ? ` → ${askState.answer}` : ""}
                      </div>
                      {askState.status === "waiting" && (
                        <div className="mt-0.5 text-xs opacity-75">
                          {askState.reason ? `${askState.reason} · ` : ""}채팅에서 답하면 자동으로 다시 판정합니다
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {view !== "answer" && policyOptions.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="shrink-0">기준 정책</span>
                <select
                  value={active ? active.key : ""}
                  onChange={(e) => (e.target.value === "" ? setCtx("") : choosePolicy(e.target.value))}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm hover:border-purple-200 focus:border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-200"
                >
                  <option value="">내 조건 맞춤 실시간 공고</option>
                  {policyOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {active && view === "recipe" && (
              <PolicyDocs p={active.p} st={pst} onChange={setPst} sites={myTools} onAsk={(q) => send(undefined, q)} busy={working} />
            )}
            {/* 제출 = 서류 검수 + 신청 패키지 */}
            {active && view === "audit" && (
              <>
                {linkedMsg && <ActionOutputs msg={linkedMsg} onUpdate={(p) => patch(linkedMsg.id, p)} />}
                <PolicyAudit p={active.p} st={pst} onUpload={uploadForPolicy} busy={working} display={display} />
                <PolicyPackage p={active.p} st={pst} steps={active.steps} links={active.links} />
              </>
            )}
            {/* 답변 근거: 채팅에서 고른 답변의 도구·출처·체크리스트 */}
            {view === "answer" &&
              (focusMsg?.card ? (
                <AnswerPanel
                  key={focusMsg.id}
                  question={messages[messages.indexOf(focusMsg) - 1]?.content || ""}
                  msg={focusMsg}
                  card={focusMsg.card}
                  sites={myTools}
                  onOpen={(i, v) => choosePolicy(`${focusMsg.id}#${i}`, v)}
                  onUpdate={(p) => patch(focusMsg.id, p)}
                />
              ) : (
                <Card>
                  <Empty text="채팅 답변의 '근거·출처'를 누르면 여기에 표시됩니다." />
                </Card>
              ))}

            {/* 받을 돈: 기준 정책을 골랐으면 그 정책의 조건 판독, 아니면 실시간 맞춤 공고 */}
            {active && view === "combo" && (
              <>
                <PolicyTriage p={active.p} st={pst} onChange={setPst} onAsk={(q) => send(undefined, q)} busy={working} />
                <PolicyNearMissCard
                  policyName={active.p.name}
                  limits={active.p.limits}
                  profile={{
                    age: profile.age === "" ? null : profile.age,
                    incomeManwon: profile.incomeManwon === "" ? null : profile.incomeManwon,
                    depositManwon: profile.depositManwon === "" ? null : profile.depositManwon,
                    rentManwon: profile.rentManwon === "" ? null : profile.rentManwon,
                    sepMonths: profile.sepMonths === "" ? null : profile.sepMonths,
                  }}
                />
              </>
            )}
            {view === "combo" && summary && (!active || similarName(active.p.name, summary.policyName)) && (
              <Card target="triage-calc">
                <CardHead title={`${summary.policyName} 자격 확인`} desc={summary.basis} action={<SourceBadge source="calc" />} />
                <div className="space-y-3 p-4">
                  <div className={`rounded-xl border px-3.5 py-2.5 text-[13px] ${VERDICT[summary.verdict].cls}`}>
                    <div className="font-semibold">{VERDICT[summary.verdict].title}</div>
                    <div className="mt-0.5 text-xs opacity-90">{VERDICT[summary.verdict].body}</div>
                  </div>
                  {summary.checks.length > 0 && (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                      {summary.checks.map((c) => (
                        <li key={c.label} className="flex items-start justify-between gap-3 px-3 py-2 text-[13px]">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800">{c.label}</div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              내 정보 {c.mine} · {c.basis}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${CHECK_STATUS[c.status].cls}`}>
                            {CHECK_STATUS[c.status].label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {summary.others.length > 0 && (
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                      <div className="font-medium text-slate-700">직접 확인할 조건</div>
                      <ul className="mt-1 space-y-0.5">
                        {summary.others.map((o) => (
                          <li key={o}>• {o}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Card>
            )}
            {view === "combo" && !active && !hasAnyInfo && !summary && (
              <EmptyCta text="내 정보를 입력하면 조건에 맞는 실시간 공고와 자격을 찾아 드려요." action="내 정보 입력하기" onClick={startInfo} />
            )}
            {view === "combo" && !active && hasAnyInfo && (
              <LiveBenefitsPanel live={live} onAsk={(q) => send(undefined, q)} onRefresh={refreshLive} busy={working} />
            )}

            {/* 서류 준비 */}
            {view === "recipe" && !active && (
              <>
                <LiveDocsPanel notices={live.notices} onAsk={(q) => send(undefined, q)} busy={working} />
                {!live.notices.some((n) => n.docs.length > 0) && (
                  <EmptyCta
                    text={
                      hasAnyInfo
                        ? "채팅에서 정책을 물어보거나 공고문을 첨부하면 필요한 서류와 발급 방법이 여기에 정리됩니다."
                        : "내 정보를 입력하거나 채팅에서 정책을 물어보면 필요한 서류가 여기에 정리됩니다."
                    }
                    action={!hasAnyInfo ? "내 정보 입력하기" : undefined}
                    onClick={!hasAnyInfo ? startInfo : undefined}
                  />
                )}
              </>
            )}

            {/* 제출 = 업로드 서류 검수 및 정리 */}
            {view === "audit" && !active && !uploadAudit && (
              <Card>
                <CardHead
                  title="제출 전 서류 검수"
                  desc="등본·계약서·가족관계증명서 등 서류를 올리면 누락, 발급일, 성명·주소 일치를 점검합니다."
                  action={
                    <label
                      className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-700 ${working ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      서류 올리기
                      <input type="file" multiple accept=".pdf,image/*,.txt" onChange={uploadForPolicy} disabled={working} className="sr-only" />
                    </label>
                  }
                />
                <div className="space-y-2 px-4 pb-4 text-xs leading-relaxed text-slate-500">
                  <p>채팅 입력창의 클립 버튼으로 공고문을 먼저 올리거나 정책을 고르면 그 공고 기준으로 검수합니다.</p>
                  <p className="rounded-lg bg-amber-50/70 px-3 py-2 text-amber-900">
                    이미지·PDF는 판독을 위해 원본이 AI 서버로 전송됩니다. 주민번호 뒷자리 등 민감한 정보는 가린 뒤 올려 주세요. 텍스트(.txt)는 주민번호·연락처·계좌를 가린 뒤 전송합니다.
                  </p>
                </div>
              </Card>
            )}
            {view === "audit" && !active && uploadAudit && upload && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-purple-200 hover:bg-slate-50 ${working ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    서류 다시 올리기
                    <input type="file" multiple accept=".pdf,image/*,.txt" onChange={uploadForPolicy} disabled={working} className="sr-only" />
                  </label>
                </div>

                <AuditReport audit={uploadAudit} display={display} />

                <div className="flex items-center gap-2 pt-2 text-xs font-semibold text-slate-500">
                  <span>검수 정리</span>
                  <span className="h-px flex-1 bg-slate-200" />
                  {uploadRisks > 0 && <span className="font-medium text-amber-700">반려 위험 {uploadRisks}건 보완 후 제출</span>}
                </div>

                {uploadFields.length > 0 && (
                  <Card target="package-form">
                    <CardHead title="서류에서 읽은 항목" desc="올린 서류에서 추출한 값" />
                    <dl className="divide-y divide-slate-100">
                      {uploadFields.map((f) => (
                        <div key={f.label} className="px-4 py-2.5 text-[13px]">
                          <dt className="text-xs text-slate-500">{f.label}</dt>
                          <dd className="mt-0.5">{display(f.value)}</dd>
                          <dd className="mt-0.5 text-xs text-slate-400">출처: {f.sourceDoc}</dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                )}

                {uploadAudit.documents.length > 0 && (
                  <Card target="package-files">
                    <CardHead title="제출 파일명" desc="제출용으로 정리한 파일 이름" />
                    <ul className="divide-y divide-slate-100">
                      {uploadAudit.documents.map((d) => (
                        <li key={d.docId} className="px-4 py-2.5 text-[13px]">
                          <div className="font-mono text-xs">{d.renamedFileName}</div>
                          <div className="text-xs text-slate-400">원본: {d.fileName}</div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <button
                  onClick={downloadPackage}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 active:translate-y-px"
                >
                  {downloaded ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  {downloaded ? "내려받았습니다" : "점검 요약 내려받기 (.txt)"}
                </button>
              </>
            )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ───────── 도구 · 연결 ───────── */}
      {showTools && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowTools(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="도구와 연결"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-xl animate-scale-in"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-semibold">도구와 연결</h2>
              <IconButton label="닫기" onClick={() => setShowTools(false)}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>

            <div className="space-y-7 overflow-y-auto p-5">
              <section>
                <h3 className="text-[13px] font-semibold">사이트</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  추가한 사이트는 왼쪽 &lsquo;내 도구&rsquo;에 모이고, 답변할 때 이 사이트부터 검색해 출처로 표시합니다. 로그인은 각
                  사이트에서 직접 합니다. 이 앱은 인증서나 비밀번호를 받지 않습니다.
                </p>
                <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {allTools.map((t) => {
                    const on = addedIds.includes(t.id);
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <a
                            href={t.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[13px] font-medium hover:text-brand-700"
                          >
                            {t.name}
                            <ExternalLink className="h-3 w-3 text-slate-400" />
                          </a>
                          <div className="truncate text-xs text-slate-500">{t.desc}</div>
                        </div>
                        {t.custom && (
                          <button
                            aria-label={`${t.name} 삭제`}
                            onClick={() => {
                              setCustom((c) => c.filter((x) => x.id !== t.id));
                              setAddedIds((a) => a.filter((x) => x !== t.id));
                            }}
                            className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setAddedIds((a) => (on ? a.filter((x) => x !== t.id) : [...a, t.id]))}
                          aria-pressed={on}
                          className={`flex w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                            on
                              ? "border-brand-600 bg-brand-50 text-brand-700"
                              : "border-slate-300 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" strokeWidth={2.5} />}
                          {on ? "추가됨" : "추가"}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = siteName.trim();
                    let url = siteUrl.trim();
                    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
                    if (!name || !isHttpUrl(url)) {
                      setSiteError("이름과 올바른 주소(https://...)를 입력하세요.");
                      return;
                    }
                    const id = `custom-${Date.now()}`;
                    setCustom((c) => [...c, { id, name, url, desc: new URL(url).hostname, custom: true }]);
                    setAddedIds((a) => [...a, id]);
                    setSiteName("");
                    setSiteUrl("");
                    setSiteError("");
                  }}
                  className="mt-3"
                >
                  <div className="flex gap-2">
                    <input
                      value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      aria-label="사이트 이름"
                      placeholder="사이트 이름"
                      className="w-28 shrink-0 rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15"
                    />
                    <input
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      aria-label="사이트 주소"
                      placeholder="https://"
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      직접 추가
                    </button>
                  </div>
                  {siteError && <p className="mt-1.5 text-xs text-red-700">{siteError}</p>}
                </form>
              </section>

              <section>
                <h3 className="text-[13px] font-semibold">개인정보와 저장</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  대화 기록, 도구 목록, API 키는 이 브라우저에만 저장됩니다. 이미지·PDF 서류는 판독을 위해 원본이
                  외부 AI 서버로 전송됩니다.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={maskOnScreen}
                    onClick={() => setMaskOnScreen((v) => !v)}
                    className="flex items-center gap-2.5 text-[13px] text-slate-700"
                  >
                    <span
                      className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                        maskOnScreen ? "bg-brand-600" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          maskOnScreen ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </span>
                    주민번호 화면 마스킹
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("저장된 대화 기록을 모두 삭제할까요? 되돌릴 수 없습니다.")) {
                        setChats([]);
                        newChat();
                      }
                    }}
                    disabled={!chats.length}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-red-300 hover:text-red-700 disabled:opacity-40"
                  >
                    대화 기록 전체 삭제
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/* ───────── 작은 구성 요소 ───────── */

function LiquidOrb({ size = "md" }: { size?: "md" | "sm" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const small = size === "sm";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function syncSize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const fallback = small ? 36 : 144;
      const w = Math.round((canvas.clientWidth || fallback) * dpr);
      const h = Math.round((canvas.clientHeight || fallback) * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(syncSize);
      ro.observe(canvas);
    }
    syncSize();

    // 배경이 비치도록 투명 캔버스로 만든다 (색은 셰이더에서 알파를 곱해 내보냄)
    const ctxOpts = { alpha: true, premultipliedAlpha: true, antialias: true };
    const gl = (canvas.getContext("webgl", ctxOpts) || canvas.getContext("experimental-webgl", ctxOpts)) as WebGLRenderingContext | null;
    if (!gl) return () => ro?.disconnect();

    const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
    const fs = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_texCoord;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    float t = u_time * 1.2;

    float r = length(uv);
    float angle = atan(uv.y, uv.x);

    float baseRadius = 0.28;
    float wave1 = sin(angle * 3.0 + t * 1.5) * 0.028;
    float wave2 = cos(angle * 5.0 - t * 2.1) * 0.018;
    float wave3 = sin(angle * 2.0 + t * 0.9) * 0.022;
    float noiseWave = snoise(uv * 3.5 + vec2(t * 0.4, -t * 0.3)) * 0.025;
    float fluidRadius = baseRadius + wave1 + wave2 + wave3 + noiseWave;
    float dist = r - fluidRadius;
    float dropletMask = smoothstep(0.015, -0.015, dist);

    if (dropletMask <= 0.001) {
        float ambientGlow = exp(-r * 6.5) * 0.45;
        vec3 glowCol = vec3(0.65, 0.45, 0.95);
        float glowA = ambientGlow * smoothstep(0.5, 0.28, r);
        gl_FragColor = vec4(glowCol * glowA, glowA);
        return;
    }

    float normDist = clamp(r / fluidRadius, 0.0, 1.0);
    float z = sqrt(max(0.0, 1.0 - normDist * normDist));
    float internalRipple = sin(r * 26.0 - t * 3.5) * 0.04 * (1.0 - normDist);
    internalRipple += snoise(uv * 7.0 + vec2(t * 0.6, t * 0.8)) * 0.035;

    vec3 N = normalize(vec3(uv.x / fluidRadius + internalRipple, uv.y / fluidRadius + internalRipple, z));
    vec3 L1 = normalize(vec3(-0.45, 0.65, 0.85));
    vec3 L2 = normalize(vec3(0.55, -0.4, 0.6));
    vec3 V = vec3(0.0, 0.0, 1.0);

    float diff1 = max(dot(N, L1), 0.0);
    vec3 H1 = normalize(L1 + V);
    float spec1 = pow(max(dot(N, H1), 0.0), 38.0);
    vec3 H2 = normalize(L2 + V);
    float spec2 = pow(max(dot(N, H2), 0.0), 16.0);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.8);

    vec3 deepWater = vec3(0.48, 0.24, 0.86);
    vec3 clearLavender = vec3(0.78, 0.66, 0.98);
    vec3 waterHighlight = vec3(0.96, 0.94, 1.0);
    vec3 waterCore = vec3(0.62, 0.38, 0.92);

    vec3 col = mix(deepWater, clearLavender, diff1 * 0.7 + z * 0.5);
    col += waterCore * (1.0 - normDist) * 0.4;
    float caustics = pow(max(0.0, sin(r * 22.0 - t * 2.8) * cos(angle * 4.0 + t)), 2.0) * 0.25 * z;
    col += vec3(0.85, 0.75, 1.0) * caustics;
    col += waterHighlight * (spec1 * 1.35 + spec2 * 0.4);
    col = mix(col, vec3(0.92, 0.88, 1.0), fresnel * 0.75);

    float alpha = clamp(0.72 + fresnel * 0.26 + spec1 * 0.5, 0.0, 0.98);
    alpha *= dropletMask;

    gl_FragColor = vec4(col * alpha, alpha);
}`;

    function cs(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, cs(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");

    const mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = 1.0 - (event.clientY - rect.top) / rect.height;
        mouse.x = nx * canvas.width;
        mouse.y = ny * canvas.height;
      }
    };
    window.addEventListener("mousemove", onMove);

    let raf = 0;
    function render(t: number) {
      if (!canvas || !gl) return;
      if (typeof ResizeObserver === "undefined") syncSize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    }
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      ro?.disconnect();
    };
  }, [small]);

  return (
    <div
      className={
        small
          ? "animate-orb h-9 w-9 shrink-0 relative z-10"
          : "animate-orb w-36 h-36 mx-auto mb-3 relative z-10"
      }
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

function AskCard({
  ask,
  onAnswer,
  disabled,
}: {
  ask: AgentAsk & { answer?: string };
  onAnswer: (value: string, label: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const f = ASK_FIELDS[ask.field || ""] || { unit: "", type: "text" as const };
  if (ask.answer) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
        답변함: {ask.answer}
      </div>
    );
  }
  // 직접 입력한 숫자에만 단위를 붙인다 (AI가 준 선택지는 그대로)
  const submit = (v: string, fromOption = false) => {
    const t = v.trim();
    if (!t || disabled) return;
    onAnswer(t, !fromOption && f.type === "number" && f.unit ? `${t}${f.unit}` : t);
  };
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="text-xs font-medium text-amber-900">AI가 판정하려면 이 정보가 필요합니다</div>
      {ask.options && ask.options.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ask.options.map((o) => (
            <button
              key={o}
              onClick={() => submit(o, true)}
              disabled={disabled}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] text-slate-800 hover:border-brand-600 hover:text-brand-700 disabled:opacity-50"
            >
              {o}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
          className="mt-2 flex items-center gap-2"
        >
          <span className="flex min-w-0 flex-1 items-center rounded-md border border-slate-300 bg-white focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/15">
            <input
              type={f.type}
              min={f.type === "number" ? 0 : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={ask.question}
              autoFocus
              className="tnum w-full min-w-0 bg-transparent px-2.5 py-1.5 text-sm focus:outline-none"
            />
            {f.unit && <span className="shrink-0 pr-2.5 text-xs text-slate-400">{f.unit}</span>}
          </span>
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            답하기
          </button>
        </form>
      )}
    </div>
  );
}

function MiniTable({ rows }: { rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-left text-xs">
        <tbody>
          {rows.map((row, y) => (
            <tr key={y} className={y === 0 ? "bg-purple-50 font-semibold text-slate-800" : "border-t border-slate-100 text-slate-600"}>
              {row.map((c, x) => (
                <td key={x} className="min-w-[72px] px-2.5 py-1.5 align-top leading-relaxed">
                  <Rich text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// AI가 쓴 글·번역·표 결과물
function AnswerBody({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="space-y-2 text-[13px] leading-relaxed text-slate-700">
        {parseBlocks(text).map((b, i) =>
          b.type === "heading" ? (
            <p key={i} className={`font-semibold text-slate-900 ${b.level === 1 ? "text-sm" : "text-[13px]"}`}>
              <Rich text={b.text} />
            </p>
          ) : b.type === "bullet" ? (
            <p key={i} className="flex gap-2">
              <span className="text-slate-400">•</span>
              <span className="min-w-0">
                <Rich text={b.text} />
              </span>
            </p>
          ) : b.type === "table" ? (
            <MiniTable key={i} rows={b.rows} />
          ) : b.type === "code" ? (
            <pre key={i} className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-xs leading-relaxed text-slate-100">
              <code>{b.text}</code>
            </pre>
          ) : (
            <p key={i}>
              <Rich text={b.text} />
            </p>
          )
        )}
      </div>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-2 text-xs font-medium text-purple-700 hover:underline"
      >
        {copied ? "복사했습니다" : "복사"}
      </button>
    </div>
  );
}

// AI가 만든 파일: 이름과 내용 요약, 다운로드 버튼
function FileCard({ file }: { file: GeneratedFile }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-2.5 rounded-2xl border border-purple-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-900">{downloadName(file)}</p>
          <p className="truncate text-xs text-slate-500">
            {fileMeta(file)}
            {file.description ? ` · ${file.description}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              downloadFile(file);
              setFailed(false);
            } catch {
              setFailed(true);
            }
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-800"
        >
          <Download className="h-3.5 w-3.5" />
          다운로드
        </button>
      </div>
      {failed && <p className="text-xs text-red-700">파일을 만들지 못했습니다. 다시 요청해 주세요.</p>}
    </div>
  );
}

function CardView({
  card,
  onAsk,
  disabled,
  children,
}: {
  card: AnswerCard;
  onAsk: (q: string) => void;
  disabled: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="space-y-3.5 rounded-2xl border border-purple-100/90 bg-white p-4 shadow-sm">
        <p className="text-[15px] font-semibold leading-snug text-slate-900">{card.summary}</p>

        {card.body && <AnswerBody text={card.body} />}

        {card.facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-2">
            {card.facts.map((f) => (
              <div key={f.label} className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                <dt className="text-[11px] text-slate-500">{f.label}</dt>
                <dd className="tnum mt-0.5 text-[13px] font-medium leading-snug text-slate-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* 안 될 때 AI가 실시간 공고에서 찾아 온 다른 길 */}
        {(card.alternatives?.length ?? 0) > 0 && (
          <div className="space-y-2 rounded-xl border border-purple-100 bg-purple-50/50 p-3">
            <p className="text-xs font-semibold text-purple-800">대신 받을 수 있는 지원</p>
            <ul className="space-y-2">
              {card.alternatives!.map((a) => (
                <li key={a.ref || a.name} className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-purple-100">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold leading-snug text-slate-900">{a.name}</span>
                    {a.source && (
                      <span className="rounded bg-purple-100 px-1.5 py-px text-[10px] font-medium text-purple-700">{a.source}</span>
                    )}
                  </div>
                  {a.benefit && <p className="mt-1 text-xs leading-relaxed text-slate-600">{a.benefit}</p>}
                  {a.why && <p className="mt-0.5 text-xs leading-relaxed text-purple-700">{a.why}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {a.deadline && <span>{a.deadline}</span>}
                    {a.org && <span className="min-w-0 truncate">{a.org}</span>}
                    <button
                      type="button"
                      onClick={() => onAsk(`${a.name} 내 조건으로 받을 수 있는지와 신청 방법 알려줘`)}
                      disabled={disabled}
                      className="font-medium text-purple-700 hover:underline disabled:opacity-50"
                    >
                      자세히 묻기
                    </button>
                    {a.url && (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 font-medium text-purple-700 hover:underline"
                      >
                        신청처 <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {card.steps.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-400">진행 순서</p>
            <ol className="space-y-1.5 text-[13px] leading-snug text-slate-700">
              {card.steps.map((st, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                    {i + 1}
                  </span>
                  <span>{st}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {card.caution && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50/75 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
            <span>{card.caution}</span>
          </p>
        )}

        {card.links.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs">
            <span className="font-medium text-slate-400">바로가기</span>
            {card.links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-purple-700 hover:underline"
              >
                {l.name}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
      </div>

      {children}

      {card.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {card.followUps.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              disabled={disabled}
              className="rounded-full border border-purple-100 bg-white/80 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-purple-300 hover:text-purple-700 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)<>"']+)/g).map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-slate-900">
            {p.slice(2, -2)}
          </strong>
        ) : /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-brand-700 underline underline-offset-2 hover:text-brand-600">
            {p}
          </a>
        ) : (
          // 짝이 맞지 않아 남은 ** 기호는 보여 주지 않는다
          p.replace(/\*\*/g, "")
        )
      )}
    </>
  );
}

function SideLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 px-2 text-xs font-medium text-slate-500">{children}</div>;
}

function IconButton({
  label,
  onClick,
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-800 ${className}`}
    >
      {children}
    </button>
  );
}

function SourceBadge({ source }: { source: ToolSource }) {
  // 예전 대화에 저장된, 지금은 없는 출처 종류는 표시하지 않는다
  if (!SOURCE[source]) return null;
  return (
    <span
      title={SOURCE[source].hint}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${SOURCE[source].cls}`}
    >
      {SOURCE[source].label}
    </span>
  );
}

function StatusDot({ status }: { status: "done" | "warn" }) {
  return (
    <span
      aria-label={status === "warn" ? "확인 필요" : "완료"}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "warn" ? "bg-red-500" : "bg-emerald-500"}`}
    />
  );
}

function Pill({ tone, children }: { tone: "ok" | "bad" | "warn"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-700",
    bad: "bg-red-50 text-red-700",
    warn: "bg-amber-50 text-amber-800",
  }[tone];
  return <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function FileChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button aria-label={`${name} 제거`} onClick={onRemove} type="button" className="text-slate-400 hover:text-slate-700">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function ToolList({ tools }: { tools: ToolExecution[] }) {
  const [openStep, setOpenStep] = useState<number | null>(null);
  return (
    <ul className="divide-y divide-slate-100">
      {tools.map((t) => {
        const open = openStep === t.step;
        return (
          <li key={t.step}>
            <button
              onClick={() => setOpenStep(open ? null : t.step)}
              aria-expanded={open}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-purple-50/40"
            >
              <span className="tnum w-4 text-xs text-slate-400">{t.step}</span>
              <StatusDot status={t.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{t.title}</span>
                <span className="block truncate text-xs text-slate-500">{t.basis}</span>
              </span>
              <SourceBadge source={t.source} />
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-300 ${open ? "rotate-180 text-purple-600" : ""}`} />
            </button>
            {open && (
              <div className="animate-expand grid gap-4 bg-slate-50/70 px-4 py-3 sm:grid-cols-2">
                <KeyValues title="입력" data={t.input} />
                <KeyValues title="결과" data={t.output} />
                <div className="flex items-center justify-between text-xs text-slate-500 sm:col-span-2">
                  <code className="font-mono">{t.toolName}</code>
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-slate-800">
                      기관 페이지 <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PolicyCard({ p, sites, onOpen }: { p: PolicyDetail; sites: Site[]; onOpen: (v: View) => void }) {
  return (
    <Card>
      <div className="border-b border-slate-100 px-4 py-3.5">
        <h3 className="text-[15px] font-semibold text-slate-900">{p.name}</h3>
        {p.benefit && <p className="tnum mt-1 text-sm font-medium text-brand-700">{p.benefit}</p>}
        {(p.deadline || p.applyAt || p.asOf) && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {p.deadline && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">기한 · {p.deadline}</span>}
            {p.applyAt && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">신청 · {p.applyAt}</span>}
            {p.asOf && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">기준 · {p.asOf}</span>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ["recipe", "서류 준비"],
              ["audit", "서류 검수·제출"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => onOpen(v)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-purple-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {label} <ArrowRight className="h-3 w-3" />
            </button>
          ))}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-slate-100">
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-slate-500">자격 조건</div>
          {p.conditions.length ? (
            <ul className="mt-2 space-y-1.5">
              {p.conditions.map((c) => (
                <li key={c} className="flex items-start gap-2 text-[13px] text-slate-800">
                  {condTag(c) === "exclude" ? (
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} />
                  ) : (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} />
                  )}
                  <span>
                    {condText(c)}
                    {condTag(c) !== "basic" && (
                      <span
                        className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          condTag(c) === "exclude" ? "bg-red-50 text-red-700" : "bg-purple-50 text-purple-700"
                        }`}
                      >
                        {condTag(c) === "exclude" ? "해당 시 제외" : "특례"}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-slate-400">확인된 조건 없음</p>
          )}
        </div>
        <div className="border-t border-slate-100 px-4 py-3 sm:border-t-0">
          <div className="text-xs font-medium text-slate-500">필요 서류 {p.documents.length ? `${p.documents.length}종` : ""}</div>
          {p.documents.length ? (
            <ul className="mt-2 space-y-1.5">
              {p.documents.map((d) => {
                const site = siteFor(sites, d.where);
                return (
                  <li key={d.name} className="flex items-start gap-2 text-[13px]">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 text-slate-800">{d.name}</span>
                    {site ? (
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex shrink-0 items-center gap-0.5 text-xs text-brand-700 hover:underline"
                      >
                        {site.name} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      d.where && <span className="shrink-0 text-xs text-slate-500">{d.where}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-slate-400">확인된 서류 없음</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function AnswerPanel({
  question,
  msg,
  card,
  sites,
  onOpen,
  onUpdate,
}: {
  question: string;
  msg: Message;
  card: AnswerCard;
  sites: Site[];
  onOpen: (policyIndex: number, view: View) => void;
  onUpdate: (p: Partial<Message>) => void;
}) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const traces = msg.traces || [];
  const sources = msg.sources || [];
  const policies = card.policies || []; // 이전 버전에 저장된 답변에는 없음
  return (
    <>
      <Card target="answer-summary">
        <div className="px-4 py-3.5">
          <div className="text-xs text-slate-500">질문</div>
          <div className="mt-0.5 text-[13px] text-slate-800">{question}</div>
          <p className="mt-2.5 text-[15px] font-semibold leading-snug text-slate-900">{card.summary}</p>
        </div>
        {card.links.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
            {card.links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-700"
              >
                {l.name} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        )}
      </Card>

      <ActionOutputs msg={msg} onUpdate={onUpdate} />

      {policies.length > 0 && (
        <div className="space-y-3">
          <div className="px-1 text-xs font-medium text-slate-500">
            답변에 나온 정책 {policies.length}개 · 조건과 서류는 공고 원문으로 최종 확인하세요
          </div>
          {policies.map((p, i) => (
            <PolicyCard key={p.name} p={p} sites={sites} onOpen={(v) => onOpen(i, v)} />
          ))}
        </div>
      )}

      {card.steps.length > 0 && (
        <Card target="answer-steps">
          <CardHead
            title="신청 체크리스트"
            desc={`${Object.values(done).filter(Boolean).length} / ${card.steps.length} 완료`}
          />
          <ul className="divide-y divide-slate-100">
            {card.steps.map((st, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={Boolean(done[i])}
                    onChange={() => setDone((d) => ({ ...d, [i]: !d[i] }))}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className={done[i] ? "text-slate-400 line-through" : "text-slate-800"}>{st}</span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHead
          title={`도구 실행 ${traces.length}건`}
          desc={`실계산 ${traces.filter((t) => t.source === "calc").length} · 실시간 ${traces.filter((t) => t.source === "live").length}`}
        />
        {traces.length ? <ToolList tools={traces} /> : <Empty text="이 답변은 별도 도구 없이 만들어졌습니다." />}
      </Card>

      <Card>
        <CardHead
          title={`출처 ${sources.length}곳`}
          desc={`내 도구 ${sources.filter((s) => s.registered).length}곳 · 원문에서 직접 확인하세요`}
        />
        {sources.length ? (
          <ul className="divide-y divide-slate-100">
            {sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 truncate text-slate-800">{s.title}</span>
                  {s.registered && (
                    <span className="shrink-0 rounded border border-brand-600/30 bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
                      내 도구
                    </span>
                  )}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="검색 출처가 없습니다." />
        )}
      </Card>
    </>
  );
}

function AuditReport({
  audit,
  display,
}: {
  audit: Pick<AuditResult, "documents" | "findings" | "crossCheckMatrix">;
  display: (v: string) => string;
}) {
  const auditRisks = risksOf(audit);
  return (
    <>
                <div
                  data-agent-target="audit-risk"
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 shadow-sm ${
                    auditRisks ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
                  }`}
                >
                  {auditRisks ? <CircleAlert className="h-5 w-5 shrink-0" /> : <Check className="h-5 w-5 shrink-0" />}
                  <div>
                    <div className="text-sm font-semibold">
                      {auditRisks ? `반려 위험 ${auditRisks}건` : "감지된 반려 위험 없음"}
                    </div>
                    <div className="text-[13px] opacity-90">
                      {auditRisks
                        ? "아래 항목을 보완한 뒤 제출하세요."
                        : "점검한 기준 안에서의 결과이며 최종 판정은 접수 기관이 합니다."}
                    </div>
                  </div>
                </div>

                {auditRisks > 0 && (
                  <Card target="audit-findings">
                    <CardHead title="보완할 항목" />
                    <ol className="divide-y divide-slate-100">
                      {audit.findings
                        .filter((f) => f.severity !== "pass")
                        .map((f, i) => (
                          <li key={f.id} className="flex gap-3 p-4 text-[13px]">
                            <span className="tnum grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-100 text-[11px] font-semibold text-red-700">
                              {i + 1}
                            </span>
                            <div className="min-w-0 space-y-1.5">
                              <div className="font-medium">{f.title.replace(/^\[[^\]]+\]\s*/, "")}</div>
                              <p className="leading-relaxed text-slate-600">{f.detail}</p>
                              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                                <dt className="text-slate-500">근거</dt>
                                <dd className="text-slate-700">{f.ruleReference}</dd>
                                <dt className="text-slate-500">보완 방법</dt>
                                <dd className="font-medium text-slate-900">{f.fixAction}</dd>
                              </dl>
                            </div>
                          </li>
                        ))}
                    </ol>
                  </Card>
                )}

                {audit.crossCheckMatrix.length > 0 && (
                  <Card target="audit-crosscheck">
                    <CardHead title="서류 간 교차 검증" />
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[13px]">
                        <thead className="text-xs text-slate-500">
                          <tr className="border-b border-slate-100">
                            <th className="px-4 py-2 font-medium">항목</th>
                            <th className="px-2 py-2 font-medium">서류 A</th>
                            <th className="px-2 py-2 font-medium">서류 B</th>
                            <th className="px-4 py-2 font-medium">결과</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {audit.crossCheckMatrix.map((m) => (
                            <tr key={m.checkName}>
                              <td className="px-4 py-2.5 font-medium">{m.checkName}</td>
                              <td className="px-2 py-2.5 text-slate-600">{display(m.sourceA)}</td>
                              <td className="px-2 py-2.5 text-slate-600">{display(m.sourceB)}</td>
                              <td className="px-4 py-2.5">
                                <Pill tone={m.status === "pass" ? "ok" : "bad"}>
                                  {m.status === "pass" ? "일치" : "불일치"}
                                </Pill>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                {audit.documents.map((d) => (
                  <Card key={d.docId}>
                    <CardHead
                      title={d.headerTitle || d.docTitle}
                      desc={d.fileName}
                      action={
                        d.stampText ? (
                          <Pill tone={d.stampStatus === "valid" ? "ok" : "bad"}>{d.stampText}</Pill>
                        ) : undefined
                      }
                    />
                    <dl className="divide-y divide-slate-100">
                      {d.fields.map((f) => (
                        <div key={f.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                          <dt className="w-32 shrink-0 text-xs text-slate-500">{f.label}</dt>
                          <dd className="min-w-0 flex-1">{display(f.value)}</dd>
                          {f.status !== "ok" && f.errorTag && (
                            <Pill tone={f.status === "error" ? "bad" : "warn"}>{f.errorTag}</Pill>
                          )}
                        </div>
                      ))}
                    </dl>
                  </Card>
                ))}
    </>
  );
}

type CondAnswer = "yes" | "no" | "unsure";
interface PolicyState {
  cond?: Record<number, CondAnswer>;
  docs?: Record<number, boolean>;
  audit?: AuditResult;
}

// 공고문 분석 질문의 꼬리표: (제외)는 "해당"이면 탈락, (특례)는 "아님"이어도 탈락은 아니다
const condTag = (c: string) => (/\(제외\)\s*$/.test(c) ? "exclude" : /\(특례\)\s*$/.test(c) ? "special" : "basic");
const condText = (c: string) => c.replace(/\s*\((제외|특례)\)\s*$/, "");
const condResult = (c: string, a?: CondAnswer): "pass" | "fail" | "neutral" | "open" => {
  if (!a || a === "unsure") return "open";
  const t = condTag(c);
  if (t === "exclude") return a === "yes" ? "fail" : "pass";
  if (t === "special") return a === "yes" ? "pass" : "neutral";
  return a === "yes" ? "pass" : "fail";
};

// 발급처 이름이 내 도구와 같으면 바로 갈 수 있게 링크로
const siteFor = (sites: Site[], where?: string) =>
  where ? sites.find((s) => where.includes(s.name) || s.name.includes(where)) : undefined;

function PolicyHead({ p }: { p: PolicyDetail }) {
  return (
    <Card>
      <div className="px-4 py-3.5">
        <h3 className="text-[15px] font-semibold text-slate-900">{p.name}</h3>
        {p.benefit && <p className="tnum mt-1 text-sm font-medium text-brand-700">{p.benefit}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {p.deadline && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">기한 · {p.deadline}</span>}
          {p.applyAt && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">신청 · {p.applyAt}</span>}
          {p.asOf && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">기준 · {p.asOf}</span>}
        </div>
      </div>
    </Card>
  );
}

function AskButton({ q, onAsk, busy, children }: { q: string; onAsk: (q: string) => void; busy: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={() => onAsk(q)}
      disabled={busy}
      className="shrink-0 text-xs text-brand-700 hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function PolicyTriage({
  p,
  st,
  onChange,
  onAsk,
  busy,
}: {
  p: PolicyDetail;
  st: PolicyState;
  onChange: (s: Partial<PolicyState>) => void;
  onAsk: (q: string) => void;
  busy: boolean;
}) {
  const cond = st.cond || {};
  const n = p.conditions.length;
  const no = p.conditions.filter((_, i) => cond[i] === "no").length;
  const yes = p.conditions.filter((_, i) => cond[i] === "yes").length;
  const open = n - yes - no;
  const verdict = !n
    ? null
    : no
    ? { cls: "border-red-200 bg-red-50 text-red-900", title: `충족하지 않는 조건 ${no}개`, body: "이 조건 때문에 신청이 어려울 수 있습니다. 예외 규정은 공고 원문을 확인하세요." }
    : open === n
    ? { cls: "border-slate-200 bg-white text-slate-700", title: "조건마다 해당 여부를 골라 주세요", body: "고른 결과로 신청 가능성을 바로 알려 드립니다." }
    : open
    ? { cls: "border-amber-200 bg-amber-50 text-amber-900", title: `확인이 필요한 조건 ${open}개`, body: "모르는 조건은 '물어보기'로 채팅에서 확인할 수 있습니다." }
    : { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", title: "조건을 모두 충족합니다", body: "신청 대상일 가능성이 높습니다. 최종 판정은 접수 기관이 합니다." };

  return (
    <>
      <PolicyHead p={p} />
      {verdict && (
        <div className={`rounded-lg border px-4 py-3 ${verdict.cls}`}>
          <div className="text-sm font-semibold">{verdict.title}</div>
          <div className="mt-0.5 text-[13px] opacity-90">{verdict.body}</div>
        </div>
      )}
      <Card>
        <CardHead title="자격 조건 확인" desc={`${yes} / ${n} 충족 · AI가 검색으로 정리한 조건`} />
        {n ? (
          <ul className="divide-y divide-slate-100">
            {p.conditions.map((c, i) => (
              <li key={c} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[13px] text-slate-800">{c}</span>
                  {cond[i] === "unsure" && (
                    <AskButton q={`${p.name} 조건 '${c}'에 대해 자세히 알려줘`} onAsk={onAsk} busy={busy}>
                      물어보기
                    </AskButton>
                  )}
                </div>
                <div className="mt-2 inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
                  {(
                    [
                      ["yes", "해당"],
                      ["no", "아님"],
                      ["unsure", "모름"],
                    ] as [CondAnswer, string][]
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => onChange({ cond: { ...cond, [i]: v } })}
                      aria-pressed={cond[i] === v}
                      className={`rounded px-2.5 py-1 transition-colors ${
                        cond[i] === v
                          ? v === "yes"
                            ? "bg-emerald-600 text-white"
                            : v === "no"
                            ? "bg-red-600 text-white"
                            : "bg-slate-700 text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 py-4 text-[13px] text-slate-500">
            확인된 조건이 없습니다.
            <AskButton q={`${p.name} 자격 조건 알려줘`} onAsk={onAsk} busy={busy}>
              조건 물어보기
            </AskButton>
          </div>
        )}
      </Card>
    </>
  );
}

function PolicyDocs({
  p,
  st,
  onChange,
  sites,
  onAsk,
  busy,
}: {
  p: PolicyDetail;
  st: PolicyState;
  onChange: (s: Partial<PolicyState>) => void;
  sites: Site[];
  onAsk: (q: string) => void;
  busy: boolean;
}) {
  const docs = st.docs || {};
  const done = p.documents.filter((_, i) => docs[i]).length;
  return (
    <>
      <PolicyHead p={p} />
      <Card target="recipe-docs">
        <CardHead title={`준비할 서류 ${p.documents.length}종`} desc={`준비 완료 ${done} / ${p.documents.length}`} />
        {p.documents.length ? (
          <ul className="divide-y divide-slate-100">
            {p.documents.map((d, i) => {
              const site = siteFor(sites, d.where);
              return (
                <li key={d.name} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`${d.name} 준비 완료`}
                    checked={Boolean(docs[i])}
                    onChange={() => onChange({ docs: { ...docs, [i]: !docs[i] } })}
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-medium ${docs[i] ? "text-slate-400 line-through" : "text-slate-900"}`}>{d.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {d.where && <span>발급처 · {d.where}</span>}
                      <AskButton q={`${p.name}에 내는 ${d.name}은 어떻게 발급해?`} onAsk={onAsk} busy={busy}>
                        발급 방법 묻기
                      </AskButton>
                    </div>
                  </div>
                  {site && (
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-purple-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {site.name} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 py-4 text-[13px] text-slate-500">
            확인된 서류가 없습니다.
            <AskButton q={`${p.name} 신청할 때 필요한 서류 알려줘`} onAsk={onAsk} busy={busy}>
              서류 물어보기
            </AskButton>
          </div>
        )}
      </Card>
    </>
  );
}

function PolicyAudit({
  p,
  st,
  onUpload,
  busy,
  display,
}: {
  p: PolicyDetail;
  st: PolicyState;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  busy: boolean;
  display: (v: string) => string;
}) {
  return (
    <>
      <Card>
        <CardHead
          title={`'${p.name}' 기준 서류 검수`}
          desc={`필요 서류 ${p.documents.length}종 대비 누락, 발급일, 성명·주소 일치를 확인합니다.`}
          action={
            <label
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-700 ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              서류 올리기
              <input type="file" multiple accept=".pdf,image/*,.txt" onChange={onUpload} disabled={busy} className="sr-only" />
            </label>
          }
        />
        <p className="px-4 pb-3 text-xs text-slate-500">
          AI가 판독합니다. 텍스트 서류는 주민번호 등을 가린 뒤 보내고, 이미지·PDF는 원본이 전송됩니다. 서버에 저장하지 않습니다.
        </p>
      </Card>
      {st.audit ? (
        <AuditReport audit={st.audit} display={display} />
      ) : (
        <Card>
          <Empty text={busy ? "AI가 작업 중입니다. 서류 검수를 요청했다면 끝나는 대로 여기에 표시됩니다." : "아직 검수한 서류가 없습니다. 서류를 올리면 결과가 여기에 표시됩니다."} />
        </Card>
      )}
    </>
  );
}

function PolicyPackage({
  p,
  st,
  steps,
  links,
}: {
  p: PolicyDetail;
  st: PolicyState;
  steps: string[];
  links: { name: string; url: string }[];
}) {
  const [saved, setSaved] = useState(false);
  const results = p.conditions.map((c, i) => condResult(c, st.cond?.[i]));
  const yes = results.filter((r) => r === "pass").length;
  const no = results.filter((r) => r === "fail").length;
  const answered = results.filter((r) => r !== "open").length;
  const ready = p.documents.filter((_, i) => st.docs?.[i]).length;
  const risks = st.audit ? risksOf(st.audit) : null;
  const condLabel = (i: number) => ({ yes: "해당", no: "아님", unsure: "모름" })[st.cond?.[i] || "unsure"] || "미확인";

  const download = () => {
    const content = [
      `[반려제로] ${p.name} 신청 준비 요약`,
      p.benefit && `지원 내용: ${p.benefit}`,
      p.deadline && `기한: ${p.deadline}`,
      p.applyAt && `신청처: ${p.applyAt}`,
      p.asOf && `정보 기준: ${p.asOf}`,
      `※ AI가 검색으로 정리한 정보입니다. 공고 원문으로 확인하고, 최종 판정은 접수 기관이 합니다.`,
      ``,
      `1. 자격 조건 (${yes}/${p.conditions.length} 충족)`,
      ...p.conditions.map((c, i) => `- [${st.cond?.[i] ? condLabel(i) : "미확인"}] ${condText(c)}${condTag(c) === "exclude" ? " (해당 시 제외)" : condTag(c) === "special" ? " (특례)" : ""}`),
      ``,
      `2. 필요 서류 (${ready}/${p.documents.length} 준비)`,
      ...p.documents.map((d, i) => `- [${st.docs?.[i] ? "준비" : "미준비"}] ${d.name}${d.where ? ` (${d.where})` : ""}`),
      ``,
      `3. 서류 검수: ${risks === null ? "미실시" : `반려 위험 ${risks}건`}`,
      ...(st.audit?.findings.filter((f) => f.severity !== "pass").map((f) => `- ${f.title}: ${f.fixAction}`) || []),
      ``,
      `4. 신청 단계`,
      ...steps.map((s, i) => `${i + 1}. ${s}`),
      ...(links.length ? [``, `5. 바로가기`, ...links.map((l) => `- ${l.name}: ${l.url}`)] : []),
    ]
      .filter((l): l is string => typeof l === "string")
      .join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `반려제로_${p.name.replace(/\s+/g, "_")}_신청준비.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <>
      <PolicyHead p={p} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="서류 준비" value={`${ready} / ${p.documents.length}`} note="서류 준비 탭에서 체크" ok={ready === p.documents.length && ready > 0} />
        <Stat label="서류 검수" value={risks === null ? "미실시" : `위험 ${risks}건`} note="위에서 서류 올리기" ok={risks === 0} />
      </div>
      {steps.length > 0 && (
        <Card target="package-form">
          <CardHead title="신청 단계" />
          <ol className="divide-y divide-slate-100">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="tnum grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          {links.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
              {links.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:border-purple-200 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  {l.name} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          )}
        </Card>
      )}
      <button
        onClick={download}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 active:translate-y-px"
      >
        {saved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        {saved ? "내려받았습니다" : "신청 준비 요약 내려받기 (.txt)"}
      </button>
    </>
  );
}
function PanelTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: View; label: string }[];
  value: View;
  onChange: (v: View) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`);
      if (el && el.offsetWidth > 0) {
        setInd({ left: el.offsetLeft, width: el.offsetWidth });
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" && listRef.current ? new ResizeObserver(measure) : null;
    if (ro && listRef.current) ro.observe(listRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [value, tabs.length]);

  return (
    <div
      ref={listRef}
      role="tablist"
      className="no-scrollbar relative flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-xl bg-slate-100/80 p-1"
    >
      {ind && (
        <span
          aria-hidden
          className="tab-indicator absolute bottom-1 left-0 top-1 rounded-lg bg-white shadow-sm ring-1 ring-slate-200/70"
          style={{ transform: `translateX(${ind.left}px)`, width: ind.width }}
        />
      )}
      {tabs.map((t) => (
        <button
          key={t.id}
          data-tab={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`relative z-10 shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
            value === t.id ? "text-purple-700" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// AI가 만든 제출 직전 체크리스트와 제출용 초안. 체크와 수정 내용은 대화 기록에 함께 저장된다.
function ActionOutputs({ msg, onUpdate }: { msg: Message; onUpdate: (p: Partial<Message>) => void }) {
  const [copied, setCopied] = useState(false);
  const { draft, checklist } = msg;
  if (!draft && !checklist) return null;
  const doneN = checklist ? checklist.items.filter((x) => x.done).length : 0;
  const blanks = draft ? (draft.text.match(/\[[^\]]+\]/g) || []).length : 0;

  const download = () => {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([draft.text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `반려제로_${(draft.policyName || "정책").replace(/\s+/g, "_")}_${draft.title.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {checklist && (
        <Card target="action-checklist">
          <CardHead
            title="제출 직전 체크리스트"
            desc={`${doneN} / ${checklist.items.length} 완료${checklist.policyName ? ` · ${checklist.policyName}` : ""}`}
          />
          <ul className="divide-y divide-slate-100">
            {checklist.items.map((x, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 text-[13px] hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={Boolean(x.done)}
                    onChange={() =>
                      onUpdate({
                        checklist: { ...checklist, items: checklist.items.map((y, j) => (j === i ? { ...y, done: !y.done } : y)) },
                      })
                    }
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className={x.done ? "text-slate-400 line-through" : "font-medium text-slate-900"}>
                      <span className="tnum mr-1.5 text-slate-400">{i + 1}</span>
                      {x.task}
                    </span>
                    {x.detail && <span className="mt-0.5 block text-xs text-slate-500">{x.detail}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {draft && (
        <Card target="action-draft">
          <CardHead
            title={`${draft.title} 초안`}
            desc={draft.purpose || draft.policyName}
            action={
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(draft.text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "복사됨" : "복사"}
                </button>
                <button
                  onClick={download}
                  className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" />
                  .txt
                </button>
              </div>
            }
          />
          <div className="space-y-2 p-4">
            <textarea
              value={draft.text}
              onChange={(e) => onUpdate({ draft: { ...draft, text: e.target.value } })}
              rows={14}
              aria-label={`${draft.title} 초안`}
              className="block w-full rounded-md border border-slate-300 bg-white p-3 text-[13px] leading-relaxed focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15"
            />
            <p className="text-xs text-slate-500">
              AI가 쓴 초안입니다. {blanks ? `[ ]로 비워 둔 ${blanks}곳을 직접 채우고, ` : ""}사실과 다른 내용이 없는지 확인한 뒤 제출하세요. ·{" "}
              <span className="tnum">{draft.text.length.toLocaleString("ko-KR")}자</span>
            </p>
          </div>
        </Card>
      )}
    </>
  );
}

function Card({ children, target }: { children: React.ReactNode; target?: string }) {
  return (
    <section
      data-agent-target={target}
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow] duration-300 hover:border-purple-200/70 hover:shadow-[0_8px_24px_-14px_rgba(126,34,206,0.25)]"
    >
      {children}
    </section>
  );
}

function CardHead({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {desc && <p className="mt-0.5 truncate text-xs text-slate-500">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, note, ok, target }: { label: string; value: string; note: string; ok: boolean; target?: string }) {
  return (
    <div data-agent-target={target} className="hover-lift rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="tnum mt-1.5 text-xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"} ${ok ? "" : "animate-pulse"}`} />
        {note}
      </div>
    </div>
  );
}

function KeyValues({ title, data }: { title: string; data: Record<string, string> }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-500">{title}</div>
      <dl className="space-y-1.5 text-[13px]">
        {Object.entries(data).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-4 py-10 text-center text-[13px] text-slate-500">{text}</div>;
}

// 사이드바·패널 경계선: 끌어서 너비 조절, 두 번 누르면 기본값, ←/→ 키로도 조절
function ResizeHandle({
  label,
  active,
  onPointerDown,
  onReset,
  onNudge,
}: {
  label: string;
  active: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onReset: () => void;
  onNudge: (dx: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} (끌어서 조절 · 두 번 누르면 기본 크기)`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onNudge(-16);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onNudge(16);
        }
      }}
      // 화면 폭을 차지하지 않게 음수 여백으로 경계선 위에 겹친다
      className="group relative z-20 -mx-[3px] w-1.5 shrink-0 cursor-col-resize touch-none outline-none max-lg:hidden"
    >
      <span
        className={`absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-colors ${
          active ? "bg-purple-400" : "bg-transparent group-hover:bg-purple-300 group-focus-visible:bg-purple-400"
        }`}
      />
    </div>
  );
}

// AI가 처음 세운 계획과 실행 결과: "AI 계획 ① 자격 계산 ✓ → ② 웹 검색 ✓ → ③ 답변 정리 ✓ → 검증 ✓"
function PlanLine({ plan, verified }: { plan: PlanStep[]; verified?: boolean }) {
  const circled = "①②③④⑤⑥⑦⑧";
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500">
      <span className="font-semibold text-purple-600">AI 계획</span>
      {plan.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ArrowRight className="h-3 w-3 text-slate-300" aria-hidden />}
          <span className={s.done ? "text-slate-700" : "text-slate-400 line-through"} title={s.done ? "실행함" : "실행하지 않음"}>
            {circled[i] || `${i + 1}.`} {s.label}
            {s.done && <span className="ml-0.5 text-emerald-600">✓</span>}
          </span>
        </React.Fragment>
      ))}
      {verified !== undefined && (
        <>
          <ArrowRight className="h-3 w-3 text-slate-300" aria-hidden />
          <span className={verified ? "text-purple-700" : "text-amber-700"}>답변 검증 {verified ? "✓" : "!"}</span>
        </>
      )}
    </div>
  );
}

// 답변 아래 한 줄 메타 바: 검증 상태·추론 수준·근거·출처를 접어 두고 누를 때만 펼친다
function AnswerMeta({
  msg,
  open,
  sourcesOpen,
  onToggle,
  onToggleSources,
  onOpenPanel,
  onOpenArtifact,
}: {
  msg: Message;
  open: boolean;
  sourcesOpen: boolean;
  onToggle: () => void;
  onToggleSources: () => void;
  onOpenPanel: () => void;
  onOpenArtifact?: () => void;
}) {
  const v = msg.verification;
  const passed = v ? v.checks.filter((c) => c.ok).length : 0;
  const failed = v ? v.checks.filter((c) => !c.ok).length : 0;
  const hasDrawer = Boolean(v || msg.plan?.length || msg.reasoning || (!msg.card && msg.traces?.length));
  const hasSourcesInline = Boolean(!msg.card && msg.sources?.length);
  if (!hasDrawer && !hasSourcesInline && !msg.card && !onOpenArtifact) return null;

  return (
    <div className="space-y-2 pt-0.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
        {hasDrawer && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={`inline-flex items-center gap-1 transition-colors ${
              v && !v.passed
                ? "rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
                : v
                ? "font-medium text-purple-600 hover:text-purple-800"
                : "hover:text-slate-700"
            }`}
          >
            {v ? (
              v.passed ? (
                <Check className="h-3 w-3" strokeWidth={2.5} />
              ) : (
                <CircleAlert className="h-3 w-3" />
              )
            ) : null}
            <span>
              {v
                ? v.passed
                  ? `검증 ${passed}/${v.checks.length}`
                  : `검증 경고 ${failed}건 · 원문 확인`
                : msg.plan?.length
                ? "실행 과정"
                : !msg.card && msg.traces?.length
                ? `도구 ${msg.traces.length}건`
                : "추론 정보"}
            </span>
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}

        {msg.reasoning && (
          <span
            title={`${msg.reasoning.by === "ai" ? "AI가" : "규칙으로"} 질문 난이도를 판단: ${msg.reasoning.reason}`}
            className="text-slate-400"
          >
            {msg.reasoning.level === "high" ? "깊게 추론" : "기본 추론"}
          </span>
        )}

        {msg.card && (
          <button
            type="button"
            onClick={onOpenPanel}
            className="inline-flex items-center gap-1 text-slate-500 transition-colors hover:text-purple-700"
          >
            <PanelRight className="h-3 w-3" />
            근거·출처{(msg.sources?.length || 0) > 0 ? ` (${msg.sources!.length})` : ""}
          </button>
        )}

        {onOpenArtifact && (
          <button
            type="button"
            onClick={onOpenArtifact}
            className="inline-flex items-center gap-1 font-medium text-purple-600 transition-colors hover:text-purple-800 hover:underline"
          >
            <FileText className="h-3 w-3" />
            {msg.artifact?.title || "자격 판정 결과"}
          </button>
        )}

        {hasSourcesInline && (
          <button
            type="button"
            onClick={onToggleSources}
            aria-expanded={sourcesOpen}
            className="inline-flex items-center gap-1 text-slate-500 transition-colors hover:text-slate-800"
          >
            출처 {msg.sources!.length}곳
            <ChevronDown className={`h-3 w-3 transition-transform ${sourcesOpen ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {open && hasDrawer && (
        <div className="space-y-2.5 rounded-xl border border-slate-200/80 bg-white/90 p-3 text-xs">
          {msg.plan && msg.plan.length > 0 && <PlanLine plan={msg.plan} verified={v?.passed} />}
          {msg.reasoning && (
            <div className="text-slate-500">
              <span className="font-medium text-slate-700">
                {msg.reasoning.level === "high" ? "깊게 추론" : "기본 추론"}
              </span>{" "}
              · {msg.reasoning.reason}
            </div>
          )}
          {v && (
            <ul className="space-y-1 border-t border-slate-100 pt-2">
              {v.checks.map((c) => (
                <li key={c.name} className="flex gap-2">
                  <span
                    className={`shrink-0 font-medium ${
                      c.ok ? "text-purple-600" : c.severity === "fix" ? "text-amber-700" : "text-slate-500"
                    }`}
                  >
                    {c.ok ? "✓" : "!"} {c.name}
                  </span>
                  <span className="text-slate-500">{c.note}</span>
                </li>
              ))}
              {v.retried && <li className="text-[11px] text-slate-400">검증 기준에 맞춰 답변을 1회 보완했습니다.</li>}
            </ul>
          )}
          {!msg.card && msg.traces && msg.traces.length > 0 && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
              {msg.traces.map((t) => (
                <li key={t.step} className="flex items-center gap-3 py-1.5">
                  <StatusDot status={t.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-800">{t.title}</span>
                    <span className="block truncate text-[11px] text-slate-500">{t.basis}</span>
                  </span>
                  <SourceBadge source={t.source} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sourcesOpen && hasSourcesInline && (
        <ul className="flex flex-wrap gap-1.5">
          {msg.sources!.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex max-w-[16rem] items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-slate-50 ${
                  s.registered ? "border-brand-600/40 text-brand-700" : "border-slate-200 text-slate-600"
                }`}
              >
                <span className="truncate">{s.title}</span>
                {s.registered && <span className="shrink-0 font-medium">· 내 도구</span>}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 아직 입력이 없을 때 탭에 보여주는 빈 화면 (필요하면 입력 버튼)
function EmptyCta({ text, action, onClick }: { text: string; action?: string; onClick?: () => void }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
      <p className="max-w-xs text-[13px] leading-relaxed text-slate-500">{text}</p>
      {action && onClick && (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1 rounded-full bg-purple-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-purple-700"
        >
          <Plus className="h-3.5 w-3.5" />
          {action}
        </button>
      )}
    </div>
  );
}

function KeyField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  ok,
  link,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ok?: boolean;
  link?: { href: string; text: string };
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[13px] font-medium">
        <span className="flex items-center gap-2">
          {label}
          {ok && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">연결됨</span>}
        </span>
        {link && (
          <a href={link.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-normal text-brand-700 hover:underline">
            {link.text} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-[13px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15"
      />
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  );
}
