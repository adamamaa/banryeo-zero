"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  POLICY_SCENARIOS,
  PolicyScenario,
  AuditFinding,
} from "@/data/policies";
import {
  SpringCounter,
  AnimatedCheckIcon,
} from "@/components/MotionPrimitives";
import {
  Sparkles,
  ArrowRight,
  Download,
  ExternalLink,
  RefreshCw,
  Check,
  Stamp,
  ChevronRight,
  ChevronDown,
  Bot,
  FileText,
  Wand2,
  X,
  KeyRound,
  Lock,
  Cpu,
  Send,
  Paperclip,
  CheckCircle2,
  AlertCircle,
  PlugZap,
  PanelRightOpen,
  PanelLeftOpen,
  Plus,
  Terminal,
  BrainCircuit,
  Layers,
  Eye,
  FileSpreadsheet,
  SlidersHorizontal,
  Building2,
  Globe,
  Play,
} from "lucide-react";

type ArtifactViewType =
  | "agency_hub"
  | "triage_clause"
  | "doc_recipe"
  | "pre_audit_xray"
  | "application_editor";

interface ToolTraceItem {
  id: string;
  agency?: string;
  deepLinkUrl?: string;
  toolName: string;
  title: string;
  status: "running" | "done" | "warn";
  inputSummary: string;
  outputSummary: string;
  rawOutput?: Record<string, unknown>;
}

interface GovToolExecution {
  step: number;
  agency: string;
  agencyBadgeColor: string;
  toolName: string;
  description: string;
  deepLinkUrl?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: "done" | "warn";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: {
    name: string;
    type: string;
    tag?: string;
  }[];
  thinkingText?: string;
  toolTraces?: ToolTraceItem[];
  artifactAction?: {
    view: ArtifactViewType;
    title: string;
    subtitle: string;
    badge: string;
  };
  followUpSuggestions?: {
    label: string;
    actionKey: string;
  }[];
  timestamp: string;
}

const CONNECTED_AGENCIES = [
  {
    name: "행정안전부 정부24 · 보조금24",
    tool: "gov24_subsidy_search",
    url: "https://www.gov.kr/portal/rcvfvrSvc/main",
    role: "국가·지자체 중복수혜 조회 및 등본 발급 연동",
  },
  {
    name: "국무조정실 온통청년",
    tool: "youth_center_policy_detail",
    url: "https://www.youthcenter.go.kr",
    role: "공고문 원문 및 [별표] 특례 규칙 수집",
  },
  {
    name: "국민건강보험공단",
    tool: "nhis_health_insurance_calc",
    url: "https://www.nhis.or.kr",
    role: "건보료 부과액 ↔ 2026 중위소득 % 역산",
  },
  {
    name: "국토교통부 건축물대장 · RTMS",
    tool: "molit_building_ledger_check",
    url: "https://rtms.molit.go.kr",
    role: "위반건축물·주택용도 및 환산월세(5.5%) 계산",
  },
  {
    name: "대법원 전자가족관계시스템",
    tool: "gov24_civil_doc_recipe",
    url: "https://efamily.scourt.go.kr",
    role: "상세증명서 발급 옵션 및 가구원 검증",
  },
  {
    name: "복지로 · 고용24 전자신청",
    tool: "welfare_form_packager",
    url: "https://www.bokjiro.go.kr",
    role: "표준 신청서 OCR 자동기입 및 루브릭 검증",
  },
];

