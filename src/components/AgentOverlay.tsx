"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Pause, Play, Square, Sparkles } from "lucide-react";

export interface AgentPlanStep {
  label: string;
  status: "pending" | "active" | "done";
}

export interface AgentTarget {
  selector: string;
  label: string;
  id: number;
}

interface AgentOverlayProps {
  active: boolean;
  paused: boolean;
  scanning: boolean;
  target: AgentTarget | null;
  onStop: () => void;
}

export function AgentPlanCard({
  paused,
  steps,
  thought,
  onTogglePause,
  onStop,
}: {
  paused: boolean;
  steps: AgentPlanStep[];
  thought: string;
  onTogglePause: () => void;
  onStop: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!thought) {
      setTyped("");
      return;
    }
    setTyped("");
    let i = 0;
    const timer = window.setInterval(() => {
      if (paused) return;
      i += 1;
      setTyped(thought.slice(0, i));
      if (i >= thought.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [thought, paused]);

  const currentStep = steps.find((s) => s.status === "active") || steps[steps.length - 1];
  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div className="w-full max-w-[460px] animate-fade-up rounded-2xl border border-purple-200/90 bg-white/95 p-3 shadow-[0_10px_28px_-14px_rgba(109,40,217,0.22)]">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex min-w-0 items-center gap-2 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-800 ring-1 ring-purple-200/80">
          {paused ? (
            <Pause className="h-3 w-3 shrink-0 text-amber-600" />
          ) : (
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-600" />
          )}
          <span className="truncate">
            {paused ? "일시정지됨" : currentStep?.label || "AI 에이전트 실행 중"}
          </span>
          {steps.length > 0 && (
            <span className="tnum shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-purple-600">
              {Math.min(doneCount + (paused ? 0 : 1), steps.length)}/{steps.length}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onTogglePause}
            title={paused ? "다시 진행" : "일시정지"}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            {paused ? <Play className="h-3 w-3 text-emerald-600" /> : <Pause className="h-3 w-3" />}
            <span>{paused ? "계속" : "일시정지"}</span>
          </button>
          <button
            type="button"
            onClick={onStop}
            title="즉시 중지 (ESC 또는 마우스 흔들기)"
            className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-600"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            <span>중지 ESC</span>
          </button>
        </div>
      </div>

      {steps.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {steps.map((st, idx) => (
            <span
              key={idx}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] transition-colors ${
                st.status === "done"
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70"
                  : st.status === "active"
                  ? "bg-purple-100/80 font-medium text-purple-800 ring-1 ring-purple-300"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              {st.status === "done" ? (
                <Check className="h-3 w-3" strokeWidth={2.5} />
              ) : (
                <span className="tnum text-[10px]">{idx + 1}.</span>
              )}
              <span>{st.label}</span>
            </span>
          ))}
        </div>
      )}

      {typed && (
        <p className="mt-2 border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-600">
          <span className="mr-1.5 font-semibold text-purple-600">AI 판단</span>
          <span>{typed}</span>
          {!paused && typed.length < thought.length && (
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-purple-500 align-middle" />
          )}
        </p>
      )}
    </div>
  );
}

interface Point {
  x: number;
  y: number;
}

export function AgentOverlay({
  active,
  paused,
  scanning,
  target,
  onStop,
}: AgentOverlayProps) {

  // ESC 키 및 마우스 흔들기 긴급 정지(Kill Switch)
  const shakeRef = useRef<{ lastX: number; lastDx: number; flips: number; dist: number; ts: number }>({
    lastX: 0,
    lastDx: 0,
    flips: 0,
    dist: 0,
    ts: 0,
  });

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      const s = shakeRef.current;
      if (now - s.ts > 420) {
        s.flips = 0;
        s.dist = 0;
        s.ts = now;
        s.lastX = e.clientX;
        s.lastDx = 0;
        return;
      }
      const dx = e.clientX - s.lastX;
      s.dist += Math.abs(dx);
      if (dx !== 0 && s.lastDx !== 0 && Math.sign(dx) !== Math.sign(s.lastDx) && Math.abs(dx) > 12) {
        s.flips += 1;
      }
      s.lastX = e.clientX;
      if (Math.abs(dx) > 4) s.lastDx = dx;
      if (s.flips >= 4 && s.dist > 550) {
        s.flips = 0;
        s.dist = 0;
        onStop();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
    };
  }, [active, onStop]);

  // 가상 커서, 잔상, 빨간 네모 타겟 박스, 클릭 파동
  const cursorPosRef = useRef<Point>({ x: 420, y: 260 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [trail, setTrail] = useState<Point[]>([]);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number; label: string } | null>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    if (!target) {
      setBox(null);
      setRipple(null);
      setTrail([]);
      return;
    }

    let raf = 0;
    let cancelled = false;

    const startTimer = window.setTimeout(() => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-agent-target="${target.selector}"]`);
      if (!el) return;

      el.scrollIntoView({ behavior: "smooth", block: "nearest" });

      const measure = () => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          cx: r.left + Math.min(r.width * 0.65, r.width - 24),
          cy: r.top + Math.min(r.height * 0.35, 38),
        };
      };

      const start = cursorPosRef.current;
      const initRect = measure();
      // 부드러운 베지어 곡선 제어점
      const ctrl: Point = {
        x: (start.x + initRect.cx) / 2 - 48,
        y: Math.min(start.y, initRect.cy) - 56,
      };
      const duration = 620;
      const t0 = performance.now();

      const step = (now: number) => {
        if (cancelled) return;
        const p = Math.min(1, (now - t0) / duration);
        // easeOutCubic
        const e = 1 - Math.pow(1 - p, 3);
        const curRect = measure();
        const inv = 1 - e;
        const x = inv * inv * start.x + 2 * inv * e * ctrl.x + e * e * curRect.cx;
        const y = inv * inv * start.y + 2 * inv * e * ctrl.y + e * e * curRect.cy;

        cursorPosRef.current = { x, y };
        setCursor({ x, y });
        setTrail((prev) => [{ x, y }, ...prev].slice(0, 7));

        if (p > 0.72) {
          setBox({
            left: curRect.left - 4,
            top: curRect.top - 4,
            width: curRect.width + 8,
            height: curRect.height + 8,
            label: target.label,
          });
        }

        if (p < 1) {
          raf = requestAnimationFrame(step);
        } else {
          setTrail([]);
          setRipple({ x: curRect.cx, y: curRect.cy, id: target.id });
        }
      };

      raf = requestAnimationFrame(step);
    }, 340);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [target]);

  if (!active && !target && !scanning) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-live="polite">
      {/* 1. 서류/화면 스캔 라인 애니메이션 */}
      {scanning && !paused && (
        <div className="absolute inset-0">
          <div className="animate-agent-scan absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-purple-500 to-transparent shadow-[0_0_18px_4px_rgba(168,85,247,0.45)]" />
          <div className="animate-agent-scan absolute left-0 right-0 h-16 -translate-y-full bg-gradient-to-b from-transparent to-purple-500/[0.07]" />
        </div>
      )}

      {/* 2. 중요 부분 빨간 네모 하이라이트 */}
      {box && (
        <div
          key={`box-${target?.id}`}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          className="animate-target-box fixed rounded-2xl border-2 border-red-500 bg-red-500/[0.03] shadow-[0_0_0_4px_rgba(239,68,68,0.12),0_0_24px_rgba(239,68,68,0.22)] transition-all duration-200"
        >
          <span className="absolute -top-3 left-3 inline-flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold tracking-tight text-white shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            {box.label}
          </span>
        </div>
      )}

      {/* 3. 클릭 물결 파동(Ripple) */}
      {ripple && (
        <div key={`ripple-${ripple.id}`} style={{ left: ripple.x, top: ripple.y }} className="fixed">
          <span className="animate-agent-ripple absolute h-10 w-10 rounded-full border-2 border-red-500/80" />
          <span
            style={{ animationDelay: "110ms" }}
            className="animate-agent-ripple absolute h-10 w-10 rounded-full border-2 border-purple-500/70"
          />
        </div>
      )}

      {/* 4. 가상 AI 커서 & 잔상(Trail) */}
      {cursor && (
        <>
          {trail.map((pt, i) => (
            <span
              key={i}
              style={{
                left: pt.x,
                top: pt.y,
                opacity: Math.max(0, 0.42 - i * 0.06),
                transform: `translate(-50%, -50%) scale(${1 - i * 0.11})`,
              }}
              className="fixed h-2.5 w-2.5 rounded-full bg-purple-400 blur-[0.5px]"
            />
          ))}
          <div
            style={{ left: cursor.x, top: cursor.y }}
            className="fixed -translate-x-1 -translate-y-1 drop-shadow-[0_4px_12px_rgba(126,34,206,0.45)]"
          >
            <svg className="h-6 w-6 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M4.5 3.2L19.2 10.6c.9.45.8 1.75-.16 2.06l-5.6 1.8-2.4 5.36c-.42.93-1.76.86-2.08-.1L4.5 3.2z"
                stroke="#ffffff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span className="ml-4 -mt-1 inline-flex items-center gap-1 rounded-full bg-purple-700 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md whitespace-nowrap">
              <Sparkles className="h-2.5 w-2.5" />
              공고패스 AI
            </span>
          </div>
        </>
      )}
    </div>
  );
}
