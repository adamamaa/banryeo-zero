"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Paperclip,
  Plus,
  RefreshCw,
  Plug,
  Trash2,
  X,
} from "lucide-react";
import { POLICY_SCENARIOS } from "@/data/policies";
import type { ToolExecution, ToolSource } from "@/lib/tools";
import type { AuditResult } from "@/lib/docRules";
import type { AnswerCard, PolicyDetail } from "@/lib/card";
import { AgentOverlay, AgentPlanCard, type AgentPlanStep, type AgentTarget } from "@/components/AgentOverlay";

const policy = POLICY_SCENARIOS[0];
const form = policy.applicationFormTemplate;

type View = "answer" | "tools" | "triage" | "recipe" | "audit" | "package";
type MissionKey = "all" | "triage" | "recipe" | "audit_defect" | "audit_fixed";
type AuditMode = "defect" | "fixed" | "upload";
type Verdict = "eligible" | "needs_parent_check" | "ineligible";

interface Summary {
  medianRatioPercent: number;
  totalConvertedRentKRW: number;
  convertedDepositKRW: number;
  verdict: Verdict;
  independent: boolean;
}

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

const DEMO_PROFILE: Profile = {
  age: 26,
  incomeManwon: 130,
  depositManwon: 1000,
  rentManwon: 75,
  sepMonths: 15,
};

const toProfile = (p: ProfileInput): Profile => ({
  age: Number(p.age) || 0,
  incomeManwon: Number(p.incomeManwon) || 0,
  depositManwon: Number(p.depositManwon) || 0,
  rentManwon: Number(p.rentManwon) || 0,
  sepMonths: Number(p.sepMonths) || 0,
});

const hasProfileInput = (p: ProfileInput) => Object.values(p).some((v) => v !== "");

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  demo?: boolean;
  pending?: boolean;
  error?: boolean;
  attachments?: string[];
  traces?: ToolExecution[];
  artifact?: { view: View; title: string; meta: string };
  followUps?: MissionKey[];
  sources?: { title: string; url: string; registered?: boolean }[];
  card?: AnswerCard;
}

interface Staged {
  fileName: string;
  mimeType: string;
  base64OrText: string;
}

const REGION = "서울특별시 관악구 봉천로 123, 301호";

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
  { id: "tools", label: "실행 내역" },
  { id: "triage", label: "자격 판정" },
  { id: "recipe", label: "발급 가이드" },
  { id: "audit", label: "사전 검수" },
  { id: "package", label: "신청 패키지" },
];

const SOURCE: Record<ToolSource, { label: string; cls: string; hint: string }> = {
  calc: {
    label: "실계산",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    hint: "입력값으로 실제 계산한 결과",
  },
  sample: {
    label: "예시 데이터",
    cls: "bg-amber-50 text-amber-800 ring-amber-600/25",
    hint: "시연용으로 준비한 데이터",
  },
  live: {
    label: "실시간 API",
    cls: "bg-brand-50 text-brand-700 ring-brand-600/20",
    hint: "외부 API 실시간 응답",
  },
};

const MISSIONS: Record<
  MissionKey,
  { no: string; label: string; sub: string; steps: number[]; view: View; mode?: "defect" | "fixed" }
> = {
  triage: { no: "1", label: "자격 판정", sub: "소득·월세 요건과 특례 조항 확인", steps: [1, 2, 3, 4, 5], view: "triage" },
  recipe: { no: "2", label: "발급 가이드", sub: "필요한 서류와 발급 옵션", steps: [6], view: "recipe" },
  audit_defect: { no: "3", label: "사전 검수", sub: "예시 서류 세트 A (미비)", steps: [7, 8], view: "audit", mode: "defect" },
  audit_fixed: { no: "4", label: "재검수 · 신청 패키지", sub: "예시 서류 세트 B (보완)", steps: [8, 9], view: "package", mode: "fixed" },
  all: { no: "", label: "전체 흐름 실행", sub: "1~4단계 연속 실행", steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], view: "tools" },
};