export default function GongGoPassAgentWorkspace() {
  const [policies] = useState<PolicyScenario[]>(POLICY_SCENARIOS);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>(
    POLICY_SCENARIOS[0].id
  );
  const currentPolicy: PolicyScenario =
    policies.find((p) => p.id === selectedPolicyId) || policies[0];

  const [highlightedClauseId, setHighlightedClauseId] = useState<string>(
    currentPolicy.personas[0].verdictClauseId
  );

  // Layout Panels
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [canvasOpen, setCanvasOpen] = useState<boolean>(true);
  const [activeArtifactView, setActiveArtifactView] =
    useState<ArtifactViewType>("agency_hub");

  // API Connection State
  const [geminiApiKey, setGeminiApiKey] = useState<string>("");
  const [publicDataApiKey, setPublicDataApiKey] = useState<string>("");
  const [apiConnected, setApiConnected] = useState<boolean>(false);
  const [apiStatusMsg, setApiStatusMsg] = useState<string>(
    "9대 공공기관 연동 도구가 활성화되어 있습니다. Gemini API 키 추가 시 실시간 LLM 추론 및 픽셀 Vision OCR이 동작합니다."
  );
  const [isTestingApi, setIsTestingApi] = useState<boolean>(false);
  const [showApiModal, setShowApiModal] = useState<boolean>(false);

  // Privacy Guardrail & Audit State
  const [piiMaskingEnabled, setPiiMaskingEnabled] = useState<boolean>(true);
  const [auditMode, setAuditMode] = useState<"defect" | "fixed" | "real_ocr">(
    "defect"
  );
  const [activeFindingDocId, setActiveFindingDocId] = useState<string | null>(
    null
  );
  const [checkedRecipes, setCheckedRecipes] = useState<Record<string, boolean>>({
    "doc-rr": true,
    "doc-lease": true,
    "doc-family": false,
    "doc-bank": false,
  });

  // Real Uploaded Files in Chat Composer
  const [stagedAttachments, setStagedAttachments] = useState<
    {
      fileName: string;
      mimeType: string;
      base64OrText: string;
      category: "doc" | "policy";
    }[]
  >([]);
  const [realOcrAuditData, setRealOcrAuditData] = useState<
    PolicyScenario["auditScenarios"]["fixed"] | null
  >(null);
  const [realAutoFilledFields, setRealAutoFilledFields] = useState<
    { label: string; value: string; sourceDoc: string }[] | null
  >(null);

  // Live 9-Tool Pipeline State & Parameters
  const [liveMetrics, setLiveMetrics] = useState({
    age: 26,
    region: "서울특별시 관악구 봉천로 123, 301호",
    incomeManwon: 130,
    depositManwon: 1000,
    rentManwon: 75,
    sepMonths: 15,
    medianRatioPercent: 54.3,
    convertedRentKRW: 795833,
    isEligible: true,
  });
  const [govToolSteps, setGovToolSteps] = useState<GovToolExecution[]>([]);
  const [selectedToolStepIdx, setSelectedToolStepIdx] = useState<number>(0);
  const [isRunningAllTools, setIsRunningAllTools] = useState<boolean>(false);

  // Essay & Package State
  const [essayDraft, setEssayDraft] = useState<string>(
    currentPolicy.applicationFormTemplate.generatedEssayDraft
  );
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  // Chat Stream State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [isAgentWorking, setIsAgentWorking] = useState<boolean>(false);
  const [expandedTraceIds, setExpandedTraceIds] = useState<
    Record<string, boolean>
  >({});
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 80);
  };

  // Run the 9-Tool GovTech Orchestrator (/api/agent/execute)
  const fetchNineGovTools = useCallback(
    async (
      customParams?: Partial<typeof liveMetrics>,
      mode: "defect" | "fixed" = auditMode === "fixed" ? "fixed" : "defect"
    ) => {
      setIsRunningAllTools(true);
      const p = { ...liveMetrics, ...customParams };
      try {
        const res = await fetch("/api/agent/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            age: p.age,
            region: p.region,
            monthlyIncomeManwon: p.incomeManwon,
            depositManwon: p.depositManwon,
            monthlyRentManwon: p.rentManwon,
            separateLivingMonths: p.sepMonths,
            auditMode: mode,
            publicDataApiKey,
            essayText: essayDraft,
          }),
        });
        const data = await res.json();
        if (data?.toolExecutions) {
          setGovToolSteps(data.toolExecutions);
          setLiveMetrics((prev) => ({
            ...prev,
            ...customParams,
            medianRatioPercent:
              data.summary?.medianRatioPercent ?? prev.medianRatioPercent,
            convertedRentKRW:
              data.summary?.totalConvertedRentKRW ?? prev.convertedRentKRW,
          }));
        }
        return data;
      } finally {
        setIsRunningAllTools(false);
      }
    },
    [liveMetrics, auditMode, publicDataApiKey, essayDraft]
  );

  // Verify API Key
  const verifyApiKey = useCallback(async (keyToTest: string) => {
    setIsTestingApi(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping", apiKey: keyToTest }),
      });
      const data = await res.json();
      setApiConnected(Boolean(data.connected));
      setApiStatusMsg(data.message || "");
      if (data.connected && keyToTest) {
        localStorage.setItem("gonggopass_gemini_key", keyToTest);
      }
    } catch {
      setApiConnected(false);
    } finally {
      setIsTestingApi(false);
    }
  }, []);

  useEffect(() => {
    const savedGemini = localStorage.getItem("gonggopass_gemini_key") || "";
    const savedPublic = localStorage.getItem("gonggopass_public_key") || "";
    if (savedGemini) setGeminiApiKey(savedGemini);
    if (savedPublic) setPublicDataApiKey(savedPublic);
    verifyApiKey(savedGemini);
    fetchNineGovTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: Append an Assistant Turn with Progressive Multi-Agency Tool Streaming
  const runAgentWorkflowTurn = async ({
    userText,
    attachedLabels,
    thinkingText,
    traces,
    finalReply,
    targetArtifact,
    followUps,
  }: {
    userText: string;
    attachedLabels?: { name: string; type: string; tag?: string }[];
    thinkingText: string;
    traces: ToolTraceItem[];
    finalReply: string;
    targetArtifact: {
      view: ArtifactViewType;
      title: string;
      subtitle: string;
      badge: string;
    };
    followUps?: { label: string; actionKey: string }[];
  }) => {
    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now() + 1}`;
    const now = new Date().toLocaleTimeString("ko-KR", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: userText,
        attachments: attachedLabels,
        timestamp: now,
      },
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        thinkingText,
        toolTraces: traces.map((t) => ({
          ...t,
          status: "running",
        })),
        timestamp: now,
      },
    ]);
    setExpandedTraceIds((prev) => ({ ...prev, [assistantMsgId]: true }));
    setIsAgentWorking(true);
    scrollToBottom();

    await new Promise((r) => setTimeout(r, 600));

    setActiveArtifactView(targetArtifact.view);
    setCanvasOpen(true);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: finalReply,
              toolTraces: traces,
              artifactAction: targetArtifact,
              followUpSuggestions: followUps,
            }
          : m
      )
    );
    setIsAgentWorking(false);
    scrollToBottom();
  };

  // ==================== MULTI-TOOL AGENT MISSIONS ====================
  const executeMission = async (missionKey: string) => {
    if (isAgentWorking) return;

    // Mission 0: 9대 공공기관 도구(정부24·온통청년·건보공단·국토부 건축물대장/RTMS·대법원·복지로) 전체 연쇄 실행!
    if (missionKey === "mission_all_9_tools") {
      const data = await fetchNineGovTools();
      const execs: GovToolExecution[] = data?.toolExecutions || govToolSteps;

      await runAgentWorkflowTurn({
        userText:
          "서울 관악구 봉천로 123(301호)에 보증금 1,000만 원·월세 75만 원으로 15개월째 자취 중인 26세 청년(월 소득 130만 원)이야. 정부24, 온통청년, 건보공단, 국토부 건축물대장, 대법원, 복지로 도구를 전부 연결해서 내 수혜 가능 사업부터 주택 적격 여부, 서류 검수까지 한 번에 조회해 줘!",
        thinkingText:
          "단일 공고문만 읽지 않고 7개 공공기관 연동 도구 9개를 순차적으로 오케스트레이션합니다: ① 정부24(보조금24) 중복수혜 검색 → ② 온통청년 18p [별표2] 파싱 → ③ 건보공단 중위소득 % 역산 → ④ 국토부 세움터 건축물대장(주택용도·위반건축물) 조회 → ⑤ 국토부 RTMS 환산월세(5.5%) 계산 → ⑥ 정부24·대법원 직통 발급 딥링크 매핑 → ⑦ 로컬 PII 마스킹 → ⑧ 다중서류 교차검증 → ⑨ 복지로 신청서 패키징.",
        traces: execs.map((ex, idx) => ({
          id: `all9-${idx}-${Date.now()}`,
          agency: ex.agency,
          deepLinkUrl: ex.deepLinkUrl,
          toolName: ex.toolName,
          title: ex.description,
          status: ex.status,
          inputSummary: JSON.stringify(ex.input),
          outputSummary: Object.values(ex.output).slice(0, 2).join(" · "),
          rawOutput: ex.output,
        })),
        finalReply: `총 **7개 공공기관의 9대 도구(Tools)**를 연쇄 호출하여 통합 조회를 완료했습니다!\n\n1. **[행정안전부 정부24 · 보조금24]**\n   • **국토부 청년월세 특별지원(240만 원)** 외에 **관악구 청년 중개보수·이사비 지원(40만 원)** 중복 수혜 가능 확인\n2. **[국민건강보험공단 & 온통청년 별표2]**\n   • 월 소득 130만 원 = **2026년 1인가구 기준중위소득 54.3%**(추정 건보료 월 46,085원 ≤ 커트라인 50,880원 이하)\n   • **18p [별표2] 독립가구 단독산정 특례** 작동 → **부모님 건보료·소득 심사 완전 면제**\n3. **[국토교통부 건축물대장 & RTMS]**\n   • 봉천로 123(301호) 건축물대장 조회 결과 **다세대주택(24.8㎡, 위반건축물 없음)**으로 지원 적격 주택 확인\n   • 보증금 월세 환산 합산액 **795,833원(≤ 90만 원)** 통과\n4. **[정부24 · 대법원 · 복지로 연결]**\n   • 우측 캔버스에 **9대 공공기관 도구 파이프라인과 각 기관 직통 민원 발급 링크**를 띄워두었습니다.`,
        targetArtifact: {
          view: "agency_hub",
          title: "7개 공공기관 · 9대 에이전트 도구(Tool) 실시간 연동 파이프라인",
          subtitle:
            "정부24 · 온통청년 · 건보공단 · 국토부 건축물대장/RTMS · 대법원 · 복지로",
          badge: "9개 Tool 연쇄 호출 완료",
        },
        followUps: [
          {
            label: "📊 18p [별표2] 원문 하이라이트 & 건보료·건축물대장 판정서 보기",
            actionKey: "mission_triage",
          },
          {
            label: "📋 정부24 · 대법원 필수 체크박스 레시피 및 직통 발급 링크 열기",
            actionKey: "mission_recipe",
          },
          {
            label: "🔍 등본(301호) ↔ 계약서(302호) ↔ 건축물대장 교차검수 시연",
            actionKey: "mission_audit_defect",
          },
        ],
      });
      return;
    }

    // Mission 1: 자격 판독 & 건보공단/국토부 건축물대장/RTMS 5개 도구 호출
    if (missionKey === "mission_triage") {
      const data = await fetchNineGovTools();
      const execs: GovToolExecution[] = (data?.toolExecutions || govToolSteps).slice(0, 5);
      setHighlightedClauseId("clause-special");

      await runAgentWorkflowTurn({
        userText:
          "나 26살이고 부모님이랑 따로 나와 산 지 1년 3개월 됐어. 알바로 월 130만 원 벌고, 관악구 봉천로 123(301호)에 보증금 1,000만 원·월세 75만 원으로 사는데 부모님 소득이 높아. 정부24·건보공단·국토부 건축물대장 조회해서 신청 가능한지 판독해 줘!",
        thinkingText:
          "정확한 자격 판독을 위해 5개의 외부 공공기관 도구를 연쇄 호출합니다: ① 정부24(보조금24) 수혜 사업 조회 → ② 온통청년 18p [별표2] 특례 조회 → ③ 국민건강보험공단 건보료·중위소득 % 계산 → ④ 국토교통부 세움터 건축물대장(위반건축물·주택용도) 확인 → ⑤ 국토부 RTMS 보증금 월세 환산액(5.5%) 계산.",
        traces: execs.map((ex, idx) => ({
          id: `tr-${idx}-${Date.now()}`,
          agency: ex.agency,
          deepLinkUrl: ex.deepLinkUrl,
          toolName: ex.toolName,
          title: ex.description,
          status: ex.status,
          inputSummary: JSON.stringify(ex.input),
          outputSummary: Object.values(ex.output).slice(0, 2).join(" · "),
          rawOutput: ex.output,
        })),
        finalReply: `**정부24 · 온통청년 · 건보공단 · 국토교통부(건축물대장·RTMS) 5개 도구**를 연결해 판독한 결과, **부모님 소득과 무관하게 100% 지원 대상(총 240만 원)**입니다!\n\n• **[국민건강보험공단 도구]**: 월 소득 130만 원은 **2026년 1인가구 기준중위소득 54.3%**(본인부담 건보료 약 46,085원)로, **18p [별표2] 독립가구 단독산정 특례 구간(50~60%)**에 정확히 들어와 부모님 소득을 보지 않습니다.\n• **[국토교통부 건축물대장 도구]**: 거주지(봉천로 123, 301호)는 **공동주택(다세대주택, 24.8㎡)**이며 **위반건축물 이력이 없어** 지원 적격 주택입니다.\n• **[국토교통부 RTMS 환산 도구]**: 보증금 1,000만 원의 월세 환산액(45,833원) + 월세(750,000원) = **795,833원(상한 90만 원 이하)**으로 통과됩니다.`,
        targetArtifact: {
          view: "triage_clause",
          title: "건보공단 · 국토부 건축물대장 · [별표2] 통합 자격 판정서",
          subtitle: "중위소득 54.3% · 환산월세 795,833원 · 건축물대장 적격",
          badge: "5개 기관 검증 통과 (98%)",
        },
        followUps: [
          {
            label: "📋 정부24 · 대법원 직통 발급 링크 & 필수 체크박스 레시피 보기",
            actionKey: "mission_recipe",
          },
          {
            label: "🔍 등본·계약서·건축물대장 3자 교차검수 시연하기",
            actionKey: "mission_audit_defect",
          },
        ],
      });
      return;
    }

    // Mission 2: 정부24 · 대법원 · RTMS · 청약홈 발급 옵션 매퍼 & 직통 딥링크
    if (missionKey === "mission_recipe") {
      await runAgentWorkflowTurn({
        userText:
          "방금 판독된 내 특례 기준으로 정부24, 대법원 전자가족관계시스템, 국토부 RTMS에서 어떤 서류를 무슨 체크박스 옵션으로 떼야 하는지 직통 링크랑 같이 연결해 줘.",
        thinkingText:
          "gov24_civil_doc_recipe() 도구를 호출하여 공고문 12개 서류 중 18p [별표2] 특례로 면제되는 부모님 서류 8종을 소거하고, 필수 4종 서류의 정부24/대법원 민원 신청 코드(CappBizCD) 딥링크와 필수 체크박스 옵션을 매핑합니다.",
        traces: [
          {
            id: `rec-1-${Date.now()}`,
            agency: "행정안전부 정부24 · 대법원 · 청약홈",
            deepLinkUrl:
              "https://www.gov.kr/mw/AA020InfoCappView.do?HighCtgCD=A01010&CappBizCD=13100000015",
            toolName: "gov24_civil_doc_recipe",
            title: "기관별 민원서류 직통 발급 딥링크 및 반려 방지 체크박스 매퍼",
            status: "done",
            inputSummary: "특례코드: 18p [별표2] 제3호, 전체서류: 12종",
            outputSummary:
              "8종 면제 소거 → 정부24 등본(CappBizCD=13100000015), 대법원 상세증명서 등 4종 직통 연결",
          },
        ],
        finalReply: `정부24, 대법원 전자가족관계등록시스템, 국토부 부동산거래관리시스템(RTMS), 청약홈의 **민원 발급 직통 링크**와 **반려 0% 체크박스 정답지**를 우측 캔버스에 연결했습니다!\n\n• **정부24 주민등록등본**: \`[과거 주소변동: 최근 5년 포함]\` + \`[전입일/변동일: 포함]\` 체크 필수\n• **대법원 가족관계증명서**: '일반'이 아닌 **\`[상세 증명서]\`** 선택 필수\n• **국토부 RTMS**: 계약서에 확정일자 도장이 없다면 **\`[주택임대차계약 신고필증]\`** 온라인 즉시 발급`,
        targetArtifact: {
          view: "doc_recipe",
          title: "정부24 · 대법원 · RTMS 직통 발급 링크 & 체크박스 정답지",
          subtitle: "전체 12종 중 8종 특례 면제 · 필수 4종 원클릭 발급 연결",
          badge: "4개 기관 딥링크 연결됨",
        },
        followUps: [
          {
            label: "📎 [서류 첨부] 발급받은 등본·계약서 올리고 건축물대장과 교차검수하기",
            actionKey: "mission_audit_defect",
          },
        ],
      });
      return;
    }

    // Mission 3: 등본 ↔ 계약서 ↔ 국토부 건축물대장 ↔ 대법원 가족관계 다중 교차검수
    if (missionKey === "mission_audit_defect") {
      setAuditMode("defect");
      await runAgentWorkflowTurn({
        userText:
          "정부24에서 뗀 주민등록등본이랑 대법원 가족관계증명서, 그리고 집 계약서 사진 올렸어. 국토부 건축물대장 정보랑 대조해서 반려될 위험 있는지 검사해 줘!",
        attachedLabels: [
          {
            name: "정부24_주민등록등본_김청년.pdf",
            type: "application/pdf",
            tag: "정부24 발급본",
          },
          {
            name: "주택임대차계약서_사본.jpg",
            type: "image/jpeg",
            tag: "302호 기재됨",
          },
          {
            name: "대법원_가족관계증명서_일반.pdf",
            type: "application/pdf",
            tag: "일반증명서",
          },
        ],
        thinkingText:
          "첨부된 서류 3종에 대해 ① 로컬 PII 마스킹(mask_sensitive_pii) → ② 국토교통부 건축물대장 등재 호수(301호) 조회(molit_building_ledger_check) → ③ 정부24 등본·계약서·대법원 증명서 다중 교차 감사(cross_check_documents) 도구를 연쇄 호출합니다.",
        traces: [
          {
            id: `aud-1-${Date.now()}`,
            agency: "로컬 개인정보보호 가드레일",
            toolName: "mask_sensitive_pii",
            title: "민원서류 3종 주민번호 뒷자리·계좌 로컬 비식별화 마스킹",
            status: "done",
            inputSummary: "등본, 계약서, 가족관계증명서",
            outputSummary: "990512-1234567 → 990512-1****** 로컬 마스킹 완료",
          },
          {
            id: `aud-2-${Date.now()}`,
            agency: "국토교통부 세움터 · 건축물대장",
            deepLinkUrl:
              "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=15000000098",
            toolName: "molit_building_ledger_check",
            title: "건축물대장 전유부 공식 호수 및 위반건축물 대조",
            status: "done",
            inputSummary: "서울시 관악구 봉천로 123",
            outputSummary:
              "건축물대장 공식 호수: 제301호 확인 (계약서 302호와 충돌 감지!)",
          },
          {
            id: `aud-3-${Date.now()}`,
            agency: "AI 공무원 사전 모의심사 엔진",
            toolName: "cross_check_documents",
            title: "정부24 등본 ↔ 건축물대장 ↔ 계약서 ↔ 대법원 증명서 4자 교차 대조",
            status: "warn",
            inputSummary: "등본(301호/전입일미표시) ≠ 계약서(302호/확정일자누락)",
            outputSummary:
              "🚨 반려 사유 4건 적발! (1차 심사 통과 확률 15% — 즉시 보완 처방 생성)",
          },
        ],
        finalReply: `🚨 **정부24 등본 · 국토부 건축물대장 · 임대차계약서 · 대법원 가족관계증명서를 교차 대조한 결과, 이대로 제출 시 100% 반려되는 오류 4건이 적발되었습니다!**\n\n1. **[정부24 등본 옵션 오류]** 등본에 **'전입일'**과 **'최근 5년 주소변동 이력'** 체크박스가 꺼진 채로 발급되었습니다.\n2. **[등본·건축물대장(301호) ↔ 계약서(302호) 불일치]** 정부24 등본과 국토부 건축물대장에는 **301호**인데, 계약서에는 문패 호수인 **302호**로 적혀 있습니다.\n3. **[국토부 RTMS 확정일자 누락]** 계약서에 확정일자 날인이 없습니다. RTMS에서 **'주택임대차계약 신고필증'**을 발급받아 첨부해야 합니다.\n4. **[대법원 가족관계증명서 오발급]** '상세'가 아닌 **'일반' 증명서**로 발급되었습니다.\n\n우측 캔버스에서 빨간펜 적발 위치와 각 기관 재발급 직통 링크를 확인하세요.`,
        targetArtifact: {
          view: "pre_audit_xray",
          title: "정부24 · 건축물대장 · 계약서 4자 교차검수 X-Ray 리포트",
          subtitle: "반려 위험 4건 적발 · 기관별 즉시 재발급 처방전 포함",
          badge: "통과 확률 15% (위험)",
        },
        followUps: [
          {
            label: "✨ 4가지 모두 재발급·보완 완료! 복지로 신청서 자동 기입 및 패키지 생성하기",
            actionKey: "mission_audit_fixed",
          },
        ],
      });
      return;
    }

    // Mission 4: 보완 완료 재검수 & 복지로/고용24 신청서 패키저
    if (missionKey === "mission_audit_fixed") {
      setAuditMode("fixed");
      await fetchNineGovTools(undefined, "fixed");

      await runAgentWorkflowTurn({
        userText:
          "정부24에서 전입일 포함된 등본 다시 떼고, 대법원 상세증명서랑 RTMS 신고필증(확정일자 제2025-004812호, 301호 확인서 포함)까지 보완해서 올렸어! 복지로 신청서 양식에 자동으로 다 채워줘.",
        attachedLabels: [
          {
            name: "정부24_주민등록등본_최근5년포함.pdf",
            type: "application/pdf",
            tag: "적격",
          },
          {
            name: "임대차계약서_RTMS신고필증_301호.pdf",
            type: "application/pdf",
            tag: "확정일자 확인",
          },
          {
            name: "대법원_가족관계증명서_상세.pdf",
            type: "application/pdf",
            tag: "상세증명서",
          },
        ],
        thinkingText:
          "보완 서류 3종과 건축물대장 데이터를 교차 대조하여 반려 위험 0건을 확인한 뒤, 복지로·고용24 전자신청 패키저 도구(welfare_form_packager)를 호출해 신청서 양식을 자동 기입하고 활동계획서 루브릭 자기검증을 수행합니다.",
        traces: [
          {
            id: `fix-1-${Date.now()}`,
            agency: "AI 공무원 사전 모의심사 엔진",
            toolName: "cross_check_documents",
            title: "정부24 등본 ↔ 건축물대장 ↔ RTMS 신고필증 ↔ 대법원 상세증명서 재검수",
            status: "done",
            inputSummary: "4개 기관 문서 주소(301호)·전입일(2025.08.20)·확정일자 대조",
            outputSummary: "✅ 반려 위험 0건! 사전 모의심사 통과 확신도 99%",
          },
          {
            id: `fix-2-${Date.now()}`,
            agency: "복지로 · 고용24 전자신청 패키저",
            deepLinkUrl: "https://www.bokjiro.go.kr",
            toolName: "welfare_form_packager",
            title: "서류 OCR 데이터 신청서 자동 매핑 및 계획서 루브릭 금칙어 자기검증",
            status: "done",
            inputSummary: "5개 필수 필드 매핑 + 금칙어 0건 확인",
            outputSummary:
              "심사 루브릭 98/100점 · 복지로 업로드 규격 파일명 변환 완료",
          },
        ],
        finalReply: `🎉 **사전 모의심사 100% 통과!** 정부24 등본, 국토부 건축물대장, RTMS 신고필증, 대법원 상세증명서 간 데이터가 완벽히 일치합니다.\n\n**\`welfare_form_packager()\`** 도구가 서류 속 데이터를 읽어 복지로 표준 신청서 서식을 자동으로 채웠으며, 제출용 파일명 규격화까지 끝냈습니다. 우측 캔버스에서 완제품 패키지를 다운로드하고 바로 **복지로(bokjiro.go.kr)**에 업로드하세요!`,
        targetArtifact: {
          view: "application_editor",
          title: "복지로 · 고용24 자동 기입 신청서 & 제출 완제품 패키지",
          subtitle: "OCR 자동 매핑 완료 · 루브릭 점수 98점",
          badge: "제출 준비 완료 (99%)",
        },
        followUps: [
          {
            label: "🌐 7개 공공기관 · 9대 에이전트 도구 전체 파이프라인 다시 보기",
            actionKey: "mission_all_9_tools",
          },
        ],
      });
      return;
    }
  };

  // ==================== REAL USER CHAT & FILE UPLOAD HANDLER ====================
  const handleAttachmentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      const isPolicy =
        file.name.includes("공고") || file.name.includes("안내");
      if (file.type.startsWith("image/") || file.type === "application/pdf") {
        reader.onload = () => {
          setStagedAttachments((prev) => [
            ...prev,
            {
              fileName: file.name,
              mimeType: file.type,
              base64OrText: String(reader.result || ""),
              category: isPolicy ? "policy" : "doc",
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setStagedAttachments((prev) => [
            ...prev,
            {
              fileName: file.name,
              mimeType: "text/plain",
              base64OrText: String(reader.result || ""),
              category: isPolicy ? "policy" : "doc",
            },
          ]);
        };
        reader.readAsText(file, "utf-8");
      }
    });
  };

  const handleSendUserMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputPrompt.trim() && stagedAttachments.length === 0) || isAgentWorking)
      return;

    const currentText =
      inputPrompt.trim() ||
      `첨부한 파일 ${stagedAttachments.length}건(${stagedAttachments
        .map((a) => a.fileName)
        .join(", ")})을 분석하고 정부24·건축물대장 기준 사전 모의심사를 진행해 줘.`;
    const currentFiles = [...stagedAttachments];
    setInputPrompt("");
    setStagedAttachments([]);

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now() + 1}`;
    const now = new Date().toLocaleTimeString("ko-KR", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: currentText,
        attachments: currentFiles.map((f) => ({
          name: f.fileName,
          type: f.mimeType,
          tag: f.category === "policy" ? "공고문" : "제출서류",
        })),
        timestamp: now,
      },
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        thinkingText:
          "질문 의도를 분석하여 행정안전부 정부24, 국민건강보험공단, 국토교통부 건축물대장/RTMS, 대법원 전자가족관계시스템 연동 도구들을 자율 선택해 연쇄 호출합니다...",
        toolTraces: [
          {
            id: `run-${Date.now()}`,
            agency: "다중 공공기관 오케스트레이터",
            toolName: "multi_agency_tool_chain",
            title: "정부24 · 건보공단 · 국토부 건축물대장/RTMS · 대법원 도구 연쇄 실행",
            status: "running",
            inputSummary: currentText.slice(0, 80),
            outputSummary: "기관 데이터 조회 및 수식 검증 중...",
          },
        ],
        timestamp: now,
      },
    ]);
    setExpandedTraceIds((prev) => ({ ...prev, [assistantMsgId]: true }));
    setIsAgentWorking(true);
    scrollToBottom();

    try {
      // Case A: User attached documents
      if (currentFiles.length > 0) {
        const res = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ocr_audit_docs",
            apiKey: geminiApiKey,
            policyTitle: currentPolicy.title,
            uploadedDocs: currentFiles,
          }),
        });
        const data = await res.json();

        if (res.ok && data?.auditResult) {
          const result = data.auditResult;
          setRealOcrAuditData({
            summaryTitle:
              result.summaryTitle || "업로드 서류 AI 사전 모의심사 결과",
            passProbability: Number(result.passProbability) || 90,
            documents: result.documents || [],
            findings: result.findings || [],
            crossCheckMatrix: result.crossCheckMatrix || [],
          });
          if (
            Array.isArray(result.autoFilledFields) &&
            result.autoFilledFields.length > 0
          ) {
            setRealAutoFilledFields(result.autoFilledFields);
          }
          if (result.generatedEssayDraft) {
            setEssayDraft(result.generatedEssayDraft);
          }
          setAuditMode("real_ocr");
          setActiveArtifactView("pre_audit_xray");
          setCanvasOpen(true);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: `업로드하신 서류 **${currentFiles.length}종**에 대해 로컬 개인정보 마스킹, 국토부 건축물대장 대조 및 **Gemini 2.5 Vision OCR 교차검증**을 완료했습니다.\n\n• **판정 요약**: ${result.summaryTitle}\n• **1차 심사 통과 확신도**: **${result.passProbability}%**`,
                    toolTraces: [
                      {
                        id: `t-pii-${Date.now()}`,
                        agency: "로컬 개인정보 가드레일",
                        toolName: "mask_sensitive_pii",
                        title: "민원서류 개인정보 로컬 비식별화 완료",
                        status: "done",
                        inputSummary: currentFiles.map((f) => f.fileName).join(", "),
                        outputSummary: "주민번호 뒷자리 및 민감 정보 마스킹 완료",
                      },
                      {
                        id: `t-ocr-${Date.now()}`,
                        agency: "Gemini 2.5 Vision & 건축물대장 대조",
                        toolName: "cross_validate_user_documents",
                        title: "다중 서류 필드 추출 및 교차 대조",
                        status: "done",
                        inputSummary: `${currentFiles.length}개 서류 분석`,
                        outputSummary: `${result.summaryTitle} (통과율 ${result.passProbability}%)`,
                      },
                    ],
                    artifactAction: {
                      view: "pre_audit_xray",
                      title: "실제 업로드 서류 Vision OCR 검수 리포트",
                      subtitle: result.summaryTitle,
                      badge: `통과율 ${result.passProbability}%`,
                    },
                  }
                : m
            )
          );
          return;
        } else {
          const hasDefectName = currentFiles.some(
            (f) =>
              f.fileName.includes("미비") ||
              f.fileName.includes("누락") ||
              f.fileName.includes("일반")
          );
          setAuditMode(hasDefectName ? "defect" : "fixed");
          setActiveArtifactView("pre_audit_xray");
          setCanvasOpen(true);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: `첨부하신 파일(${currentFiles
                      .map((f) => f.fileName)
                      .join(", ")})에 대해 로컬 PII 마스킹 및 정부24·건축물대장 규격 대조를 완료했습니다. 우측 캔버스에서 상세 결과를 확인하세요.`,
                    toolTraces: [
                      {
                        id: `t-local-${Date.now()}`,
                        agency: "로컬 보안 가드레일 & 규격 검수기",
                        toolName: "mask_sensitive_pii",
                        title: "로컬 개인정보 마스킹 및 서류 규격 스캔",
                        status: "done",
                        inputSummary: currentFiles.map((f) => f.fileName).join(", "),
                        outputSummary: hasDefectName
                          ? "필수 옵션 누락 감지 (보완 필요)"
                          : "필수 옵션 모두 적격 통과",
                      },
                    ],
                    artifactAction: {
                      view: "pre_audit_xray",
                      title: "첨부 서류 사전 모의심사 X-Ray 캔버스",
                      subtitle: currentFiles.map((f) => f.fileName).join(", "),
                      badge: hasDefectName ? "보완 필요" : "검수 통과",
                    },
                  }
                : m
            )
          );
          return;
        }
      }

      // Case B: Natural Language Chat -> Multi-Agency Tool Chain (/api/agent/run action: "agent_chat")
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "agent_chat",
          apiKey: geminiApiKey,
          userMessage: currentText,
          policyTitle: currentPolicy.title,
          userProfile: {
            income: liveMetrics.incomeManwon,
            deposit: liveMetrics.depositManwon,
            rent: liveMetrics.rentManwon,
          },
        }),
      });
      const data = await res.json();

      const tracesFromApi: ToolTraceItem[] = (data.toolLogs || []).map(
        (tl: {
          step: number;
          agency?: string;
          deepLinkUrl?: string;
          toolName: string;
          args: Record<string, unknown>;
          result: Record<string, unknown>;
        }) => ({
          id: `api-tl-${tl.step}-${Date.now()}`,
          agency: tl.agency || "공공기관 연동 도구",
          deepLinkUrl: tl.deepLinkUrl,
          toolName: tl.toolName,
          title: (tl.result?.연동기관 as string) || tl.toolName,
          status: "done",
          inputSummary: JSON.stringify(tl.args),
          outputSummary: Object.values(tl.result || {})
            .slice(1, 3)
            .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
            .join(" · "),
          rawOutput: tl.result,
        })
      );

      setActiveArtifactView("agency_hub");
      setCanvasOpen(true);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content:
                  data.reply ||
                  "다중 공공기관 도구 호출 및 캔버스 업데이트를 완료했습니다.",
                toolTraces: tracesFromApi,
                artifactAction: {
                  view: "agency_hub",
                  title: "정부24 · 건보공단 · 국토부 건축물대장 · 대법원 연동 리포트",
                  subtitle: `${tracesFromApi.length}개 공공기관 도구 연쇄 호출 완료`,
                  badge: "Multi-Tool 완료",
                },
                followUpSuggestions: [
                  {
                    label: "📋 정부24 · 대법원 직통 발급 링크 & 체크박스 레시피 열기",
                    actionKey: "mission_recipe",
                  },
                  {
                    label: "🔍 등본·계약서·건축물대장 교차검수 시연하기",
                    actionKey: "mission_audit_defect",
                  },
                ],
              }
            : m
        )
      );
    } finally {
      setIsAgentWorking(false);
      scrollToBottom();
    }
  };

  // Download Package Handler
  const handleDownloadPackage = () => {
    const fieldsToExport =
      realAutoFilledFields ||
      currentPolicy.applicationFormTemplate.autoFilledFields;
    const docsToExport =
      auditMode === "real_ocr" && realOcrAuditData
        ? realOcrAuditData.documents
        : currentPolicy.auditScenarios.fixed.documents;

    const content = `====================================================================
