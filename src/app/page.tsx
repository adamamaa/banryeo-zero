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
  FileCheck2,
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

const policy = POLICY_SCENARIOS[0];
const form = policy.applicationFormTemplate;

type View = "tools" | "triage" | "recipe" | "audit" | "package";
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

  const [profile, setProfile] = useState<Profile>({
    age: 26,
    incomeManwon: 130,
    depositManwon: 1000,
    rentManwon: 75,
    sepMonths: 15,
  });
  const [tools, setTools] = useState<ToolExecution[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [openTool, setOpenTool] = useState<number | null>(3);

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
  const endRef = useRef<HTMLDivElement>(null);

  const allTools = [...CATALOG, ...custom];
  const myTools = allTools.filter((t) => addedIds.includes(t.id));

  const newChat = () => {
    if (working) return;
    setMessages([]);
    setChatId(`c-${Date.now()}`);
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

  const fetchTools = async (p: Profile = profile, mode: "defect" | "fixed" = auditMode === "fixed" ? "fixed" : "defect") => {
    setToolsLoading(true);
    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          age: p.age,
          region: REGION,
          monthlyIncomeManwon: p.incomeManwon,
          depositManwon: p.depositManwon,
          monthlyRentManwon: p.rentManwon,
          separateLivingMonths: p.sepMonths,
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
    fetchTools();
    setChats(loadLocal<Chat[]>("gonggopass_chats", []));
    const saved = loadLocal<{ added: string[]; custom: Site[] } | null>("gonggopass_tools", null);
    if (saved) {
      const safe = (saved.custom || []).filter((c) => isHttpUrl(c.url)).map((c) => ({ ...c, custom: true }));
      setCustom(safe);
      setAddedIds(saved.added || DEFAULT_TOOLS);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const runMission = async (key: MissionKey) => {
    if (working) return;
    const m = MISSIONS[key];
    if (m.mode) setAuditMode(m.mode);
    const s0 = summary;
    const copy0 = s0 ? missionCopy(key, s0, profile) : null;
    const id = pushTurn({
      content: copy0?.user || m.label,
      demo: true,
      attachments: key.startsWith("audit")
        ? ["주민등록등본.pdf", "임대차계약서.jpg", "가족관계증명서.pdf"]
        : undefined,
    });
    setExpanded((e) => ({ ...e, [id]: true }));

    const data = await fetchTools(profile, m.mode ?? (auditMode === "fixed" ? "fixed" : "defect"));
    await new Promise((r) => setTimeout(r, 450));
    if (!data.tools || !data.summary) {
      patch(id, { content: "도구 실행에 실패했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.", error: true });
    } else {
      const copy = missionCopy(key, data.summary, profile);
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
    }
    setWorking(false);
    scrollDown();
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach((file) => {
      const binary = file.type.startsWith("image/") || file.type === "application/pdf";
      const reader = new FileReader();
      reader.onload = () =>
        setStaged((prev) => [
          ...prev,
          {
            fileName: file.name,
            mimeType: binary ? file.type : "text/plain",
            base64OrText: String(reader.result || ""),
          },
        ]);
      if (binary) reader.readAsDataURL(file);
      else reader.readAsText(file, "utf-8");
    });
    e.target.value = "";
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (working || (!input.trim() && !staged.length)) return;
    const files = staged;
    const text = input.trim() || `첨부한 서류 ${files.length}건을 제출 전에 검수해 주세요.`;
    setInput("");
    setStaged([]);
    const id = pushTurn({ content: text, attachments: files.map((f) => f.fileName) });

    try {
      if (files.length) {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ocr_audit_docs", apiKey: geminiKey, uploadedDocs: files }),
        });
        const data = await res.json();
        if (!res.ok || !data.auditResult) {
          patch(id, { content: data.message || "서류 검수에 실패했습니다.", error: true });
          return;
        }
        const result: AuditResult = data.auditResult;
        const n = risksOf(result);
        setUpload({ result, mode: data.mode, note: data.note });
        setAuditMode("upload");
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
            title: "업로드 서류 검수 리포트",
            meta: `${engine} · 반려 위험 ${n}건`,
          },
        });
        return;
      }

      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "agent_chat",
          apiKey: geminiKey,
          publicDataApiKey: publicKey,
          userMessage: text,
          sites: myTools.map(({ name, url }) => ({ name, url })),
          userProfile: {
            age: profile.age,
            income: profile.incomeManwon,
            deposit: profile.depositManwon,
            rent: profile.rentManwon,
            sepMonths: profile.sepMonths,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.reply) {
        patch(id, { content: data.message || "답변을 만들지 못했습니다.", error: true });
        return;
      }
      setView("triage");
      setCanvasOpen(true);
      patch(id, {
        content:
          data.reply +
          (data.mode === "local_rules" && !geminiKey
            ? "\n\n지금은 입력된 조건의 계산 결과만 안내합니다. 연결 설정에서 Gemini API 키를 넣으면 질문 내용에 맞춰 답변합니다."
            : "") +
          relatedLinks(text, data.reply),
        traces: data.toolExecutions,
        artifact: { view: "triage", title: "자격 판정 결과", meta: "입력 조건 기준 계산" },
        followUps: ["recipe", "audit_defect"],
      });
    } catch {
      patch(id, { content: "요청을 처리하지 못했습니다. 네트워크 상태를 확인하세요.", error: true });
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

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-white text-slate-900">
      {/* ───────── 사이드바 ───────── */}
      {sidebarOpen && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 max-lg:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-white">
                <FileCheck2 className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">공고패스</span>
            </div>
            <IconButton label="사이드바 닫기" onClick={() => setSidebarOpen(false)}>
              <PanelLeft className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="px-3">
            <button
              onClick={newChat}
              className="flex w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] font-medium text-slate-800 transition-colors hover:bg-slate-100 active:translate-y-px"
            >
              <Plus className="h-4 w-4" />새 대화
            </button>
          </div>

          <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
            <div>
              <SideLabel>히스토리</SideLabel>
              {chats.length === 0 ? (
                <p className="px-2 text-xs leading-relaxed text-slate-400">대화를 시작하면 여기에 저장됩니다.</p>
              ) : (
                <ul className="space-y-0.5">
                  {chats.map((c) => (
                    <li key={c.id} className="group relative">
                      <button
                        onClick={() => openChat(c.id)}
                        aria-current={c.id === chatId}
                        className={`block w-full truncate rounded-md py-1.5 pl-2 pr-8 text-left text-[13px] transition-colors ${
                          c.id === chatId
                            ? "bg-slate-200/80 font-medium text-slate-900"
                            : "text-slate-700 hover:bg-slate-200/60"
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
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <SideLabel>내 도구</SideLabel>
              <ul className="space-y-0.5">
                {myTools.map((t) => (
                  <li key={t.id}>
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] text-slate-700 transition-colors hover:bg-slate-200/60"
                    >
                      <span className="truncate">{t.name}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-600" />
                    </a>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setShowTools(true)}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-brand-700 hover:bg-slate-200/60"
              >
                <Plus className="h-3.5 w-3.5" />
                도구 추가 · 관리
              </button>
            </div>
          </nav>

          <div className="border-t border-slate-200 p-3">
            <button
              onClick={() => setShowTools(true)}
              className="flex w-full items-center justify-between rounded-md px-2 py-2 text-[13px] text-slate-700 hover:bg-slate-200/60"
            >
              <span className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-slate-500" />
                연결 설정
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={`h-1.5 w-1.5 rounded-full ${apiConnected ? "bg-emerald-500" : "bg-slate-400"}`} />
                {apiConnected ? "AI 연결됨" : "AI 미연결"}
              </span>
            </button>
          </div>
        </aside>
      )}

      {/* ───────── 대화 ───────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <IconButton label="사이드바 열기" onClick={() => setSidebarOpen(true)} className="max-lg:hidden">
                <PanelLeft className="h-4 w-4" />
              </IconButton>
            )}
            <h1 className="text-sm font-semibold">제출 전 사전 점검</h1>
            <span className="hidden text-xs text-slate-500 sm:inline">· {policy.title}</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={newChat}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />새 대화
              </button>
            )}
            {!canvasOpen && (
              <IconButton label="결과 패널 열기" onClick={() => setCanvasOpen(true)}>
                <PanelRight className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-5 py-8">
            {messages.length === 0 ? (
              <div className="pt-6">
                <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-balance">
                  지원금 신청서, 내기 전에 먼저 점검하세요
                </h2>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-600">
                  공고문 조건으로 자격을 계산하고, 준비한 서류를 접수 기준에 맞춰 검수합니다. 조건을 입력하거나
                  서류를 첨부하면 바로 시작합니다.
                </p>

                <div className="mt-8 divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {(["triage", "recipe", "audit_defect", "audit_fixed"] as MissionKey[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => runMission(k)}
                      className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-slate-50"
                    >
                      <span className="tnum w-4 text-sm font-medium text-slate-400">{MISSIONS[k].no}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{MISSIONS[k].label}</span>
                        <span className="block text-[13px] text-slate-500">{MISSIONS[k].sub}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </button>
                  ))}
                </div>

                <div className="mt-6">
                  <div className="text-xs font-medium text-slate-500">이렇게 물어볼 수 있어요</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      "월세가 70만 원을 넘어도 받을 수 있나요?",
                      "주민등록등본은 어디서 어떻게 발급하나요?",
                      "부모님 소득이 높으면 탈락인가요?",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => setInput(q)}
                        className="rounded-full border border-slate-300 px-3 py-1.5 text-[13px] text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="mt-6 text-xs leading-relaxed text-slate-500">
                  위 4단계는 시연 시나리오입니다. 최종 판정은 접수 기관이 합니다.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {messages.map((msg) =>
                  msg.role === "user" ? (
                    <div key={msg.id} className="flex flex-col items-end gap-1.5">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {msg.attachments.map((a) => (
                            <FileChip key={a} name={a} />
                          ))}
                        </div>
                      )}
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-100 px-4 py-2.5 text-sm leading-relaxed">
                        {msg.content}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {msg.demo && "시연 시나리오 · "}
                        {msg.time}
                      </span>
                    </div>
                  ) : (
                    <div key={msg.id} className="space-y-3">
                      {msg.pending ? (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          확인하는 중입니다
                        </div>
                      ) : (
                        <>
                          {msg.traces && msg.traces.length > 0 && (
                            <div className="rounded-lg border border-slate-200">
                              <button
                                onClick={() => setExpanded((e) => ({ ...e, [msg.id]: !e[msg.id] }))}
                                aria-expanded={Boolean(expanded[msg.id])}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-slate-600 hover:bg-slate-50"
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

                          <div
                            className={`whitespace-pre-wrap text-sm leading-relaxed ${msg.error ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-800" : "text-slate-800"}`}
                          >
                            <Rich text={msg.content} />
                          </div>

                          {msg.artifact && (
                            <button
                              onClick={() => {
                                setView(msg.artifact!.view);
                                setCanvasOpen(true);
                              }}
                              className="group flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600">
                                <FileText className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">{msg.artifact.title}</span>
                                <span className="block truncate text-xs text-slate-500">{msg.artifact.meta}</span>
                              </span>
                              <span className="text-xs text-slate-500 group-hover:text-slate-800">열기</span>
                            </button>
                          )}

                          {msg.followUps && msg.followUps.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {msg.followUps.map((k) => (
                                <button
                                  key={k}
                                  onClick={() => runMission(k)}
                                  disabled={working}
                                  className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 active:translate-y-px disabled:opacity-50"
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

        {/* 입력창 */}
        <div className="shrink-0 px-5 pb-5">
          <form
            onSubmit={send}
            className="mx-auto w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-sm transition-shadow focus-within:border-slate-400 focus-within:shadow"
          >
            {staged.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
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
              placeholder="조건을 입력하거나 서류를 첨부하세요"
              className="block w-full resize-none bg-transparent px-4 pt-3 text-sm placeholder:text-slate-400 focus:outline-none"
            />
            <div className="flex items-center justify-between px-2.5 pb-2.5">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100">
                <Paperclip className="h-4 w-4" />
                서류 첨부
                <input type="file" multiple accept=".pdf,image/*,.txt" onChange={onFiles} className="sr-only" />
              </label>
              <button
                type="submit"
                disabled={working || (!input.trim() && !staged.length)}
                aria-label="보내기"
                className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 active:translate-y-px disabled:bg-slate-200 disabled:text-slate-400"
              >
                {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* ───────── 결과 패널 ───────── */}
      {canvasOpen && (
        <section className="flex w-[48%] min-w-[420px] shrink-0 flex-col border-l border-slate-200 bg-slate-50 max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-full max-lg:min-w-0">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white pl-4 pr-2">
            <div role="tablist" className="flex h-full items-stretch gap-5 overflow-x-auto">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`shrink-0 border-b-2 text-[13px] transition-colors ${
                    view === v.id
                      ? "border-brand-600 font-semibold text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <IconButton label="결과 패널 닫기" onClick={() => setCanvasOpen(false)}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {/* 실행 내역 */}
            {view === "tools" && (
              <>
                <Card>
                  <CardHead
                    title="입력 조건"
                    desc="값을 바꾸고 다시 계산하면 판정과 도구 결과가 갱신됩니다."
                    action={
                      <button
                        onClick={() => fetchTools()}
                        disabled={toolsLoading}
                        className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-700 active:translate-y-px disabled:opacity-60"
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
                        <span className="mt-1 flex items-center rounded-md border border-slate-300 bg-white focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/15">
                          <input
                            type="number"
                            min={0}
                            value={profile[k]}
                            onChange={(e) => setProfile((p) => ({ ...p, [k]: Math.max(0, Number(e.target.value)) }))}
                            className="tnum w-full min-w-0 bg-transparent px-2 py-1.5 text-sm focus:outline-none"
                          />
                          <span className="shrink-0 pr-2 text-xs text-slate-400">{unit}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Card>

                <Card>
                  <CardHead
                    title={`도구 실행 ${tools.length}건`}
                    desc={`실계산 ${tools.filter((t) => t.source === "calc").length} · 예시 데이터 ${tools.filter((t) => t.source === "sample").length} · 실시간 API ${tools.filter((t) => t.source === "live").length}`}
                  />
                  {tools.length === 0 ? (
                    <Empty text={toolsLoading ? "도구를 실행하는 중입니다" : "실행 내역이 없습니다. 다시 계산을 눌러 주세요."} />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {tools.map((t) => {
                        const open = openTool === t.step;
                        return (
                          <li key={t.step}>
                            <button
                              onClick={() => setOpenTool(open ? null : t.step)}
                              aria-expanded={open}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                            >
                              <span className="tnum w-4 text-xs text-slate-400">{t.step}</span>
                              <StatusDot status={t.status} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">{t.title}</span>
                                <span className="block truncate text-xs text-slate-500">{t.basis}</span>
                              </span>
                              <SourceBadge source={t.source} />
                              <ChevronDown
                                className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
                              />
                            </button>
                            {open && (
                              <div className="grid gap-4 bg-slate-50 px-4 py-3 sm:grid-cols-2">
                                <KeyValues title="입력" data={t.input} />
                                <KeyValues title="결과" data={t.output} />
                                <div className="flex items-center justify-between text-xs text-slate-500 sm:col-span-2">
                                  <code className="font-mono">{t.toolName}</code>
                                  {t.url && (
                                    <a
                                      href={t.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-1 hover:text-slate-800"
                                    >
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
                  )}
                </Card>
              </>
            )}

            {/* 자격 판정 */}
            {view === "triage" && (
              <>
                {summary ? (
                  <>
                    <div className={`rounded-lg border px-4 py-3 ${VERDICT[summary.verdict].cls}`}>
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
                        label="환산 합산 월세"
                        value={won(summary.totalConvertedRentKRW)}
                        note="상한 900,000원"
                        ok={summary.totalConvertedRentKRW <= 900000 || profile.rentManwon <= 70}
                      />
                      <Stat
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
                                className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13px] transition-colors ${
                                  on ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={q.id}
                                  checked={on}
                                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.value }))}
                                  className="mt-0.5 accent-[#2558D9]"
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
                            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                          >
                            <span className="w-24 shrink-0 text-xs text-slate-500">{c.page}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.section}</span>
                            <ChevronDown
                              className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
                            />
                          </button>
                          {open && (
                            <div className="space-y-2 px-4 pb-4 text-[13px] leading-relaxed">
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
            {view === "recipe" && (
              <>
                <Card>
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
                            className="mt-1 h-4 w-4 accent-[#2558D9]"
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
                                className="flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
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

                <Card>
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
            {view === "audit" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-[13px]">
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
                        className={`rounded px-2.5 py-1 transition-colors ${
                          auditMode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
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

                <div
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
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
                  <Card>
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
                  <Card>
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

                {auditMode === "defect" && (
                  <button
                    onClick={() => runMission("audit_fixed")}
                    disabled={working}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    보완 서류(세트 B)로 재검수 <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}

            {/* 신청 패키지 */}
            {view === "package" && (
              <>
                {auditRisks > 0 && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      현재 선택된 서류에 반려 위험 {auditRisks}건이 남아 있습니다. 사전 검수 탭에서 보완한 뒤 제출하세요.
                    </span>
                  </div>
                )}

                <Card>
                  <CardHead
                    title="신청서 자동 기입"
                    desc={form.formTitle}
                    action={
                      <a
                        href="https://www.bokjiro.go.kr"
                        target="_blank"
                        rel="noreferrer"
                        className="flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
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

                <Card>
                  <CardHead title="계획서 초안" desc={form.essayTitle} />
                  <div className="space-y-3 p-4">
                    <textarea
                      value={essay}
                      onChange={(e) => setEssay(e.target.value)}
                      rows={9}
                      aria-label="계획서 초안"
                      className="block w-full rounded-md border border-slate-300 bg-white p-3 text-[13px] leading-relaxed focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15"
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

                <Card>
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
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 active:translate-y-px"
                >
                  {downloaded ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  {downloaded ? "내려받았습니다" : "점검 요약 내려받기 (.txt)"}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* ───────── 도구 · 연결 ───────── */}
      {showTools && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4" onClick={() => setShowTools(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="도구와 연결"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
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
                  추가한 사이트는 왼쪽 &lsquo;내 도구&rsquo;에 모이고, 답변에서 관련 링크로 안내됩니다. 로그인은 각
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
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
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
  );
}

/* ───────── 작은 구성 요소 ───────── */

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

function Card({ children }: { children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">{children}</section>;
}

function CardHead({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {desc && <p className="mt-0.5 truncate text-xs text-slate-500">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, note, ok }: { label: string; value: string; note: string; ok: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="tnum mt-1.5 text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
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