const VERDICT: Record<Verdict, { title: string; body: string; cls: string }> = {
  eligible: {
    title: "신청 대상에 해당합니다",
    body: "독립가구 특례가 적용되어 부모님(원가구) 소득은 심사하지 않습니다.",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  needs_parent_check: {
    title: "부모님 소득 확인이 추가로 필요합니다",
    body: "본인 소득과 월세 요건은 충족하지만 독립가구 특례에 해당하지 않습니다.",
    cls: "border-amber-200 bg-amber-50 text-amber-900",
  },
  ineligible: {
    title: "충족하지 못한 요건이 있습니다",
    body: "본인 소득(중위 60% 이하) 또는 월세 상한 요건을 확인하세요.",
    cls: "border-red-200 bg-red-50 text-red-900",
  },
};

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const now = () =>
  new Date().toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
const risksOf = (a: { findings: { severity: string }[] }) =>
  a.findings.filter((f) => f.severity !== "pass").length;

export default function Page() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [view, setView] = useState<View>("tools");

  const [geminiKey, setGeminiKey] = useState("");
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

  const [profile, setProfile] = useState<ProfileInput>(EMPTY_PROFILE);
  const [tools, setTools] = useState<ToolExecution[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);

  const [auditMode, setAuditMode] = useState<AuditMode>("defect");
  const [upload, setUpload] = useState<{ result: AuditResult; mode: string; note?: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [clauseId, setClauseId] = useState("clause-special");
  const [doneDocs, setDoneDocs] = useState<Record<string, boolean>>({});
  const [essay, setEssay] = useState(form.generatedEssayDraft);
  const [downloaded, setDownloaded] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [working, setWorking] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 오른쪽 패널 '답변 근거' 탭이 보여주는 답변
  const [focusId, setFocusId] = useState<string | null>(null);
  // 패널 탭들의 기준 정책: "demo"(청년월세 시연 공고) 또는 "메시지id#정책순번"
  const [ctx, setCtx] = useState("demo");
  // 정책별 자격 응답·서류 준비·검수 결과 (브라우저에 저장)
  const [policyState, setPolicyState] = useState<Record<string, PolicyState>>({});
  // 이전에 안내한 정책 정보. 다음 질문에 함께 보내 같은 정책은 같은 값으로 답하게 한다.
  const [facts, setFacts] = useState<Record<string, PolicyDetail & { at: number }>>({});
  const endRef = useRef<HTMLDivElement>(null);

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
    messages.length > 0 || tools.length > 0 || summary !== null || upload !== null || hasProfileInput(profile);

  const newChat = () => {
    if (working) return;
    setMessages([]);
    setChatId(`c-${Date.now()}`);
    setTools([]);
    setSummary(null);
    setUpload(null);
    setProfile(EMPTY_PROFILE);
    setFocusId(null);
    setCtx("demo");
    setAnswers({});
    setDoneDocs({});
    setMarkedTargets({});
    setView("tools");
  };
  const openChat = (id: string) => {
    const c = chats.find((x) => x.id === id);
    if (!c || working) return;
    setMessages(c.messages);
    setChatId(id);
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

  const audit =
    auditMode === "upload" && upload ? upload.result : policy.auditScenarios[auditMode === "fixed" ? "fixed" : "defect"];
  const auditRisks = risksOf(audit);
  const formFields = upload?.result.autoFilledFields.length ? upload.result.autoFilledFields : form.autoFilledFields;
  const requiredDocs = policy.documentRecipes.filter((d) => d.required);
  const exemptDocs = policy.documentRecipes.filter((d) => !d.required);
  const forbiddenHit = form.forbiddenWords.filter((w) => essay.includes(w));
  const keywordHit = form.recommendedKeywords.filter((w) => essay.includes(w));

  const display = (v: string) =>
    maskOnScreen ? v.replace(/(\d{6})-([1-4])\d{6}/g, "$1-$2******") : v;

  const fetchTools = async (
    p: Profile | ProfileInput = profile,
    mode: "defect" | "fixed" = auditMode === "fixed" ? "fixed" : "defect",
    signal?: AbortSignal
  ) => {
    const resolved = "age" in p && typeof p.age === "number" ? (p as Profile) : toProfile(p as ProfileInput);
    setToolsLoading(true);
    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          age: resolved.age,
          region: REGION,
          monthlyIncomeManwon: resolved.incomeManwon,
          depositManwon: resolved.depositManwon,
          monthlyRentManwon: resolved.rentManwon,
          separateLivingMonths: resolved.sepMonths,
          auditMode: mode,
          publicDataApiKey: publicKey,
          essayText: essay,
        }),
      });
      const data = await res.json();
      if (data?.tools) {
        setTools(data.tools);
        setSummary(data.summary);
      }
      return data as { tools?: ToolExecution[]; summary?: Summary };
    } catch {
      return {};
    } finally {
      setToolsLoading(false);
    }
  };

  const verifyKey = async (key: string) => {
    setTesting(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping", apiKey: key }),
      });
      const data = await res.json();
      setApiConnected(Boolean(data.connected));
      setApiMsg(data.message || "");
      if (data.connected && key) localStorage.setItem("gonggopass_gemini_key", key);
    } catch {
      setApiConnected(false);
      setApiMsg("서버에 연결하지 못했습니다.");
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    const g = localStorage.getItem("gonggopass_gemini_key") || "";
    setGeminiKey(g);
    setPublicKey(localStorage.getItem("gonggopass_public_key") || "");
    verifyKey(g);
    setChats(loadLocal<Chat[]>("gonggopass_chats", []));
    const saved = loadLocal<{ added: string[]; custom: Site[] } | null>("gonggopass_tools", null);
    if (saved) {
      const safe = (saved.custom || []).filter((c) => isHttpUrl(c.url)).map((c) => ({ ...c, custom: true }));
      setCustom(safe);
      setAddedIds(saved.added || DEFAULT_TOOLS);
    }
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

  useEffect(() => {
    if (loaded) localStorage.setItem("gonggopass_policy_state", JSON.stringify(policyState));
  }, [policyState, loaded]);

  useEffect(() => {
    if (loaded) localStorage.setItem("gonggopass_policy_facts", JSON.stringify(facts));
  }, [facts, loaded]);

  useEffect(() => {
    if (loaded) localStorage.setItem("gonggopass_chats", JSON.stringify(chats));
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
    if (!geminiKey) localStorage.removeItem("gonggopass_gemini_key");
    localStorage.setItem("gonggopass_public_key", publicKey);
    await verifyKey(geminiKey);
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
    fetchTools();
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
    scrollDown();
    return id;
  };

  const missionCopy = (key: MissionKey, s: Summary, p: Profile) => {
    const calc = `보증금 환산 ${won(s.convertedDepositKRW)} + 월세 ${won(p.rentManwon * 10000)} = **${won(s.totalConvertedRentKRW)}** (상한 900,000원)`;
    const triage = `**${VERDICT[s.verdict].title}.** ${VERDICT[s.verdict].body}\n\n- 본인 소득: 1인가구 기준 중위소득의 **${s.medianRatioPercent}%** (요건 60% 이하, 특례 50% 이상)\n- 월세: ${calc}\n- 근거 조항: 3p 제2조 단서, 18p [별표2] 제3호\n- 건축물대장 용도 확인은 예시 데이터입니다.`;
    const defect = policy.auditScenarios.defect.findings;
    return {
      triage: {
        user: `만 ${p.age}세이고 부모님과 따로 산 지 ${p.sepMonths}개월 됐습니다. 월 소득 ${p.incomeManwon}만 원, 보증금 ${p.depositManwon.toLocaleString("ko-KR")}만 원에 월세 ${p.rentManwon}만 원입니다. 부모님 소득이 높은 편인데 청년월세 지원 대상인지 확인해 주세요.`,
        reply: triage,
        title: "자격 판정 결과",
        meta: `중위소득 ${s.medianRatioPercent}% · 환산 월세 ${won(s.totalConvertedRentKRW)}`,
      },
      recipe: {
        user: "제 조건에서 어떤 서류를 어떤 옵션으로 발급받아야 하는지 알려 주세요.",
        reply: `공고문에 나열된 서류 ${policy.allDocumentsCount}종 가운데 이 조건에서 준비할 서류는 **${requiredDocs.length}종**입니다.\n\n- 주민등록등본: 전입일과 최근 5년 주소변동을 **포함**으로 발급\n- 가족관계증명서: 일반이 아닌 **상세** 증명서\n- 임대차계약서: 확정일자가 없으면 **신고필증** 추가\n\n서류별 발급 화면 링크와 선택 옵션은 발급 가이드 탭에 정리했습니다.`,
        title: "서류 발급 가이드",
        meta: `필수 ${requiredDocs.length}종 · 발급처 링크 포함`,
      },
      audit_defect: {
        user: "등본, 임대차계약서, 가족관계증명서를 준비했습니다. 제출 전에 문제 없는지 봐 주세요.",
        reply: `예시 서류 세트 A를 점검한 결과 **반려 위험 ${defect.length}건**을 찾았습니다.\n\n${defect.map((f, i) => `${i + 1}. ${f.title.replace(/^\[[^\]]+\]\s*/, "")}`).join("\n")}\n\n항목별 근거 조항과 보완 방법은 사전 검수 탭에 있습니다.`,
        title: "사전 검수 리포트",
        meta: `반려 위험 ${defect.length}건`,
      },
      audit_fixed: {
        user: "지적된 항목을 모두 보완해서 다시 올렸습니다. 재검수하고 신청서를 채워 주세요.",
        reply: `예시 서류 세트 B를 다시 점검했고 **감지된 반려 위험이 없습니다.**\n\n- 신청서 ${form.autoFilledFields.length}개 항목을 서류 값으로 채웠습니다.\n- 계획서 초안: 금칙어 ${forbiddenHit.length}건, 권장 키워드 ${keywordHit.length}/${form.recommendedKeywords.length}개 포함\n\n신청 패키지 탭에서 내용을 확인하고 내려받을 수 있습니다.`,
        title: "신청 패키지",
        meta: "신청서 자동 기입 · 계획서 초안",
      },
      all: {
        user: "자격 확인부터 서류 검수, 신청서 작성까지 전체 흐름을 한 번에 실행해 주세요.",
        reply: `${triage}\n\n이어서 서류 선별, 예시 서류 세트 A 검수(**반려 위험 ${defect.length}건**), 신청서 점검까지 실행했습니다. 실행 내역 탭에서 도구별 입력과 결과, 데이터 출처를 확인할 수 있습니다.`,
        title: "전체 실행 내역",
        meta: "도구 9개 실행",
      },
    }[key];
  };

  // 탭을 전환하거나 스크롤해도 AI가 짚어준 빨간 상자 표시를 계속 유지
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-agent-target]").forEach((el) => {
      const key = el.getAttribute("data-agent-target") || "";
      const label = markedTargets[key];
      if (label) el.setAttribute("data-agent-marked", label);
      else el.removeAttribute("data-agent-marked");
    });
  }, [markedTargets, view, canvasOpen, tools, summary, upload, messages]);

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

  const startAgentPlan = (labels: string[], thoughts: string[], scan = false) => {
    clearAgentTimers();
    stoppedRef.current = false;
    pausedRef.current = false;
    setAgentPaused(false);
    setAgentActive(true);
    setAgentScanning(scan);
    setAgentTarget(null);
    setMarkedTargets({});
    setAgentSteps(labels.map((label, i) => ({ label, status: i === 0 ? "active" : "pending" })));
    setAgentThought(thoughts[0] || "");

    labels.slice(1).forEach((_, idx) => {
      const stepIndex = idx + 1;
      const t = window.setTimeout(() => {
        if (stoppedRef.current) return;
        setAgentSteps((prev) =>
          prev.map((s, i) => ({
            ...s,
            status: i < stepIndex ? "done" : i === stepIndex ? "active" : "pending",
          }))
        );
        if (thoughts[stepIndex]) setAgentThought(thoughts[stepIndex]);
      }, stepIndex * 1450);
      agentTimersRef.current.push(t);
    });
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
      tools: "실행 내역",
      triage: "자격 판정",
      recipe: "발급 가이드",
      audit: "사전 검수",
      package: "신청 패키지",
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
        await new Promise((r) => setTimeout(r, 1300));
        if (stoppedRef.current) return;
        // 방문한 중요 영역은 빨간 상자로 계속 유지
        setMarkedTargets((prev) => ({ ...prev, [item.selector]: item.label }));
        await new Promise((r) => setTimeout(r, 900));
      }
      await waitWhilePaused();
      if (stoppedRef.current) return;
      setAgentTarget(null);
      setAgentActive(false);
    })();
  };

  const runMission = async (key: MissionKey) => {
    if (working) return;
    const m = MISSIONS[key];
    setCtx("demo");
    if (m.mode) setAuditMode(m.mode);
    const activeProfile = hasProfileInput(profile) ? toProfile(profile) : DEMO_PROFILE;
    if (!hasProfileInput(profile)) setProfile(DEMO_PROFILE);
    const s0 = summary;
    const copy0 = s0 ? missionCopy(key, s0, activeProfile) : null;
    const id = pushTurn({
      content: copy0?.user || m.label,
      demo: true,
      attachments: key.startsWith("audit")
        ? ["주민등록등본.pdf", "임대차계약서.jpg", "가족관계증명서.pdf"]
        : undefined,
    });
    pendingMsgIdRef.current = id;
    setExpanded((e) => ({ ...e, [id]: true }));

    const planConfig: Record<
      MissionKey,
      { labels: string[]; thoughts: string[]; scan: boolean; targets: { tab?: View; selector: string; label: string }[] }
    > = {
      triage: {
        labels: ["공고 조건 분석", "소득·월세 환산", "특례 조항 판정"],
        thoughts: [
          "신청자 연령과 별도 거주 기간을 공고문 기준으로 대조합니다.",
          "보증금 연 5.5% 환산액과 월세를 합산해 상한 요건을 계산합니다.",
          "18p [별표2] 제3호 독립가구 특례 적용 여부를 확정합니다.",
        ],
        scan: false,
        targets: [
          { tab: "triage", selector: "triage-verdict", label: "핵심 자격 판정" },
          { tab: "triage", selector: "triage-rent", label: "환산 합산 월세" },
          { tab: "triage", selector: "triage-special", label: "독립가구 특례 적용" },
        ],
      },
      recipe: {
        labels: ["판정 조건 대조", "필수 서류 선별", "발급 옵션 정리"],
        thoughts: [
          "전체 12종 서류 중 현재 조건에서 면제되는 서류를 제외합니다.",
          "주민등록등본·가족관계증명서·임대차계약서 필수 4종을 추립니다.",
          "반려를 막기 위한 발급 체크박스 옵션을 정리합니다.",
        ],
        scan: false,
        targets: [
          { tab: "recipe", selector: "recipe-docs", label: "필수 발급 서류" },
          { tab: "recipe", selector: "recipe-exempt", label: "면제 서류 확인" },
        ],
      },
      audit_defect: {
        labels: ["서류 3종 스캔", "규칙·발급일 점검", "교차 검증 리포트"],
        thoughts: [
          "첨부된 예시 서류 세트 A의 텍스트와 직인 영역을 스캔합니다.",
          "전입일·상세 증명서·확정일자 등 반려 유발 항목을 검사합니다.",
          "등본과 임대차계약서의 주소·성명 일치 여부를 교차 검증합니다.",
        ],
        scan: true,
        targets: [
          { tab: "audit", selector: "audit-risk", label: "반려 위험 적발" },
          { tab: "audit", selector: "audit-findings", label: "보완 방법 안내" },
          { tab: "audit", selector: "audit-crosscheck", label: "서류 간 교차 검증" },
        ],
      },
      audit_fixed: {
        labels: ["보완 서류 재스캔", "신청서 자동 기입", "계획서 금칙어 점검"],
        thoughts: [
          "보완된 예시 서류 세트 B를 다시 스캔해 미비점이 없는지 확인합니다.",
          "검증된 서류 값으로 복지로 신청서 항목을 자동으로 채웁니다.",
          "계획서 초안의 금칙어와 권장 키워드 포함 여부를 점검합니다.",
        ],
        scan: true,
        targets: [
          { tab: "package", selector: "package-form", label: "신청서 자동 기입" },
          { tab: "package", selector: "package-essay", label: "계획서 금칙어 점검" },
          { tab: "package", selector: "package-files", label: "제출 파일명 규격" },
        ],
      },
      all: {
        labels: ["자격 요건 계산", "서류 선별", "서류 사전 검수", "신청 패키지 구성"],
        thoughts: [
          "입력 조건으로 중위소득 비율과 환산 합산 월세를 계산합니다.",
          "조건에 맞는 필수 서류 4종과 면제 서류를 분류합니다.",
          "예시 서류 세트 A를 스캔해 반려 위험 4건을 사전 탐지합니다.",
          "도구 9개 실행 결과와 출처를 실행 내역 패널에 정리합니다.",
        ],
        scan: true,
        targets: [
          { tab: "tools", selector: "tools-list", label: "9개 도구 실행 내역" },
          { tab: "triage", selector: "triage-verdict", label: "핵심 자격 판정" },
          { tab: "recipe", selector: "recipe-docs", label: "필수 발급 서류" },
          { tab: "audit", selector: "audit-risk", label: "반려 위험 적발" },
          { tab: "package", selector: "package-form", label: "신청서 자동 기입" },
        ],
      },
    };

    const cfg = planConfig[key];
    startAgentPlan(cfg.labels, cfg.thoughts, cfg.scan);
    const ac = new AbortController();
    abortRef.current = ac;

    const minPlanWait = Math.min(cfg.labels.length * 1450, 4400);
    const [data] = await Promise.all([
      fetchTools(activeProfile, m.mode ?? (auditMode === "fixed" ? "fixed" : "defect"), ac.signal),
      new Promise((r) => setTimeout(r, minPlanWait)),
    ]);
    await waitWhilePaused();

    if (stoppedRef.current) return;
    pendingMsgIdRef.current = null;

    if (!data.tools || !data.summary) {
      patch(id, { content: "도구 실행에 실패했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.", error: true });
      setAgentActive(false);
      setAgentScanning(false);
    } else {
      const copy = missionCopy(key, data.summary, activeProfile);
      const next: Record<MissionKey, MissionKey[]> = {
        triage: ["recipe"],
        recipe: ["audit_defect"],
        audit_defect: ["audit_fixed"],
        audit_fixed: [],
        all: ["audit_fixed"],
      };
      setView(m.view);
      setCanvasOpen(true);
      patch(id, {
        content: copy.reply,
        traces: data.tools.filter((t) => m.steps.includes(t.step)),
        artifact: { view: m.view, title: copy.title, meta: copy.meta },
        followUps: next[key],
      });
      finishAgentWithTarget(`${copy.title} 정리 완료 — 강조된 영역을 확인하세요.`, cfg.targets);
    }
    setWorking(false);
    scrollDown();
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
    if (files.length && active) send(undefined, `${active.p.name} 서류를 검수해 주세요.`, files);
  };
  // ask: 후속 질문 칩처럼 입력창을 거치지 않고 바로 보내는 질문, filesArg: 패널에서 올린 서류
  const send = async (e?: React.FormEvent, ask?: string, filesArg?: Staged[]) => {
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

    if (isAudit) {
      startAgentPlan(
        ["첨부 서류 스캔", "필수 항목 판독", "교차 검증 리포트"],
        [
          `첨부된 서류 ${files.length}건의 텍스트·이미지를 스캔합니다.`,
          "전입일, 확정일자, 상세 증명서 등 접수 기준을 대조합니다.",
          "서류 간 성명·주소 일치 여부를 교차 검증합니다.",
        ],
        true
      );
    } else {
      startAgentPlan(
        ["질문 의도 분석", "정책·등록 사이트 탐색", "근거 카드 정리"],
        [
          "질문 내용에서 대상 정책과 조건 키워드를 추출합니다.",
          "등록된 정부 사이트 및 공고 기준을 검색해 확인합니다.",
          "핵심 조건과 신청 단계를 한눈에 볼 수 있게 정리합니다.",
        ],
        files.length > 0
      );
    }

    try {
      // 첨부만 보내거나 검수를 요청하면 서류 검수, 질문을 함께 쓰면 첨부 문서 기반 답변
      if (isAudit) {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            action: "ocr_audit_docs",
            apiKey: geminiKey,
            uploadedDocs: files,
            // 기준 정책이 있으면 그 정책의 서류·조건으로 검수
            ...(auditFor && { policy: auditFor.p }),
          }),
        });
        const data = await res.json();
        await waitWhilePaused();
        if (stoppedRef.current) return;
        pendingMsgIdRef.current = null;
        if (!res.ok || !data.auditResult) {
          patch(id, { content: data.message || "서류 검수에 실패했습니다.", error: true });
          setAgentActive(false);
          setAgentScanning(false);
          return;
        }
        const result: AuditResult = data.auditResult;
        const n = risksOf(result);
        if (auditFor) {
          setPolicyState((s) => ({ ...s, [auditFor.key]: { ...s[auditFor.key], audit: result } }));
        } else {
          setUpload({ result, mode: data.mode, note: data.note });
          setAuditMode("upload");
        }
        setView("audit");
        setCanvasOpen(true);
        const engine = data.mode === "gemini" ? "Gemini 판독" : "규칙 엔진";
        const skipped = data.skippedFiles?.length
          ? `\n\n검수하지 못한 파일: ${data.skippedFiles.join(", ")} (이미지·PDF는 Gemini API 키 필요)`
          : "";
        patch(id, {
          content:
            (n
              ? `첨부하신 서류 ${result.documents.length}건에서 **반려 위험 ${n}건**을 찾았습니다.\n\n${result.findings
                  .filter((f) => f.severity !== "pass")
                  .map((f, i) => `${i + 1}. ${f.title}`)
                  .join("\n")}`
              : `첨부하신 서류 ${result.documents.length}건에서 **점검 기준에 걸리는 항목을 찾지 못했습니다.**`) +
            `\n\n검수 방식: ${engine}${data.note ? ` · ${data.note}` : ""}${skipped}`,
          artifact: {
            view: "audit",
            title: auditFor ? `${auditFor.p.name} 서류 검수` : "업로드 서류 검수 리포트",
            meta: `${engine} · 반려 위험 ${n}건`,
          },
        });
        finishAgentWithTarget(
          n ? `반려 위험 ${n}건을 찾았습니다. 빨간 표시 영역을 확인하세요.` : "서류 검수 완료 — 반려 위험이 없습니다.",
          [
            { selector: "audit-risk", label: n ? `반려 위험 ${n}건` : "검수 완료" },
            ...(n ? [{ selector: "audit-findings", label: "보완할 항목" }] : []),
            { selector: "audit-crosscheck", label: "서류 간 교차 검증" },
          ]
        );
        return;
      }

      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          action: "agent_chat",
          apiKey: geminiKey,
          publicDataApiKey: publicKey,
          userMessage: text,
          uploadedDocs: files,
          knownPolicies: (() => {
            // 질문이나 최근 대화에 이름이 나온 정책만 보낸다
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
          userProfile: hasProfileInput(profile)
            ? {
                age: Number(profile.age) || 0,
                income: Number(profile.incomeManwon) || 0,
                deposit: Number(profile.depositManwon) || 0,
                rent: Number(profile.rentManwon) || 0,
                sepMonths: Number(profile.sepMonths) || 0,
              }
            : undefined,
        }),
      });
      const data = await res.json();
      await waitWhilePaused();
      if (stoppedRef.current) return;
      pendingMsgIdRef.current = null;

      if (!res.ok || !data.reply) {
        patch(id, { content: data.message || "답변을 만들지 못했습니다.", error: true });
        setAgentActive(false);
        setAgentScanning(false);
        return;
      }
      const eligibility = data.kind === "eligibility";
      if (eligibility) {
        setView("triage");
        setCanvasOpen(true);
      } else if (data.card) {
        setFocusId(id);
        setView("answer");
        const ps: PolicyDetail[] = data.card.policies || [];
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
      patch(id, {
        content:
          data.reply +
          (data.needsKey
            ? "\n\n연결 설정에서 Gemini API 키를 넣으면 등록한 사이트를 검색해 질문 내용에 맞춰 답변합니다."
            : "") +
          (data.card ? "" : relatedLinks(text, data.reply)),
        traces: data.toolExecutions,
        sources: data.sources,
        card: data.card || undefined,
        ...(eligibility && {
          artifact: { view: "triage" as View, title: "자격 판정 결과", meta: "입력 조건 기준 계산" },
          followUps: ["recipe", "audit_defect"] as MissionKey[],
        }),
      });
      if (eligibility) {
        finishAgentWithTarget("자격 판정 결과를 패널에 정리했습니다.", [
          { selector: "triage-verdict", label: "자격 판정 결과" },
          { selector: "triage-rent", label: "환산 합산 월세" },
          { selector: "triage-special", label: "독립가구 특례" },
        ]);
      } else if (data.card && window.innerWidth >= 1024) {
        finishAgentWithTarget("답변 근거와 출처를 정리했습니다.", [
          { selector: "answer-summary", label: "답변 핵심 근거" },
          { selector: "answer-steps", label: "신청 체크리스트" },
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
      scrollDown();
    }
  };

  const downloadPackage = () => {
    const content = [
      `[공고패스] 제출 전 점검 요약`,
      `대상 사업: ${policy.title} (${policy.ministry})`,
      `점검 서류: ${auditMode === "upload" ? "업로드 서류" : "예시 서류 세트"} · 반려 위험 ${auditRisks}건`,
      `※ 사전 점검 결과이며 최종 판정은 접수 기관이 합니다.`,
      ``,
      `1. 신청서 기입 항목`,
      ...formFields.map((f) => `- ${f.label}: ${f.value} [출처: ${f.sourceDoc}]`),
      ``,
      `2. ${form.essayTitle}`,
      essay,
      ``,
      `3. 제출 파일명`,
      ...audit.documents.map((d, i) => `${i + 1}. ${d.renamedFileName} (원본: ${d.fileName})`),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `공고패스_점검요약_${policy.title.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  };

  const quizImpacts = policy.questions.map((q) => q.options.find((o) => o.value === answers[q.id]));
  const quizDone = quizImpacts.every(Boolean);
  const quizWarn = quizImpacts.find((o) => o?.ruleImpact === "warning");

  const filteredChats = sidebarSearch.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(sidebarSearch.trim().toLowerCase()))
    : chats;
  const filteredTools = sidebarSearch.trim()
    ? myTools.filter((t) => t.name.toLowerCase().includes(sidebarSearch.trim().toLowerCase()))
    : myTools;

  const promptCard = (
    <form
      onSubmit={send}
      className="w-full bg-white border border-slate-200/90 rounded-2xl shadow-input p-3 transition-shadow focus-within:ring-2 focus-within:ring-purple-200 focus-within:border-purple-300"
    >
      {staged.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {staged.map((f, i) => (
            <FileChip
              key={`${f.fileName}-${i}`}
              name={f.fileName}
              onRemove={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
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
        placeholder="청년 정책을 물어보거나 공고문·서류를 첨부하세요..."
        className="w-full text-sm border-0 focus:ring-0 resize-none p-1 text-slate-700 placeholder:text-slate-400 outline-none bg-transparent"
      />
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => runMission("all")}
            disabled={working}
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full border border-purple-300 bg-purple-50/50 hover:bg-purple-100 text-purple-700 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 8v8m-4-4h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>전체 점검 실행</span>
          </button>
          <label
            aria-label="서류 첨부"
            title="서류 첨부"
            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200/80"
          >
            <Paperclip className="w-3.5 h-3.5 text-slate-500" />
            <input type="file" multiple accept=".pdf,image/*,.txt" onChange={onFiles} className="sr-only" />
          </label>
        </div>
        <button
          type="submit"
          disabled={working || (!input.trim() && !staged.length)}
          aria-label="보내기"
          className="w-7 h-7 rounded-full bg-purple-200 hover:bg-purple-300 text-purple-700 flex items-center justify-center transition-colors disabled:opacity-40"
        >
          {working ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-2.5 mt-1 border-t border-slate-50 text-[11px] text-slate-500">
        <span className="inline-flex items-center space-x-1 text-slate-600 font-medium">
          <span className="text-purple-500">✦</span>
          <span>추천 질문</span>
        </span>
        {[
          "월세가 70만 원을 넘어도 받을 수 있나요?",
          "주민등록등본은 어떻게 발급하나요?",
          "국민취업지원제도 신청 자격은?",
        ].map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => send(undefined, q)}
            disabled={working}
            className="rounded-full bg-purple-50/70 hover:bg-purple-100/80 text-purple-700 px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </form>
  );

  return (
    <div className="h-dvh w-screen overflow-hidden antialiased text-slate-800 selection:bg-brand-100 selection:text-brand-700">
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
          className={`shrink-0 overflow-hidden bg-[#fbfbfb] selection:bg-purple-200 max-lg:hidden transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            sidebarOpen ? "w-[270px] border-r border-slate-100 opacity-100" : "w-0 border-r-0 opacity-0 pointer-events-none"
          }`}
        >
          <div
            className={`flex h-full w-[270px] flex-col justify-between p-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              sidebarOpen ? "translate-x-0" : "-translate-x-4"
            }`}
          >
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between px-1.5 pt-1">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-200/70 flex items-center justify-center text-purple-700 shadow-sm">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M11 2a2 2 0 0 1 2 2v6h6a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-6v6a2 2 0 0 1-2 2v0a2 2 0 0 1-2-2v-6H3a2 2 0 0 1-2-2v0a2 2 0 0 1 2-2h6V4a2 2 0 0 1 2-2v0z" />
                    </svg>
                  </div>
                  <span className="font-semibold text-[17px] tracking-tight text-slate-900">공고패스</span>
                </div>
                <button
                  aria-label="사이드바 닫기"
                  onClick={() => setSidebarOpen(false)}
                  className="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <rect height="18" rx="2" stroke="currentColor" width="18" x="3" y="3" />
                    <path d="M9 3v18M14 9l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
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
                  placeholder="대화 · 도구 검색"
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
                    {filteredChats.map((c) => (
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
                  </div>
                )}
              </div>

              <div>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block px-2.5 mb-1.5">
                  내 도구 · 정부 사이트
                </span>
                <div className="space-y-0.5">
                  {filteredTools.map((t) => (
                    <a
                      key={t.id}
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors"
                    >
                      <span className="truncate">{t.name}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-purple-600" />
                    </a>
                  ))}
                  <button
                    onClick={() => setShowTools(true)}
                    className="mt-1 flex w-full items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-purple-700 hover:bg-purple-50 font-medium transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>도구 추가 · 관리</span>
                  </button>
                </div>
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
                      {apiConnected ? "Gemini AI 연결됨" : "기본 규칙 검수 모드"}
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
        <main className="flex-1 flex flex-col bg-white overflow-hidden relative justify-between min-w-0">
          <header className="h-16 px-6 shrink-0 flex items-center justify-between border-b border-transparent">
            <div className="flex items-center gap-2">
              {!sidebarOpen && (
                <IconButton label="사이드바 열기" onClick={() => setSidebarOpen(true)} className="max-lg:hidden">
                  <PanelLeft className="h-4 w-4" />
                </IconButton>
              )}
              <button
                type="button"
                onClick={() => {
                  setView("triage");
                  setCanvasOpen(true);
                }}
                className="inline-flex items-center space-x-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 px-2.5 py-1.5 rounded-full text-xs font-medium text-slate-800 transition-all"
              >
                <div className="w-4 h-4 rounded-md bg-purple-200 flex items-center justify-center text-purple-700 text-[10px]">
                  ✦
                </div>
                <span>{policy.title}</span>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={newChat}
                  className="inline-flex items-center space-x-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>새 대화</span>
                </button>
              )}
              <button
                type="button"
                aria-label={canvasOpen ? "점검 패널 닫기" : "점검 패널 열기"}
                title={canvasOpen ? "점검 패널 닫기" : "점검 패널 열기"}
                aria-pressed={canvasOpen}
                onClick={() => setCanvasOpen((v) => !v)}
                className={`p-1.5 rounded-lg transition-colors ${
                  canvasOpen
                    ? "bg-purple-50 text-purple-700 hover:bg-purple-100"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                }`}
              >
                <PanelRight className="w-4 h-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto no-scrollbar">
            <div className="px-6 md:px-8 max-w-3xl mx-auto w-full flex flex-col items-center pt-2 pb-6">
              {messages.length === 0 ? (
                <div className="w-full flex flex-col items-center">
                  <div className="flex flex-col items-center text-center mb-5">
                    <LiquidOrb />
                    <h2 className="animate-fade-up delay-2 text-xl font-medium text-brand-400 tracking-tight mb-1">
                      공고패스 AI 사전 점검
                    </h2>
                    <h1 className="animate-fade-up delay-3 text-2xl font-bold text-slate-900 tracking-tight">
                      지원금 신청서, 내기 전에 먼저 점검하세요
                    </h1>
                    <p className="animate-fade-up delay-4 mt-1.5 text-xs text-slate-500">
                      공고문 조건으로 자격을 계산하고 준비한 서류를 접수 기준에 맞춰 제출 전에 검수합니다.
                    </p>
                  </div>

                  <div className="animate-fade-up delay-5 w-full mb-5">{promptCard}</div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full">
                    {(["triage", "recipe", "audit_defect", "audit_fixed"] as MissionKey[]).map((k, idx) => (
                      <button
                        key={k}
                        onClick={() => runMission(k)}
                        disabled={working}
                        style={{ animationDelay: `${420 + idx * 70}ms` }}
                        className="animate-fade-up hover-lift p-3.5 text-left bg-slate-50/70 hover:bg-white border border-slate-100 rounded-xl hover:border-purple-200 group disabled:opacity-50"
                      >
                        <div className="mb-2">
                          <span className="tnum inline-block text-[10px] font-semibold text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded">
                            STEP {MISSIONS[k].no}
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-slate-800 mb-1">{MISSIONS[k].label}</h4>
                        <p className="text-[11px] text-slate-400 leading-snug">{MISSIONS[k].sub}</p>
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
                        <span className="text-[11px] text-slate-400">
                          {msg.demo && "시연 시나리오 · "}
                          {msg.time}
                        </span>
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
                              <span>찾아보고 정리하는 중 · 보통 20초 안팎</span>
                            </div>
                            {agentActive && (
                              <AgentPlanCard
                                paused={agentPaused}
                                steps={agentSteps}
                                thought={agentThought}
                                onTogglePause={toggleAgentPause}
                                onStop={stopAgent}
                              />
                            )}
                          </div>
                        ) : (
                          <>
                            {!msg.card && msg.traces && msg.traces.length > 0 && (
                              <div className="rounded-xl border border-slate-200/90 bg-slate-50/40">
                                <button
                                  onClick={() => setExpanded((e) => ({ ...e, [msg.id]: !e[msg.id] }))}
                                  aria-expanded={Boolean(expanded[msg.id])}
                                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-slate-600 hover:bg-slate-50 rounded-xl"
                                >
                                  <span>도구 {msg.traces.length}개 실행</span>
                                  <ChevronDown
                                    className={`h-4 w-4 transition-transform ${expanded[msg.id] ? "rotate-180" : ""}`}
                                  />
                                </button>
                                {expanded[msg.id] && (
                                  <ul className="divide-y divide-slate-100 border-t border-slate-200">
                                    {msg.traces.map((t) => (
                                      <li key={t.step} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                                        <StatusDot status={t.status} />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-slate-800">{t.title}</span>
                                          <span className="block truncate text-xs text-slate-500">{t.basis}</span>
                                        </span>
                                        <SourceBadge source={t.source} />
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}

                            {msg.card ? (
                              <CardView card={msg.card} onAsk={(q) => send(undefined, q)} disabled={working} />
                            ) : (
                              <div
                                className={`whitespace-pre-wrap text-sm leading-relaxed ${
                                  msg.error
                                    ? "rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-800"
                                    : "text-slate-800"
                                }`}
                              >
                                <Rich text={msg.content} />
                              </div>
                            )}

                            {msg.card && (
                              <button
                                onClick={() => {
                                  setFocusId(msg.id);
                                  if (msg.card?.policies?.length) setCtx(`${msg.id}#0`);
                                  setView("answer");
                                  setCanvasOpen(true);
                                }}
                                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-700"
                              >
                                <PanelRight className="h-3.5 w-3.5" />
                                근거 보기 · 도구 {msg.traces?.length || 0}건 · 출처 {msg.sources?.length || 0}곳
                              </button>
                            )}

                            {!msg.card && msg.sources && msg.sources.length > 0 && (
                              <details className="group">
                                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                                  출처 {msg.sources.length}곳
                                  {msg.sources.some((s) => s.registered) && " · 내 도구 포함"}
                                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                                </summary>
                                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                  {msg.sources.map((s) => (
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
                              </details>
                            )}

                            {msg.artifact && (
                              <button
                                onClick={() => {
                                  setView(msg.artifact!.view);
                                  setCanvasOpen(true);
                                }}
                                className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-purple-300 hover:bg-purple-50/40"
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

                            {msg.followUps && msg.followUps.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {msg.followUps.map((k) => (
                                  <button
                                    key={k}
                                    onClick={() => runMission(k)}
                                    disabled={working}
                                    className="flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50/50 px-3 py-1.5 text-[13px] font-medium text-purple-700 transition-colors hover:bg-purple-100 active:translate-y-px disabled:opacity-50"
                                  >
                                    다음: {MISSIONS[k].label}
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </button>
                                ))}
                              </div>
                            )}
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

          {messages.length > 0 && (
            <div className="shrink-0 px-6 md:px-8 pb-3 max-w-3xl mx-auto w-full">{promptCard}</div>
          )}

          <footer className="h-10 px-6 shrink-0 flex items-center justify-center border-t border-transparent text-[11px] text-slate-400">
            <p className="text-center truncate">
              사전 점검 도우미 결과이며 최종 판정은 접수 기관이 합니다.
            </p>
          </footer>
        </main>

      {/* ───────── 결과 패널 ───────── */}
      <section
        aria-hidden={!canvasOpen}
        className={`flex shrink-0 flex-col overflow-hidden bg-[#fbfbfb] transition-[width,opacity,transform,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-full ${
          canvasOpen
            ? "lg:w-[46%] lg:border-l lg:border-slate-100 opacity-100 max-lg:translate-x-0"
            : "lg:w-0 lg:border-l-0 opacity-0 pointer-events-none max-lg:translate-x-full"
        }`}
      >
        <div
          className={`flex h-full w-full min-w-[380px] max-lg:min-w-0 flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
            <IconButton label="점검 패널 닫기" onClick={() => setCanvasOpen(false)} className="lg:hidden">
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
                {view !== "answer" && policyOptions.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="shrink-0">기준 정책</span>
                <select
                  value={active ? active.key : "demo"}
                  onChange={(e) => (e.target.value === "demo" ? setCtx("demo") : choosePolicy(e.target.value))}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm hover:border-purple-200 focus:border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-200"
                >
                  {policyOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.p.name}
                    </option>
                  ))}
                  <option value="demo">청년월세 지원 (시연 시나리오)</option>
                </select>
              </label>
            )}

            {active && view === "tools" && (
              <Card>
                <CardHead title={`도구 실행 ${linkedMsg?.traces?.length || 0}건`} desc={`'${active.p.name}' 답변을 만들 때 실행한 도구`} />
                {linkedMsg?.traces?.length ? <ToolList tools={linkedMsg.traces} /> : <Empty text="실행한 도구가 없습니다." />}
              </Card>
            )}
            {active && view === "triage" && (
              <PolicyTriage p={active.p} st={pst} onChange={setPst} onAsk={(q) => send(undefined, q)} busy={working} />
            )}
            {active && view === "recipe" && (
              <PolicyDocs p={active.p} st={pst} onChange={setPst} sites={myTools} onAsk={(q) => send(undefined, q)} busy={working} />
            )}
            {active && view === "audit" && (
              <PolicyAudit p={active.p} st={pst} onUpload={uploadForPolicy} busy={working} display={display} />
            )}
            {active && view === "package" && (
              <PolicyPackage p={active.p} st={pst} steps={active.steps} links={active.links} />
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
                />
              ) : (
                <Card>
                  <Empty text="채팅 답변의 '근거 보기'를 누르면 여기에 표시됩니다." />
                </Card>
              ))}

            {/* 실행 내역 */}
            {view === "tools" && !active && (
              <>
                <Card target="tools-input">
                  <CardHead
                    title="입력 조건"
                    desc="값을 바꾸고 다시 계산하면 판정과 도구 결과가 갱신됩니다."
                    action={
                      <button
                        onClick={() => fetchTools()}
                        disabled={toolsLoading || !hasProfileInput(profile)}
                        className="flex items-center gap-1.5 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-700 active:translate-y-px disabled:opacity-60"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${toolsLoading ? "animate-spin" : ""}`} />
                        다시 계산
                      </button>
                    }
                  />
                  <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
                    {(
                      [
                        ["age", "만 나이", "세"],
                        ["incomeManwon", "월 소득", "만 원"],
                        ["depositManwon", "보증금", "만 원"],
                        ["rentManwon", "월세", "만 원"],
                        ["sepMonths", "별도 거주", "개월"],
                      ] as [keyof Profile, string, string][]
                    ).map(([k, label, unit]) => (
                      <label key={k} className="block">
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white transition-shadow hover:border-purple-200 focus-within:border-purple-300 focus-within:ring-2 focus-within:ring-purple-200">
                          <input
                            type="number"
                            min={0}
                            value={profile[k]}
                            placeholder="입력"
                            onChange={(e) => {
                              const raw = e.target.value;
                              setProfile((p) => ({ ...p, [k]: raw === "" ? "" : Math.max(0, Number(raw)) }));
                            }}
                            className="tnum w-full min-w-0 bg-transparent px-2 py-1.5 text-sm placeholder:text-slate-300 focus:outline-none"
                          />
                          <span className="shrink-0 pr-2 text-xs text-slate-400">{unit}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Card>

                <Card target="tools-list">
                  <CardHead
                    title={`도구 실행 ${tools.length}건`}
                    desc={`실계산 ${tools.filter((t) => t.source === "calc").length} · 예시 데이터 ${tools.filter((t) => t.source === "sample").length} · 실시간 API ${tools.filter((t) => t.source === "live").length}`}
                  />
                  {tools.length === 0 ? (
                    <Empty text={toolsLoading ? "도구를 실행하는 중입니다" : "아직 실행된 내역이 없습니다. 위 조건을 입력하고 다시 계산을 누르거나 시연을 실행하세요."} />
                  ) : (
                    <ToolList tools={tools} />
                  )}
                </Card>
              </>
            )}

            {/* 자격 판정 */}
            {view === "triage" && !active && (
              <>
                {summary ? (
                  <>
                    <div
                      data-agent-target="triage-verdict"
                      className={`rounded-2xl border px-4 py-3.5 shadow-sm ${VERDICT[summary.verdict].cls}`}
                    >
                      <div className="text-sm font-semibold">{VERDICT[summary.verdict].title}</div>
                      <div className="mt-0.5 text-[13px] opacity-90">{VERDICT[summary.verdict].body}</div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Stat
                        label="본인 소득 / 기준 중위소득"
                        value={`${summary.medianRatioPercent}%`}
                        note="요건 60% 이하 · 특례 50% 이상"
                        ok={summary.medianRatioPercent <= 60}
                      />
                      <Stat
                        target="triage-rent"
                        label="환산 합산 월세"
                        value={won(summary.totalConvertedRentKRW)}
                        note="상한 900,000원"
                        ok={summary.totalConvertedRentKRW <= 900000 || (Number(profile.rentManwon) || 0) <= 70}
                      />
                      <Stat
                        target="triage-special"
                        label="독립가구 특례"
                        value={summary.independent ? "적용" : "미적용"}
                        note="18p [별표2] 제3호"
                        ok={summary.independent}
                      />
                    </div>
                  </>
                ) : (
                  <Empty text="계산 결과가 없습니다." />
                )}

                <Card>
                  <CardHead title="빠른 자격 확인" desc="공고문 용어 대신 일상 질문으로 확인합니다." />
                  <div className="space-y-5 p-4">
                    {policy.questions.map((q, i) => (
                      <fieldset key={q.id}>
                        <legend className="text-[13px] font-medium">
                          <span className="tnum mr-1.5 text-slate-400">{i + 1}</span>
                          {q.question}
                        </legend>
                        <div className="mt-0.5 text-xs text-slate-500">공고문 표현: {q.adminTermReplaced}</div>
                        <div className="mt-2 space-y-1.5">
                          {q.options.map((o) => {
                            const on = answers[q.id] === o.value;
                            return (
                              <label
                                key={o.value}
                                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors text-[13px] transition-colors ${
                                  on ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={q.id}
                                  checked={on}
                                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.value }))}
                                  className="mt-0.5 accent-brand-600"
                                />
                                <span>
                                  {o.label}
                                  {on && <span className="mt-0.5 block text-xs text-slate-600">{o.ruleNote}</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                    {quizDone && (
                      <div
                        className={`rounded-md border px-3 py-2.5 text-[13px] ${
                          quizWarn
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-emerald-200 bg-emerald-50 text-emerald-900"
                        }`}
                      >
                        {quizWarn
                          ? `신청 전 조치가 필요합니다: ${quizWarn.ruleNote}`
                          : quizImpacts.some((o) => o?.ruleImpact === "special_pass")
                          ? "특례 조항이 적용되어 신청 대상에 해당합니다."
                          : "기본 요건을 충족해 신청 대상에 해당합니다."}
                      </div>
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHead
                    title="판정 근거 조항"
                    desc={`시연용 공고문 ${policy.pageCount}p에서 발췌`}
                    action={<SourceBadge source="sample" />}
                  />
                  <ul className="divide-y divide-slate-100">
                    {policy.announcementExcerpts.map((c) => {
                      const open = clauseId === c.id;
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => setClauseId(open ? "" : c.id)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-purple-50/40"
                          >
                            <span className="w-24 shrink-0 text-xs text-slate-500">{c.page}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.section}</span>
                            <ChevronDown
                              className={`h-4 w-4 text-slate-400 transition-transform duration-300 ${open ? "rotate-180 text-purple-600" : ""}`}
                            />
                          </button>
                          {open && (
                            <div className="animate-expand space-y-2 px-4 pb-4 text-[13px] leading-relaxed">
                              <p className="border-l-2 border-slate-300 pl-3 text-slate-600">{c.rawText}</p>
                              <p className="rounded-md bg-brand-50 px-3 py-2 text-slate-800">
                                <span className="font-medium text-brand-700">쉽게 말하면 </span>
                                {c.plainTranslation}
                              </p>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </>
            )}

            {/* 발급 가이드 */}
            {view === "recipe" && !active && (
              <>
                <Card target="recipe-docs">
                  <CardHead
                    title={`준비할 서류 ${requiredDocs.length}종`}
                    desc={`발급 완료 ${requiredDocs.filter((d) => doneDocs[d.id]).length} / ${requiredDocs.length}`}
                  />
                  <ul className="divide-y divide-slate-100">
                    {requiredDocs.map((d) => (
                      <li key={d.id} className="p-4">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            aria-label={`${d.title} 발급 완료`}
                            checked={Boolean(doneDocs[d.id])}
                            onChange={() => setDoneDocs((s) => ({ ...s, [d.id]: !s[d.id] }))}
                            className="mt-1 h-4 w-4 accent-brand-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className={`text-sm font-medium ${doneDocs[d.id] ? "text-slate-400 line-through" : ""}`}>
                                  {d.title}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {d.issuer} · {d.timeEstimate}
                                </div>
                              </div>
                              <a
                                href={d.issuerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-purple-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                발급처 열기 <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <ul className="mt-3 space-y-2">
                              {d.checkboxOptions.map((c) => (
                                <li key={c.label} className="flex gap-2 text-[13px]">
                                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" strokeWidth={2.5} />
                                  <span>
                                    {c.label}
                                    <span className="block text-xs text-slate-500">{c.reason}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>

                <Card target="recipe-exempt">
                  <CardHead title="이 조건에서는 내지 않아도 되는 서류" />
                  <ul className="divide-y divide-slate-100">
                    {exemptDocs.map((d) => (
                      <li key={d.id} className="px-4 py-3 text-[13px]">
                        <div className="text-slate-500 line-through">{d.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{d.eliminatedReason?.replace(/\s*\(자동 소거\)/, "")}</div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </>
            )}

            {/* 사전 검수 */}
            {view === "audit" && !active && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 text-[13px]">
                    {(
                      [
                        ["defect", "예시 세트 A (미비)"],
                        ["fixed", "예시 세트 B (보완)"],
                        ...(upload ? [["upload", "내 업로드"]] : []),
                      ] as [AuditMode, string][]
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        onClick={() => setAuditMode(m)}
                        aria-pressed={auditMode === m}
                        className={`rounded-lg px-2.5 py-1 transition-all ${
                          auditMode === m ? "bg-white text-purple-700 shadow-sm ring-1 ring-slate-200/70" : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {auditMode === "upload" && upload ? (
                    <span className="text-xs text-slate-500">
                      검수 방식: {upload.mode === "gemini" ? "Gemini 판독" : "규칙 엔진"}
                    </span>
                  ) : (
                    <SourceBadge source="sample" />
                  )}
                </div>

                <AuditReport audit={audit} display={display} />

                {auditMode === "defect" && (
                  <button
                    onClick={() => runMission("audit_fixed")}
                    disabled={working}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:border-purple-200 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    보완 서류(세트 B)로 재검수 <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}

            {/* 신청 패키지 */}
            {view === "package" && !active && (
              <>
                {auditRisks > 0 && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 shadow-sm text-[13px] text-amber-900">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      현재 선택된 서류에 반려 위험 {auditRisks}건이 남아 있습니다. 사전 검수 탭에서 보완한 뒤 제출하세요.
                    </span>
                  </div>
                )}

                <Card target="package-form">
                  <CardHead
                    title="신청서 자동 기입"
                    desc={form.formTitle}
                    action={
                      <a
                        href="https://www.bokjiro.go.kr"
                        target="_blank"
                        rel="noreferrer"
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-purple-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        복지로 <ExternalLink className="h-3 w-3" />
                      </a>
                    }
                  />
                  <dl className="divide-y divide-slate-100">
                    {formFields.map((f) => (
                      <div key={f.label} className="px-4 py-2.5 text-[13px]">
                        <dt className="text-xs text-slate-500">{f.label}</dt>
                        <dd className="mt-0.5">{display(f.value)}</dd>
                        <dd className="mt-0.5 text-xs text-slate-400">출처: {f.sourceDoc}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card target="package-essay">
                  <CardHead title="계획서 초안" desc={form.essayTitle} />
                  <div className="space-y-3 p-4">
                    <textarea
                      value={essay}
                      onChange={(e) => setEssay(e.target.value)}
                      rows={9}
                      aria-label="계획서 초안"
                      className="block w-full rounded-xl border border-slate-200 bg-white p-3 transition-shadow text-[13px] leading-relaxed focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15"
                    />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
                      <span className="tnum">{essay.length.toLocaleString("ko-KR")}자</span>
                      <span className={forbiddenHit.length ? "font-medium text-red-700" : ""}>
                        금칙어 {forbiddenHit.length ? `${forbiddenHit.length}건: ${forbiddenHit.join(", ")}` : "없음"}
                      </span>
                      <span>
                        권장 키워드 {keywordHit.length} / {form.recommendedKeywords.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {form.recommendedKeywords.map((k) => (
                        <span
                          key={k}
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            essay.includes(k) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>

                <Card target="package-files">
                  <CardHead title="제출 파일명" desc="공고문 규격에 맞춘 이름" />
                  <ul className="divide-y divide-slate-100">
                    {audit.documents.map((d) => (
                      <li key={d.docId} className="px-4 py-2.5 text-[13px]">
                        <div className="font-mono text-xs">{d.renamedFileName}</div>
                        <div className="text-xs text-slate-400">원본: {d.fileName}</div>
                      </li>
                    ))}
                  </ul>
                </Card>

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
                <h3 className="text-[13px] font-semibold">API 연결</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  키로 인증하면 실제 데이터와 AI 답변이 연결됩니다.
                </p>
                <div className="mt-3 space-y-4">
                  <KeyField
                    label="Google Gemini API 키"
                    hint={apiMsg || "자유 질문 답변과 이미지·PDF 서류 판독에 사용합니다."}
                    ok={apiConnected}
                    value={geminiKey}
                    onChange={setGeminiKey}
                    placeholder="AIza..."
                    link={{ href: "https://aistudio.google.com/app/apikey", text: "키 발급" }}
                  />
                  <KeyField
                    label="공공데이터포털 키 (보조금24)"
                    hint={publicMsg || "정부 지원사업 목록을 실시간으로 조회합니다."}
                    ok={publicOk}
                    value={publicKey}
                    onChange={setPublicKey}
                    placeholder="data.go.kr 인증키"
                    link={{ href: "https://www.data.go.kr", text: "키 발급" }}
                  />
                  <button
                    onClick={saveKeys}
                    disabled={testing}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                  >
                    {testing && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    저장하고 연결 확인
                  </button>
                </div>
              </section>

              <section>
                <h3 className="text-[13px] font-semibold">개인정보와 저장</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  대화 기록, 도구 목록, API 키는 이 브라우저에만 저장됩니다. 이미지·PDF 서류는 판독을 위해 원본이
                  Gemini로 전송됩니다.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <button
                    role="switch"
                    aria-checked={maskOnScreen}
                    onClick={() => setMaskOnScreen((v) => !v)}
                    className="flex items-center gap-2.5 text-[13px] text-slate-700"
                  >
                    <span className={`relative h-4 w-7 rounded-full transition-colors ${maskOnScreen ? "bg-brand-600" : "bg-slate-300"}`}>
                      <span
                        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${maskOnScreen ? "translate-x-3.5" : "translate-x-0.5"}`}
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

    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
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
        gl_FragColor = vec4(glowCol, ambientGlow * smoothstep(0.5, 0.28, r));
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

    gl_FragColor = vec4(col, alpha);
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

function CardView({ card, onAsk, disabled }: { card: AnswerCard; onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-[15px] font-semibold leading-snug text-slate-900">{card.summary}</p>

      {card.facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
          {card.facts.map((f) => (
            <div key={f.label} className="bg-white px-3 py-2">
              <dt className="text-xs text-slate-500">{f.label}</dt>
              <dd className="tnum mt-0.5 text-sm font-medium text-slate-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.steps.length > 0 && (
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[13px] text-slate-700">
          {card.steps.map((st, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="h-3 w-3 text-slate-300" aria-hidden />}
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                {i + 1}
              </span>
              {st}
            </li>
          ))}
        </ol>
      )}

      {card.caution && (
        <p className="flex items-start gap-1.5 text-[13px] text-amber-800">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {card.caution}
        </p>
      )}

      {card.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {card.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 shadow-sm shadow-purple-500/20 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-700"
            >
              {l.name}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ))}
        </div>
      )}

      {card.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {card.followUps.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              disabled={disabled}
              className="rounded-full border border-slate-300 px-3 py-1 text-[13px] text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
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
          p
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
              ["triage", "자격 확인"],
              ["recipe", "서류 준비"],
              ["audit", "서류 검수"],
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
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} />
                  {c}
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
}: {
  question: string;
  msg: Message;
  card: AnswerCard;
  sites: Site[];
  onOpen: (policyIndex: number, view: View) => void;
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
          desc={`실계산 ${traces.filter((t) => t.source === "calc").length} · 예시 데이터 ${traces.filter((t) => t.source === "sample").length} · 실시간 ${traces.filter((t) => t.source === "live").length}`}
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
        <div className={`rounded-2xl border px-4 py-3.5 shadow-sm ${verdict.cls}`}>
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
                <div className="mt-2 inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 text-xs">
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
                      className={`rounded-lg px-2.5 py-1 transition-all duration-200 ${
                        cond[i] === v
                          ? v === "yes"
                            ? "bg-emerald-500 text-white shadow-sm"
                            : v === "no"
                            ? "bg-red-500 text-white shadow-sm"
                            : "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/70"
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
      <Card>
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
          Gemini가 판독합니다. 텍스트 서류는 주민번호 등을 가린 뒤 보내고, 이미지·PDF는 원본이 전송됩니다. 서버에 저장하지 않습니다.
        </p>
      </Card>
      {st.audit ? (
        <AuditReport audit={st.audit} display={display} />
      ) : (
        <Card>
          <Empty text="아직 검수한 서류가 없습니다. 서류를 올리면 결과가 여기에 표시됩니다." />
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
  const yes = p.conditions.filter((_, i) => st.cond?.[i] === "yes").length;
  const no = p.conditions.filter((_, i) => st.cond?.[i] === "no").length;
  const ready = p.documents.filter((_, i) => st.docs?.[i]).length;
  const risks = st.audit ? risksOf(st.audit) : null;
  const condLabel = (i: number) => ({ yes: "해당", no: "아님", unsure: "모름" })[st.cond?.[i] || "unsure"] || "미확인";

  const download = () => {
    const content = [
      `[공고패스] ${p.name} 신청 준비 요약`,
      p.benefit && `지원 내용: ${p.benefit}`,
      p.deadline && `기한: ${p.deadline}`,
      p.applyAt && `신청처: ${p.applyAt}`,
      p.asOf && `정보 기준: ${p.asOf}`,
      `※ AI가 검색으로 정리한 정보입니다. 공고 원문으로 확인하고, 최종 판정은 접수 기관이 합니다.`,
      ``,
      `1. 자격 조건 (${yes}/${p.conditions.length} 충족)`,
      ...p.conditions.map((c, i) => `- [${st.cond?.[i] ? condLabel(i) : "미확인"}] ${c}`),
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
    a.download = `공고패스_${p.name.replace(/\s+/g, "_")}_신청준비.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <>
      <PolicyHead p={p} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="자격 조건" value={`${yes} / ${p.conditions.length}`} note={no ? `아님 ${no}개` : "자격 판정 탭에서 확인"} ok={!no && yes === p.conditions.length && yes > 0} />
        <Stat label="서류 준비" value={`${ready} / ${p.documents.length}`} note="발급 가이드 탭에서 체크" ok={ready === p.documents.length && ready > 0} />
        <Stat label="서류 검수" value={risks === null ? "미실시" : `위험 ${risks}건`} note="사전 검수 탭에서 실행" ok={risks === 0} />
      </div>
      {steps.length > 0 && (
        <Card>
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