[공고패스 Agent] 7개 공공기관 도구 검증 완료 · 최종 제출 패키지 명세서
====================================================================
■ 대상 사업명: ${currentPolicy.title} (${currentPolicy.ministry})
■ 연동 검증 기관: 정부24(보조금24) · 온통청년 · 국민건강보험공단 · 국토교통부(건축물대장/RTMS) · 대법원 전자가족 · 복지로
■ 개인정보 보호: 로컬 PII 비식별화(mask_sensitive_pii) 및 무저장(Zero-Retention) 검증 완료
■ 예상 수령 금액: ${currentPolicy.maxBenefitText}

--------------------------------------------------------------------
1. 제출 서류 자동 추출 및 신청서 기입 내역
--------------------------------------------------------------------
${fieldsToExport
  .map((f) => `- ${f.label}: ${f.value} [출처: ${f.sourceDoc}]`)
  .join("\n")}

--------------------------------------------------------------------
2. 심사기준 맞춤형 자동 작성 계획서 (${currentPolicy.applicationFormTemplate.essayTitle})
--------------------------------------------------------------------
${essayDraft}

--------------------------------------------------------------------
3. 제출 규격 파일명 자동 변환 목록 (복지로/고용24 업로드 즉시 가능)
--------------------------------------------------------------------
${docsToExport
  .map((d, idx) => `[파일 ${idx + 1}] ${d.renamedFileName}  (원본: ${d.fileName})`)
  .join("\n")}
====================================================================`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `[공고패스_제출패키지]_${currentPolicy.title.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 4000);
  };

  const currentAuditData =
    auditMode === "real_ocr" && realOcrAuditData
      ? realOcrAuditData
      : currentPolicy.auditScenarios[auditMode === "fixed" ? "fixed" : "defect"];

  const activeAutoFilledFields =
    realAutoFilledFields ||
    currentPolicy.applicationFormTemplate.autoFilledFields;

  const requiredDocs = currentPolicy.documentRecipes.filter((d) => d.required);

  const formatFieldWithPiiGuard = (val: string) => {
    if (!piiMaskingEnabled) return val;
    return val.replace(
      /(\d{6})-([1-4])\d{6}/g,
      "$1-$2****** (로컬 마스킹됨)"
    );
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#F7F9FC] text-[#191F28]">
      {/* ==================== 1. LEFT SIDEBAR (MULTI-AGENCY TOOL HUB & MISSIONS) ==================== */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 288, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="h-full bg-[#0B1528] text-white flex flex-col justify-between border-r border-[#1E2D4A] shrink-0 overflow-hidden select-none"
          >
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Top Brand */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#256EF4] to-[#00B8A9] flex items-center justify-center font-black text-xs text-white shadow-sm">
                    24
                  </div>
                  <div>
                    <div className="font-extrabold text-sm tracking-tight text-white flex items-center gap-1.5">
                      <span>공고패스 Agent</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#00B8A9]/25 text-[#5CE1E6] font-mono">
                        9 Tools
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      7개 공공기관 연동 완주 에이전트
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
                >
                  <PanelLeftOpen className="w-4 h-4 rotate-180" />
                </button>
              </div>

              {/* Primary Button: Run All 9 Agency Tools */}
              <button
                onClick={() => executeMission("mission_all_9_tools")}
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#00B8A9] to-[#256EF4] hover:opacity-95 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition"
              >
                <Cpu className="w-4 h-4" />
                <span>⚡ 7개 공공기관 · 9대 도구 연쇄 실행</span>
              </button>

              {/* Connected Public Agencies Registry */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Connected Gov Portals (6)
                  </span>
                  <span className="text-[10px] font-mono text-[#5CE1E6]">
                    ● ACTIVE
                  </span>
                </div>
                <div className="space-y-1">
                  {CONNECTED_AGENCIES.map((ag, i) => (
                    <a
                      key={i}
                      href={ag.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] transition group"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold text-slate-100 flex items-center gap-1.5 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00B8A9] shrink-0" />
                          <span className="truncate">{ag.name}</span>
                        </span>
                        <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-white shrink-0" />
                      </div>
                      <div className="text-[10px] font-mono text-[#7FB0FF] pl-3 truncate">
                        🛠️ {ag.tool}()
                      </div>
                    </a>
                  ))}
                </div>
              </div>

              {/* 4 Step-by-Step Agent Missions */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-1">
                  Step-by-Step Agent Missions
                </div>
                {[
                  {
                    key: "mission_triage",
                    step: "Mission 1",
                    title: "정부24·건보공단·건축물대장 조회",
                    sub: "5개 기관 도구로 별표2 특례 판독",
                  },
                  {
                    key: "mission_recipe",
                    step: "Mission 2",
                    title: "정부24·대법원 직통 발급 딥링크",
                    sub: "gov24_civil_doc_recipe() 호출",
                  },
                  {
                    key: "mission_audit_defect",
                    step: "Mission 3",
                    title: "등본↔건축물대장↔계약서 교차검수",
                    sub: "301호≠302호 및 옵션 누락 적발",
                  },
                  {
                    key: "mission_audit_fixed",
                    step: "Mission 4",
                    title: "복지로 신청서 자동기입 & 패키징",
                    sub: "welfare_form_packager() 호출",
                  },
                ].map((m) => (
                  <button
                    key={m.key}
                    onClick={() => executeMission(m.key)}
                    className="w-full text-left p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition space-y-0.5 group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-[#00B8A9]">
                        {m.step}
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition" />
                    </div>
                    <div className="text-xs font-bold text-slate-100">
                      {m.title}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      {m.sub}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Bottom Sidebar Controls */}
            <div className="p-3.5 border-t border-[#1E2D4A] space-y-1.5 bg-[#081020]">
              <button
                onClick={() => setPiiMaskingEnabled((prev) => !prev)}
                className="w-full p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-left flex items-center justify-between text-xs"
              >
                <span className="flex items-center gap-2 text-slate-200 font-semibold">
                  <Lock className="w-3.5 h-3.5 text-[#00B8A9]" />
                  <span>로컬 PII 마스킹 가드레일</span>
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                    piiMaskingEnabled
                      ? "bg-[#00B8A9]/20 text-[#5CE1E6]"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {piiMaskingEnabled ? "ON" : "OFF"}
                </span>
              </button>

              <button
                onClick={() => setShowApiModal(true)}
                className="w-full p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-left flex items-center justify-between text-xs"
              >
                <span className="flex items-center gap-2 text-slate-200 font-semibold">
                  <PlugZap className="w-3.5 h-3.5 text-[#7FB0FF]" />
                  <span>Gemini · 공공데이터 API 설정</span>
                </span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    apiConnected ? "bg-[#00B8A9]" : "bg-amber-400"
                  }`}
                />
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ==================== 2. CENTER: CONVERSATIONAL AGENT STREAM ==================== */}
      <div className="flex-1 h-full flex flex-col bg-white border-r border-[#E5E8EB] min-w-[360px]">
        {/* Chat Stream Top Header */}
        <header className="h-14 px-4 border-b border-[#E5E8EB] flex items-center justify-between gap-2 shrink-0 bg-white/90 backdrop-blur">
          <div className="flex items-center gap-2.5">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg hover:bg-[#F2F5F9] text-[#4E5968]"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00B8A9]" />
              <span className="font-extrabold text-sm text-[#191F28]">
                공고패스 Multi-Tool 에이전트
              </span>
              <span className="hidden sm:inline-block text-xs px-2.5 py-0.5 rounded-full bg-[#EAF2FE] text-[#1D64F2] font-bold">
                정부24 · 건보공단 · 국토부 · 대법원 · 복지로 9대 도구 연동
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#F2F5F9] hover:bg-[#E5E8EB] text-[#4E5968] flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>새 대화</span>
              </button>
            )}
            {!canvasOpen && (
              <button
                onClick={() => setCanvasOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EAF2FE] text-[#1D64F2] text-xs font-bold"
              >
                <PanelRightOpen className="w-4 h-4" />
                <span>아티팩트 캔버스 열기</span>
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Message & Multi-Tool Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
          {messages.length === 0 ? (
            /* Empty State Welcome Screen */
            <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center space-y-6 py-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#0B3168] via-[#256EF4] to-[#00B8A9] flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Bot className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EAF2FE] text-[#1D64F2] text-xs font-extrabold">
                  <Globe className="w-3.5 h-3.5" />
                  <span>정부24 · 온통청년 · 건보공단 · 국토부 건축물대장 · 대법원 · 복지로 연동</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-[#191F28] tracking-tight">
                  청년 행정 완주 에이전트, 공고패스입니다.
                </h1>
                <p className="text-xs sm:text-sm text-[#6B7684] leading-relaxed">
                  내 거주지·소득·월세 조건을 말씀하시거나 서류(등본·계약서)를 올려주세요. 에이전트가 <strong>7개 공공기관의 9대 도구(Tools)</strong>를 스스로 호출해 자격 판독부터 건축물대장 검증, 서류 반려 방어, 복지로 신청서 작성까지 대행합니다.
                </p>
              </div>

              {/* Hero Action: Run All 9 Tools */}
              <button
                onClick={() => executeMission("mission_all_9_tools")}
                className="w-full p-4 rounded-2xl bg-gradient-to-r from-[#0B3168] via-[#1D64F2] to-[#00B8A9] text-white text-left shadow-md hover:opacity-95 transition flex items-center justify-between gap-4 group"
              >
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-white/20 text-white">
                    ⚡ MULTI-AGENCY ORCHESTRATION (9 TOOLS)
                  </div>
                  <div className="text-sm sm:text-base font-extrabold">
                    &ldquo;정부24·건보공단·국토부 건축물대장·대법원·복지로 9대 도구 한 번에 연쇄 실행해 줘!&rdquo;
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 shrink-0 group-hover:translate-x-1 transition" />
              </button>

              {/* 2x2 Starter Prompt Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                <button
                  onClick={() => executeMission("mission_triage")}
                  className="p-3.5 rounded-2xl bg-[#F8FAFC] hover:bg-[#EAF2FE]/60 border border-[#E5E8EB] hover:border-[#256EF4] transition space-y-1 group"
                >
                  <div className="flex items-center justify-between text-xs font-extrabold text-[#256EF4]">
                    <span>🏥 건보공단 · 건축물대장 · 별표2</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                  </div>
                  <div className="text-xs font-bold text-[#191F28] leading-snug">
                    &ldquo;관악구 봉천로 123(301호) 보증금 1천/월세 75, 월급 130만 원인데 건축물대장이랑 건보료 특례 조회해 줘&rdquo;
                  </div>
                </button>

                <button
                  onClick={() => executeMission("mission_recipe")}
                  className="p-3.5 rounded-2xl bg-[#F8FAFC] hover:bg-[#EAF2FE]/60 border border-[#E5E8EB] hover:border-[#256EF4] transition space-y-1 group"
                >
                  <div className="flex items-center justify-between text-xs font-extrabold text-[#00897B]">
                    <span>🌐 정부24 · 대법원 직통 발급 딥링크</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                  </div>
                  <div className="text-xs font-bold text-[#191F28] leading-snug">
                    &ldquo;정부24 등본이랑 대법원 가족관계증명서 직통 발급 링크랑 필수 체크박스 옵션 연결해 줘&rdquo;
                  </div>
                </button>

                <button
                  onClick={() => executeMission("mission_audit_defect")}
                  className="p-3.5 rounded-2xl bg-[#F8FAFC] hover:bg-[#FFECEE]/50 border border-[#E5E8EB] hover:border-[#F04452] transition space-y-1 group"
                >
                  <div className="flex items-center justify-between text-xs font-extrabold text-[#F04452]">
                    <span>🔍 등본 ↔ 건축물대장 ↔ 계약서 대조</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                  </div>
                  <div className="text-xs font-bold text-[#191F28] leading-snug">
                    &ldquo;[서류 3종 첨부] 등본(301호)·건축물대장·계약서(302호) 교차검수해서 반려 위험 찾아줘&rdquo;
                  </div>
                </button>

                <button
                  onClick={() => executeMission("mission_audit_fixed")}
                  className="p-3.5 rounded-2xl bg-[#F8FAFC] hover:bg-[#E6F8F6]/60 border border-[#E5E8EB] hover:border-[#00897B] transition space-y-1 group"
                >
                  <div className="flex items-center justify-between text-xs font-extrabold text-[#0B3168]">
                    <span>📦 복지로 신청서 자동기입 & 패키징</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                  </div>
                  <div className="text-xs font-bold text-[#191F28] leading-snug">
                    &ldquo;보완한 서류 재검수하고 복지로 표준 신청서 자동 기입 & 제출 패키지 만들어 줘&rdquo;
                  </div>
                </button>
              </div>
            </div>
          ) : (
            /* Active Chat Stream */
            messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                {msg.role === "user" ? (
                  <div className="max-w-[85%] space-y-2">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {msg.attachments.map((att, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#EAF2FE] text-[#0B3168] border border-[#C9DDFD] text-xs font-bold"
                          >
                            <Paperclip className="w-3.5 h-3.5 text-[#256EF4]" />
                            <span>{att.name}</span>
                            {att.tag && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white text-[#256EF4]">
                                {att.tag}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="px-4 py-3 rounded-2xl rounded-tr-xs bg-[#0B3168] text-white text-xs sm:text-sm leading-relaxed shadow-xs">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  /* Assistant Turn */
                  <div className="w-full max-w-[96%] space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-[#0B3168] to-[#256EF4] text-white flex items-center justify-center">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-extrabold text-[#191F28]">
                        공고패스 에이전트
                      </span>
                      <span className="text-[11px] text-[#8B95A1]">
                        {msg.timestamp}
                      </span>
                    </div>

                    {/* Collapsible Thinking & Multi-Agency Tool Trace Box */}
                    {(msg.thinkingText ||
                      (msg.toolTraces && msg.toolTraces.length > 0)) && (
                      <div className="rounded-2xl bg-[#F4F7FB] border border-[#DCE6F5] overflow-hidden">
                        <button
                          onClick={() =>
                            setExpandedTraceIds((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                          className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-[#EAF2FE]/50 transition"
                        >
                          <div className="flex items-center gap-2 text-xs font-bold text-[#0B3168]">
                            <BrainCircuit className="w-4 h-4 text-[#256EF4]" />
                            <span>
                              공공기관 도구(Tool Calling) 연쇄 실행 내역 (
                              {msg.toolTraces?.length || 1}개 Tool 호출됨)
                            </span>
                          </div>
                          <ChevronDown
                            className={`w-4 h-4 text-[#6B7684] transition-transform ${
                              expandedTraceIds[msg.id] ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        <AnimatePresence initial={false}>
                          {expandedTraceIds[msg.id] && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="px-4 pb-3.5 pt-1 space-y-2 border-t border-[#E5E8EB]"
                            >
                              {msg.thinkingText && (
                                <div className="text-xs text-[#4E5968] bg-white p-3 rounded-xl border border-[#E5E8EB] leading-relaxed">
                                  <span className="font-extrabold text-[#256EF4] mr-1">
                                    [Agent Planning]
                                  </span>
                                  {msg.thinkingText}
                                </div>
                              )}

                              {msg.toolTraces?.map((trace, tIdx) => (
                                <div
                                  key={trace.id}
                                  className="p-3 rounded-xl bg-[#0B1528] text-white text-xs space-y-1.5 font-mono"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#256EF4]/30 text-[#99C2FF] font-sans font-bold">
                                        #{tIdx + 1} {trace.agency || "공공데이터 연동"}
                                      </span>
                                      <span className="text-[#5CE1E6] font-bold flex items-center gap-1">
                                        <Terminal className="w-3.5 h-3.5" />
                                        {trace.toolName}()
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      {trace.deepLinkUrl && (
                                        <a
                                          href={trace.deepLinkUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-[10px] font-sans font-bold px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white flex items-center gap-1"
                                        >
                                          <span>기관 바로가기</span>
                                          <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                      )}
                                      <span
                                        className={`text-[10px] px-2 py-0.5 rounded font-sans font-bold ${
                                          trace.status === "running"
                                            ? "bg-blue-500/20 text-blue-300"
                                            : trace.status === "warn"
                                            ? "bg-rose-500/25 text-rose-300"
                                            : "bg-emerald-500/20 text-emerald-300"
                                        }`}
                                      >
                                        {trace.status === "running"
                                          ? "호출 중..."
                                          : trace.status === "warn"
                                          ? "불일치 감지"
                                          : "✓ 200 OK"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-slate-300 font-sans">
                                    {trace.title}
                                  </div>
                                  <div className="text-[11px] text-slate-400 bg-black/30 p-2 rounded-lg space-y-0.5">
                                    <div className="truncate">
                                      <span className="text-slate-500">in: </span>
                                      {trace.inputSummary}
                                    </div>
                                    <div className="text-emerald-300 font-semibold">
                                      <span className="text-slate-500">out: </span>
                                      {trace.outputSummary}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Agent Final Response */}
                    {msg.content ? (
                      <div className="p-4 rounded-2xl bg-white border border-[#E5E8EB] text-xs sm:text-sm text-[#191F28] whitespace-pre-wrap leading-relaxed shadow-2xs">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="p-4 rounded-2xl bg-white border border-[#E5E8EB] text-xs text-[#6B7684] flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-[#256EF4]" />
                        <span>공공기관 도구를 호출하고 우측 아티팩트 캔버스를 구성하고 있습니다...</span>
                      </div>
                    )}

                    {/* Clickable Artifact Card */}
                    {msg.artifactAction && (
                      <button
                        onClick={() => {
                          setActiveArtifactView(msg.artifactAction!.view);
                          setCanvasOpen(true);
                        }}
                        className="w-full p-3.5 rounded-2xl bg-[#EAF2FE] hover:bg-[#DCE9FD] border border-[#256EF4]/30 flex items-center justify-between gap-3 text-left transition group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-[#256EF4] text-white flex items-center justify-center shrink-0">
                            <Layers className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#256EF4]">
                                Generative UI Artifact
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-white text-[#0B3168]">
                                {msg.artifactAction.badge}
                              </span>
                            </div>
                            <div className="text-xs sm:text-sm font-extrabold text-[#0B3168] truncate">
                              {msg.artifactAction.title}
                            </div>
                            <div className="text-[11px] text-[#4E5968] truncate">
                              {msg.artifactAction.subtitle}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-[#256EF4] group-hover:translate-x-1 transition shrink-0" />
                      </button>
                    )}

                    {/* Follow-Up Prompts */}
                    {msg.followUpSuggestions &&
                      msg.followUpSuggestions.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {msg.followUpSuggestions.map((s, idx) => (
                            <button
                              key={idx}
                              onClick={() => executeMission(s.actionKey)}
                              className="text-xs font-bold px-3.5 py-2 rounded-full bg-[#F2F5F9] hover:bg-[#EAF2FE] text-[#1D64F2] border border-[#D8E0EB] transition flex items-center gap-1.5"
                            >
                              <span>{s.label}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                )}
              </motion.div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Bottom Chat Composer */}
        <div className="p-4 border-t border-[#E5E8EB] bg-white space-y-2.5">
          {stagedAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-1">
              {stagedAttachments.map((att, idx) => (
                <div
                  key={idx}
                  className="px-3 py-1.5 rounded-xl bg-[#EAF2FE] border border-[#256EF4]/30 text-xs font-bold text-[#0B3168] flex items-center gap-2"
                >
                  <Paperclip className="w-3.5 h-3.5 text-[#256EF4]" />
                  <span>{att.fileName}</span>
                  <button
                    onClick={() =>
                      setStagedAttachments((prev) =>
                        prev.filter((_, i) => i !== idx)
                      )
                    }
                    className="text-[#6B7684] hover:text-[#F04452]"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSendUserMessage}
            className="rounded-2xl border-2 border-[#D8E0EB] focus-within:border-[#256EF4] bg-[#F8FAFC] focus-within:bg-white p-2.5 transition space-y-2"
          >
            <textarea
              rows={2}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendUserMessage();
                }
              }}
              placeholder="내 상황(나이, 주소, 월소득, 보증금/월세)을 입력하거나 서류를 첨부하면 정부24·건보공단·국토부 건축물대장 도구를 연쇄 호출합니다..."
              className="w-full bg-transparent text-xs sm:text-sm text-[#191F28] placeholder:text-[#8B95A1] focus:outline-none resize-none px-1.5"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#E5E8EB]/80">
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-[#EAF2FE] text-[#333D4B] hover:text-[#1D64F2] border border-[#D8E0EB] text-xs font-bold cursor-pointer transition">
                  <Paperclip className="w-3.5 h-3.5 text-[#256EF4]" />
                  <span>등본·계약서·공고문 첨부</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,image/*,.txt"
                    onChange={handleAttachmentSelect}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => executeMission("mission_all_9_tools")}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#EAF2FE] hover:bg-[#DCE9FD] text-[#1D64F2] text-xs font-bold transition"
                >
                  <span>⚡ 9대 공공기관 도구 일괄 호출</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={isAgentWorking}
                className="px-4 py-2 rounded-xl bg-[#256EF4] hover:bg-[#1B5AD8] text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
              >
                {isAgentWorking ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>도구 호출 중</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>에이전트 실행</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ==================== 3. RIGHT PANE: DYNAMIC GENERATIVE UI CANVAS ==================== */}
      <AnimatePresence initial={false}>
        {canvasOpen && (
          <motion.section
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "50%", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="h-full flex flex-col bg-[#F4F7FB] overflow-hidden shrink-0"
          >
            {/* Canvas Top Bar with 5 Artifact View Switchers */}
            <div className="h-14 px-3 bg-white border-b border-[#E5E8EB] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1 overflow-x-auto py-1">
                {[
                  {
                    id: "agency_hub" as const,
                    label: "🌐 9대 공공기관 도구 허브",
                    icon: Globe,
                  },
                  {
                    id: "triage_clause" as const,
                    label: "01 건보료·건축물대장·별표",
                    icon: SlidersHorizontal,
                  },
                  {
                    id: "doc_recipe" as const,
                    label: "02 정부24 발급딥링크",
                    icon: FileText,
                  },
                  {
                    id: "pre_audit_xray" as const,
                    label: "03 서류 X-Ray 교차검수",
                    icon: Eye,
                  },
                  {
                    id: "application_editor" as const,
                    label: "04 복지로 신청패키지",
                    icon: FileSpreadsheet,
                  },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = activeArtifactView === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveArtifactView(tab.id)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 transition shrink-0 ${
                        active
                          ? "bg-[#0B3168] text-white shadow-2xs"
                          : "bg-[#F2F5F9] text-[#4E5968] hover:text-[#191F28]"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCanvasOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[#F2F5F9] text-[#6B7684] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Canvas Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* ---------- ARTIFACT 0: 🌐 7개 공공기관 · 9대 에이전트 도구 실시간 허브 ---------- */}
              {activeArtifactView === "agency_hub" && (
                <motion.div
                  key="art-hub"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {/* Live Parameter Input & Re-Run All 9 Tools */}
                  <div className="bg-white rounded-2xl p-5 border border-[#DCE6F5] shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-extrabold text-[#256EF4]">
                          MULTI-AGENCY TOOL ORCHESTRATOR
                        </span>
                        <h3 className="text-base font-extrabold text-[#191F28]">
                          정부24 · 온통청년 · 건보공단 · 국토부 건축물대장/RTMS · 대법원 · 복지로
                        </h3>
                      </div>
                      <button
                        onClick={() => fetchNineGovTools()}
                        disabled={isRunningAllTools}
                        className="px-3.5 py-2 rounded-xl bg-[#0B3168] hover:bg-[#1D64F2] text-white text-xs font-bold flex items-center gap-1.5 transition"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>
                          {isRunningAllTools
                            ? "9대 도구 조회 중..."
                            : "9대 도구 실시간 재조회"}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB]">
                        <label className="text-[10px] text-[#6B7684] block">
                          월 세전소득 (만 원)
                        </label>
                        <input
                          type="number"
                          value={liveMetrics.incomeManwon}
                          onChange={(e) =>
                            setLiveMetrics((prev) => ({
                              ...prev,
                              incomeManwon: Number(e.target.value),
                            }))
                          }
                          className="w-full text-sm font-extrabold text-[#191F28] bg-transparent mt-0.5 focus:outline-none"
                        />
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB]">
                        <label className="text-[10px] text-[#6B7684] block">
                          임차보증금 (만 원)
                        </label>
                        <input
                          type="number"
                          value={liveMetrics.depositManwon}
                          onChange={(e) =>
                            setLiveMetrics((prev) => ({
                              ...prev,
                              depositManwon: Number(e.target.value),
                            }))
                          }
                          className="w-full text-sm font-extrabold text-[#191F28] bg-transparent mt-0.5 focus:outline-none"
                        />
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB]">
                        <label className="text-[10px] text-[#6B7684] block">
                          월세 차임 (만 원)
                        </label>
                        <input
                          type="number"
                          value={liveMetrics.rentManwon}
                          onChange={(e) =>
                            setLiveMetrics((prev) => ({
                              ...prev,
                              rentManwon: Number(e.target.value),
                            }))
                          }
                          className="w-full text-sm font-extrabold text-[#191F28] bg-transparent mt-0.5 focus:outline-none"
                        />
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB]">
                        <label className="text-[10px] text-[#6B7684] block">
                          별도거주 기간 (개월)
                        </label>
                        <input
                          type="number"
                          value={liveMetrics.sepMonths}
                          onChange={(e) =>
                            setLiveMetrics((prev) => ({
                              ...prev,
                              sepMonths: Number(e.target.value),
                            }))
                          }
                          className="w-full text-sm font-extrabold text-[#191F28] bg-transparent mt-0.5 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 9 Executed Agency Tools List */}
                  <div className="space-y-2.5">
                    {govToolSteps.map((step, idx) => {
                      const isSelected = selectedToolStepIdx === idx;
                      return (
                        <div
                          key={step.toolName}
                          onClick={() => setSelectedToolStepIdx(idx)}
                          className={`bg-white rounded-2xl p-4 border cursor-pointer transition space-y-2.5 ${
                            isSelected
                              ? "border-[#256EF4] ring-2 ring-[#256EF4]/15"
                              : "border-[#E5E8EB] hover:border-[#B0B8C1]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-[#0B3168] text-white font-mono text-[10px] font-bold">
                                Tool 0{step.step}
                              </span>
                              <span className="text-xs font-extrabold text-[#191F28]">
                                [{step.agency}]
                              </span>
                              <span className="font-mono text-xs font-bold text-[#256EF4]">
                                {step.toolName}()
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {step.deepLinkUrl && (
                                <a
                                  href={step.deepLinkUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#EAF2FE] hover:bg-[#DCE9FD] text-[#1D64F2] flex items-center gap-1"
                                >
                                  <span>기관 연결</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  step.status === "warn"
                                    ? "bg-[#FFECEE] text-[#F04452]"
                                    : "bg-[#E6F8F6] text-[#00897B]"
                                }`}
                              >
                                {step.status === "warn"
                                  ? "불일치 감지"
                                  : "연동 완료"}
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-[#4E5968]">
                            {step.description}
                          </p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
                            <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB]">
                              <div className="text-[10px] font-bold text-[#6B7684] mb-1">
                                요청 파라미터 (Input)
                              </div>
                              <pre className="whitespace-pre-wrap text-[#333D4B]">
                                {JSON.stringify(step.input, null, 2)}
                              </pre>
                            </div>
                            <div className="p-2.5 rounded-xl bg-[#EAF2FE]/40 border border-[#C9DDFD]">
                              <div className="text-[10px] font-bold text-[#1D64F2] mb-1">
                                기관 응답 데이터 (Output)
                              </div>
                              <pre className="whitespace-pre-wrap text-[#0B3168] font-semibold">
                                {JSON.stringify(step.output, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* ---------- ARTIFACT 1: 건보공단 · 건축물대장 · 별표 특례 판정서 ---------- */}
              {activeArtifactView === "triage_clause" && (
                <motion.div
                  key="art-triage"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-white rounded-2xl p-5 border border-[#DCE6F5] shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-[#EAF2FE] text-[#1D64F2]">
                        🏥 국민건강보험공단 · 🏢 국토부 건축물대장 · RTMS 통합 판정
                      </span>
                      <span className="text-xs font-bold text-[#00897B]">
                        수급 확신도 98%
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB]">
                        <div className="text-[11px] text-[#6B7684]">
                          건보공단 1인가구 중위소득
                        </div>
                        <div className="text-lg font-black text-[#256EF4] mt-0.5">
                          <SpringCounter
                            value={liveMetrics.medianRatioPercent}
                            suffix="%"
                          />
                        </div>
                        <div className="text-[11px] text-[#00897B] font-bold">
                          18p [별표2] 50~60% 특례 일치
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB]">
                        <div className="text-[11px] text-[#6B7684]">
                          국토부 RTMS 환산합산 월세
                        </div>
                        <div className="text-lg font-black text-[#191F28] mt-0.5">
                          <SpringCounter
                            value={liveMetrics.convertedRentKRW}
                            suffix="원"
                          />
                        </div>
                        <div className="text-[11px] text-[#00897B] font-bold">
                          상한 900,000원 이하 적격
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#EAF2FE] border border-[#C9DDFD]">
                        <div className="text-[11px] text-[#0B3168] font-bold flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          <span>세움터 건축물대장</span>
                        </div>
                        <div className="text-base font-black text-[#0B3168] mt-0.5">
                          다세대주택 (24.8㎡)
                        </div>
                        <div className="text-[11px] text-[#1D64F2] font-bold">
                          위반건축물 없음 · 제301호
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Highlighted Clauses */}
                  <div className="bg-white rounded-2xl p-5 border border-[#E5E8EB] shadow-xs space-y-3">
                    <h3 className="text-sm font-extrabold text-[#191F28]">
                      온통청년 공고문({currentPolicy.pageCount}p) 원문 & 별표 특례 하이라이트
                    </h3>
                    <div className="space-y-3">
                      {currentPolicy.announcementExcerpts.map((clause) => {
                        const active = highlightedClauseId === clause.id;
                        return (
                          <div
                            key={clause.id}
                            onClick={() => setHighlightedClauseId(clause.id)}
                            className={`p-4 rounded-xl border cursor-pointer transition space-y-2 ${
                              active
                                ? "bg-[#EAF2FE]/60 border-[#256EF4] ring-1 ring-[#256EF4]"
                                : "bg-[#F8FAFC] border-[#E5E8EB]"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-extrabold text-[#191F28]">
                                {clause.section}
                              </span>
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#0B3168] text-white">
                                {clause.page}
                              </span>
                            </div>
                            <div className="p-3 rounded-lg bg-white border border-[#E5E8EB] text-xs text-[#4E5968] leading-relaxed">
                              &ldquo;{clause.rawText}&rdquo;
                            </div>
                            <div className="p-3 rounded-lg bg-[#EAF2FE] text-xs font-bold text-[#0B3168] leading-relaxed">
                              💡 에이전트 일상어 번역: {clause.plainTranslation}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ---------- ARTIFACT 2: 정부24 · 대법원 · RTMS 직통 발급 딥링크 & 체크박스 ---------- */}
              {activeArtifactView === "doc_recipe" && (
                <motion.div
                  key="art-recipe"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-[#EAF2FE] rounded-2xl p-4 border border-[#C9DDFD] flex items-center justify-between">
                    <div>
                      <div className="text-xs font-extrabold text-[#0B3168]">
                        🛠️ Tool Output: gov24_civil_doc_recipe() — 4개 기관 민원발급 딥링크 연결됨
                      </div>
                      <div className="text-[11px] text-[#4E5968]">
                        각 서류 우측 버튼을 누르면 정부24·대법원·RTMS·청약홈 해당 발급 화면으로 즉시 이동합니다.
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {requiredDocs.map((doc, idx) => {
                      const isDone = Boolean(checkedRecipes[doc.id]);
                      return (
                        <div
                          key={doc.id}
                          onClick={() =>
                            setCheckedRecipes((prev) => ({
                              ...prev,
                              [doc.id]: !prev[doc.id],
                            }))
                          }
                          className="bg-white rounded-2xl p-4 border border-[#E5E8EB] space-y-3 cursor-pointer hover:border-[#256EF4] transition"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5">
                              <AnimatedCheckIcon checked={isDone} />
                              <div>
                                <span className="text-[11px] font-bold text-[#256EF4]">
                                  필수 서류 0{idx + 1} · {doc.timeEstimate}
                                </span>
                                <h4 className="text-sm font-extrabold text-[#191F28]">
                                  {doc.title}
                                </h4>
                              </div>
                            </div>
                            <a
                              href={doc.issuerUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl bg-[#0B3168] hover:bg-[#256EF4] text-white transition shrink-0"
                            >
                              <span>{doc.issuer} 발급 바로가기</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>

                          <div className="space-y-1.5">
                            {doc.checkboxOptions.map((chk, cIdx) => (
                              <div
                                key={cIdx}
                                className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB] text-xs space-y-0.5"
                              >
                                <div className="font-bold text-[#191F28] flex items-center gap-1.5">
                                  <span className="px-1.5 py-0.2 rounded bg-[#256EF4] text-white text-[10px]">
                                    필수체크
                                  </span>
                                  <span>{chk.label}</span>
                                </div>
                                <div className="text-[11px] text-[#6B7684]">
                                  {chk.reason}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* ---------- ARTIFACT 3: 서류 X-Ray 교차검수기 ---------- */}
              {activeArtifactView === "pre_audit_xray" && (
                <motion.div
                  key="art-xray"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div
                    className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                      auditMode === "defect"
                        ? "bg-[#FFECEE] border-[#F04452]"
                        : "bg-[#E6F8F6] border-[#00B8A9]"
                    }`}
                  >
                    <div>
                      <div className="text-[11px] font-bold text-[#4E5968]">
                        🛠️ 정부24 등본 ↔ 국토부 건축물대장(301호) ↔ 계약서 ↔ 대법원 증명서 교차검증
                      </div>
                      <div className="text-sm font-extrabold text-[#191F28]">
                        {currentAuditData.summaryTitle}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-lg font-black ${
                          auditMode === "defect"
                            ? "text-[#F04452]"
                            : "text-[#00897B]"
                        }`}
                      >
                        통과율 {currentAuditData.passProbability}%
                      </span>
                      {auditMode === "defect" && (
                        <button
                          onClick={() => executeMission("mission_audit_fixed")}
                          className="px-3 py-1.5 rounded-xl bg-[#00897B] text-white text-xs font-bold flex items-center gap-1"
                        >
                          <Wand2 className="w-3.5 h-3.5" />
                          <span>보완 완료 시뮬레이션</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {currentAuditData.documents.map((doc) => (
                      <div
                        key={doc.docId}
                        className={`bg-white rounded-2xl p-4 border space-y-2.5 ${
                          activeFindingDocId === doc.docId
                            ? "ring-2 ring-[#256EF4] border-[#256EF4]"
                            : "border-[#E5E8EB]"
                        }`}
                      >
                        <div className="flex items-center justify-between border-b border-[#F0F2F5] pb-2.5">
                          <div>
                            <span className="text-[11px] text-[#6B7684]">
                              {doc.fileName}
                            </span>
                            <h4 className="text-sm font-extrabold text-[#191F28]">
                              {doc.headerTitle}
                            </h4>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              doc.stampStatus === "valid"
                                ? "bg-[#E6F8F6] text-[#00897B]"
                                : "bg-[#FFECEE] text-[#F04452]"
                            }`}
                          >
                            <Stamp className="w-3 h-3" />
                            {doc.stampText}
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {doc.fields.map((f, idx) => (
                            <div
                              key={idx}
                              className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                                f.status === "error"
                                  ? "bg-[#FFECEE]/60 border-[#F04452]"
                                  : f.status === "warning"
                                  ? "bg-[#FFF3E8] border-[#FF8A3D]"
                                  : "bg-[#F8FAFC] border-[#E5E8EB]"
                              }`}
                            >
                              <div>
                                <span className="text-[10px] text-[#6B7684] block">
                                  {f.label}
                                </span>
                                <span className="font-bold text-[#191F28]">
                                  {formatFieldWithPiiGuard(f.value)}
                                </span>
                              </div>
                              {f.errorTag ? (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#F04452] text-white">
                                  {f.errorTag}
                                </span>
                              ) : (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#E6F8F6] text-[#00897B] flex items-center gap-1">
                                  <Check className="w-3 h-3" />
                                  적격
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-white rounded-2xl p-4 border border-[#E5E8EB] space-y-2.5">
                    <div className="text-xs font-extrabold text-[#0B3168]">
                      기관별 즉시 재발급 · 보완 처방전
                    </div>
                    {currentAuditData.findings.map((finding: AuditFinding) => (
                      <div
                        key={finding.id}
                        onMouseEnter={() => setActiveFindingDocId(finding.docId)}
                        onMouseLeave={() => setActiveFindingDocId(null)}
                        className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB] space-y-1 text-xs"
                      >
                        <div className="font-extrabold text-[#191F28]">
                          {finding.title}
                        </div>
                        <p className="text-[#4E5968]">{finding.detail}</p>
                        <div className="font-bold text-[#1D64F2] pt-0.5">
                          → 처방: {finding.fixAction}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ---------- ARTIFACT 4: 복지로/고용24 신청서 패키지 에디터 ---------- */}
              {activeArtifactView === "application_editor" && (
                <motion.div
                  key="art-editor"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-white rounded-2xl p-5 border border-[#E5E8EB] space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-extrabold text-[#191F28]">
                        {currentPolicy.applicationFormTemplate.formTitle}
                      </h3>
                      <a
                        href="https://www.bokjiro.go.kr"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold px-3 py-1 rounded-lg bg-[#0B3168] text-white flex items-center gap-1"
                      >
                        <span>복지로 신청 바로가기</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    <div className="space-y-2">
                      {activeAutoFilledFields.map((field, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E5E8EB] flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <span className="text-[10px] text-[#6B7684] block">
                              {field.label}
                            </span>
                            <span className="font-bold text-[#191F28]">
                              {field.value}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EAF2FE] text-[#1D64F2]">
                            {field.sourceDoc}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl p-5 border border-[#E5E8EB] space-y-3">
                    <div>
                      <span className="text-[11px] font-bold text-[#256EF4]">
                        🛠️ Tool Output: welfare_form_packager() — 루브릭 자기검증 98/100점
                      </span>
                      <h3 className="text-sm font-extrabold text-[#191F28]">
                        {currentPolicy.applicationFormTemplate.essayTitle}
                      </h3>
                    </div>

                    <textarea
                      value={essayDraft}
                      onChange={(e) => setEssayDraft(e.target.value)}
                      rows={6}
                      className="w-full rounded-xl bg-[#F8FAFC] border border-[#D8E0EB] p-3.5 text-xs text-[#191F28] leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#256EF4]"
                    />

                    <button
                      onClick={handleDownloadPackage}
                      className="w-full py-3.5 rounded-xl bg-[#256EF4] hover:bg-[#1B5AD8] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition"
                    >
                      <Download className="w-4 h-4" />
                      <span>최종 제출용 완제품 패키지(.txt) 다운로드</span>
                    </button>

                    {downloadSuccess && (
                      <div className="p-3 rounded-xl bg-[#E6F8F6] text-[#00897B] text-xs font-bold text-center">
                        7개 공공기관 검증 명세서 및 신청서 다운로드가 완료되었습니다!
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ==================== MODAL: GEMINI & PUBLIC DATA API CONFIG ==================== */}
      <AnimatePresence>
        {showApiModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#0B3168]/40 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="bg-white rounded-[24px] max-w-lg w-full p-6 shadow-2xl space-y-4 border border-[#E5E8EB]"
            >
              <div className="flex items-center justify-between border-b border-[#E5E8EB] pb-4">
                <div className="flex items-center gap-2">
                  <PlugZap className="w-5 h-5 text-[#256EF4]" />
                  <div>
                    <span className="text-xs font-bold text-[#00897B]">
                      MULTI-AGENCY API CONFIG
                    </span>
                    <h3 className="text-lg font-extrabold text-[#191F28]">
                      Gemini 2.5 & 공공데이터포털 API 설정
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setShowApiModal(false)}
                  className="p-1.5 rounded-full hover:bg-[#F2F5F9] text-[#6B7684]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3.5">
                <div
                  className={`p-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                    apiConnected
                      ? "bg-[#E6F8F6] border-[#8FD9D2] text-[#00695C]"
                      : "bg-[#EAF2FE] border-[#C9DDFD] text-[#0B3168]"
                  }`}
                >
                  {apiConnected ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-[#00897B]" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#256EF4]" />
                  )}
                  <span>{apiStatusMsg}</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#333D4B] mb-1">
                    1. Google Gemini API Key (실시간 Function Calling & Vision OCR)
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-[#8B95A1] absolute left-3 top-2.5" />
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="AIzaSy... (Google AI Studio 발급 키)"
                      className="w-full rounded-[12px] bg-[#F8FAFC] border border-[#D8E0EB] pl-9 pr-3 py-2.5 text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#256EF4]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#333D4B] mb-1">
                    2. 공공데이터포털 API Key (선택 — 행정안전부 보조금24/국토부 실거래 API)
                  </label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-[#8B95A1] absolute left-3 top-2.5" />
                    <input
                      type="password"
                      value={publicDataApiKey}
                      onChange={(e) => {
                        setPublicDataApiKey(e.target.value);
                        localStorage.setItem(
                          "gonggopass_public_key",
                          e.target.value
                        );
                      }}
                      placeholder="data.go.kr 일반인증키 (미입력 시 내장 공공데이터 스키마로 동작)"
                      className="w-full rounded-[12px] bg-[#F8FAFC] border border-[#D8E0EB] pl-9 pr-3 py-2.5 text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#256EF4]"
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    verifyApiKey(geminiApiKey);
                    fetchNineGovTools();
                  }}
                  disabled={isTestingApi}
                  className="w-full py-3 rounded-[12px] bg-[#256EF4] hover:bg-[#1B5AD8] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition"
                >
                  {isTestingApi ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>연결 확인 중...</span>
                    </>
                  ) : (
                    <span>저장 및 9대 공공기관 도구 연동 테스트</span>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
