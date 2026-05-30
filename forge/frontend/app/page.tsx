"use client";

import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Inter, Fira_Code } from "next/font/google";
import { motion, AnimatePresence } from "framer-motion";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  CheckCircle2, XCircle, Loader2, Phone, Link as LinkIcon, Copy,
  Shield, Zap, Activity, ChevronDown, TrendingUp, UploadCloud,
  Clock, AlertTriangle,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"] });
const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const USER_ID  = "demo";

const BUILD_STEPS = [
  "Ingest",
  "Transcribe",
  "Extract Personality",
  "Score Transcripts",
  "Configure Voice",
  "Build RAG",
  "Fine-tune",
];

const PERSONA_NAMES: Record<string, string> = {
  social_engineer:       "Social Engineer",
  jailbreaker:           "Jailbreaker",
  emotional_escalator:   "Emotional Escalator",
  identity_attacker:     "Identity Attacker",
  knowledge_prober:      "Knowledge Prober",
  language_switcher:     "Language Switcher",
  contradiction_trapper: "Contradiction Trapper",
  degraded_audio:        "Degraded Audio",
};

const SIDEBAR_NAV = [
  { id: "build",       label: "Build",       Icon: Zap },
  { id: "agent",       label: "Agent",       Icon: Phone },
  { id: "vanguard",    label: "Vanguard",    Icon: Shield },
  { id: "improvement", label: "Improvement", Icon: TrendingUp },
] as const;

/* ─────────── Design tokens ─────────────────────────────── */
const C = {
  bg:        "#05060F",
  card:      "#0C1020",
  cardUp:    "#111828",
  border:    "#1B2540",
  borderLt:  "#263A5E",
  brand:     "#7C3AED",
  brandLt:   "#A78BFA",
  brandGlow: "rgba(124,58,237,0.15)",
  success:   "#22C55E",
  successBg: "rgba(34,197,94,0.08)",
  successBd: "rgba(34,197,94,0.25)",
  error:     "#EF4444",
  errorBg:   "rgba(239,68,68,0.08)",
  errorBd:   "rgba(239,68,68,0.25)",
  warning:   "#F59E0B",
  warningBg: "rgba(245,158,11,0.08)",
  warningBd: "rgba(245,158,11,0.25)",
  text:      "#EDF2FF",
  text2:     "#8098B8",
  text3:     "#3A5070",
  mono:      "var(--font-mono)",
} as const;

/* ─────────── Types ──────────────────────────────────────── */
type DimensionScores = {
  character_consistency?: number;
  jailbreak_resistance?:  number;
  factual_accuracy?:      number;
  graceful_degradation?:  number;
};
type Evaluation = {
  overall_score:        number;
  overall_pass:         boolean;
  dimension_scores?:    DimensionScores;
  failure_annotations?: Array<Record<string, unknown>>;
  provider?:            string;
};
type TranscriptTurn = { role: string; text: string };
type VanguardSession = {
  session_id:        string;
  attack_persona:    string;
  status:            string;
  overall_score?:    number;
  duration_seconds?: number;
  evaluation?:       Evaluation;
  transcript?:       { turns?: TranscriptTurn[] };
};
type VanguardRun = {
  run_id: string; total: number; passed: number; failed: number;
  pass_rate: number; sessions?: VanguardSession[];
};
type SystemStatus = {
  personality_spec_ready: boolean; voice_clone_ready: boolean; rag_ready: boolean;
  vanguard_runs: number; improvement_cycles: number; attack_suite_size: number;
};
type PassRateHistoryItem = { cycle: number; pass_rate: number; regression_passed?: boolean };
type Dashboard = {
  latest_vanguard_run_summary?: VanguardRun | null;
  pass_rate_history?:           PassRateHistoryItem[];
  attack_suite_history?:        Array<{ cycle: number; size: number }>;
  attack_suite_size?:           number;
  voice_id?:                    string | null;
  gemini_voice?:                string | null;
  attacker_gemini_voice?:       string | null;
  adapter_id?:                  string | null;
  personality_spec?:            Record<string, unknown> | null;
  pass_rate_by_persona?:        Record<string, { runs: number; passed: number; pass_rate: number }>;
};
type BuildStatus = { job_id: string; stage: string; status: string; error?: string };
type DimensionScoreCard = {
  empathy: number; objection_handling: number; naturalness: number;
  conversational_flow: number; closing_technique: number;
};
const DIMENSION_LABELS: Record<string, string> = {
  closing_technique:   "Loan Knowledge",
  objection_handling:  "Objection Handling",
  empathy:             "Empathy",
  naturalness:         "Naturalness",
  conversational_flow: "Conversational Flow",
};
type TranscriptScores = {
  aggregate_score: number;
  dimension_scores: DimensionScoreCard;
  top_k_turns: Array<{ caller: string; agent: string; aggregate: number }>;
};
type ChartPoint   = { cycle: number; passRate?: number; suiteSize?: number };
type LiveResponse = {
  sessions: VanguardSession[]; complete: boolean; total: number; expected_total: number;
};
type AttackSuiteItem = { session_id: string; attack_persona: string; status: string };

/* ─────────── Utils ──────────────────────────────────────── */
function formatTime(ts: Date): string {
  return ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ─────────── Primitive button components ────────────────── */
function PrimaryBtn({
  children, onClick, disabled, style,
}: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; style?: React.CSSProperties }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 13, fontWeight: 500, padding: "8px 16px",
        borderRadius: 8, border: "1px solid rgba(124,58,237,0.5)", cursor: disabled ? "not-allowed" : "pointer",
        background: hover && !disabled ? "linear-gradient(135deg,#8B5CF6,#7C3AED)" : "linear-gradient(135deg,#7C3AED,#6D28D9)",
        color: "#fff",
        boxShadow: hover && !disabled ? "0 4px 16px rgba(124,58,237,0.35)" : "0 2px 8px rgba(124,58,237,0.2)",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
        opacity: disabled ? 0.55 : 1,
        transition: "all 0.18s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function GreenBtn({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 13, fontWeight: 500, padding: "8px 16px",
        borderRadius: 8, border: "1px solid rgba(22,163,74,0.5)", cursor: disabled ? "not-allowed" : "pointer",
        background: hover && !disabled ? "linear-gradient(135deg,#22C55E,#16A34A)" : "linear-gradient(135deg,#16A34A,#15803D)",
        color: "#fff",
        boxShadow: hover && !disabled ? "0 4px 16px rgba(34,197,94,0.3)" : "0 2px 8px rgba(34,197,94,0.15)",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
        opacity: disabled ? 0.55 : 1,
        transition: "all 0.18s",
      }}
    >
      {children}
    </button>
  );
}

function Card({
  children, style,
}: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
      color: C.brandLt, textTransform: "uppercase", marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

/* ─────────── Pass-rate donut ────────────────────────────── */
function PassRateRing({ rate, size = 72 }: { rate: number; size?: number }) {
  const r    = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ * (1 - rate / 100);
  const clr  = rate >= 80 ? C.success : rate >= 50 ? C.warning : C.error;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={8} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={clr} strokeWidth={8}
        strokeDasharray={circ} strokeDashoffset={off}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

/* ─────────── Improvement chart ──────────────────────────── */
function ImprovementChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#A78BFA" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1B2540" vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="cycle"
          tick={{ fill: C.text2, fontSize: 11 }}
          axisLine={{ stroke: C.border }} tickLine={false} />
        <YAxis yAxisId="left" orientation="left" domain={[0, 100]}
          tick={{ fill: C.text2, fontSize: 11 }}
          axisLine={false} tickLine={false}
          tickFormatter={(v) => `${v}%`} />
        <YAxis yAxisId="right" orientation="right" domain={["auto", "auto"]}
          tick={{ fill: C.text2, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: C.cardUp, border: `1px solid ${C.borderLt}`,
            borderRadius: 8, color: C.text, fontSize: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
          labelStyle={{ color: C.text2, marginBottom: 4 }}
          cursor={{ stroke: C.borderLt, strokeWidth: 1 }}
        />
        <Line yAxisId="left" type="monotone" dataKey="passRate" name="Pass Rate %"
          stroke="url(#lineGrad)" strokeWidth={2.5}
          dot={{ r: 4, fill: C.brand, stroke: C.card, strokeWidth: 2 }}
          activeDot={{ r: 6, fill: C.brandLt, stroke: C.card, strokeWidth: 2 }} />
        <Line yAxisId="right" type="monotone" dataKey="suiteSize" name="Attack Variants"
          stroke={C.text3} strokeWidth={1.5} strokeDasharray="5 3"
          dot={{ r: 3, fill: C.text3, strokeWidth: 0 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
const ImprovementChartNoSsr = dynamic(() => Promise.resolve(ImprovementChart), { ssr: false });

/* ─────────── Waveform bars ──────────────────────────────── */
const WAVE_CONFIGS = [
  { anim: "vg-wave-a", dur: "0.72s", delay: "0ms"   },
  { anim: "vg-wave-c", dur: "0.95s", delay: "70ms"  },
  { anim: "vg-wave-b", dur: "0.81s", delay: "140ms" },
  { anim: "vg-wave-d", dur: "0.68s", delay: "30ms"  },
  { anim: "vg-wave-a", dur: "1.05s", delay: "200ms" },
  { anim: "vg-wave-c", dur: "0.77s", delay: "110ms" },
  { anim: "vg-wave-b", dur: "0.90s", delay: "260ms" },
  { anim: "vg-wave-d", dur: "0.65s", delay: "55ms"  },
];
function Waveform({ color, active }: { color: string; active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 22 }}>
      {WAVE_CONFIGS.map((cfg, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2,
          background: active ? color : C.borderLt,
          height: active ? undefined : 3,
          minHeight: 3,
          animation: active
            ? `${cfg.anim} ${cfg.dur} ease-in-out ${cfg.delay} infinite alternate`
            : "none",
          transition: "background 0.4s",
        }} />
      ))}
    </div>
  );
}

/* ─────────── Score pill ─────────────────────────────────── */
function ScorePill({ label, value }: { label: string; value?: number }) {
  if (value == null) return null;
  const color = value >= 70 ? C.success : value >= 40 ? C.warning : C.error;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: "3px 8px", fontSize: 11,
    }}>
      <span style={{ color: C.text2 }}>{label}:</span>
      <span style={{ color, fontWeight: 600, fontFamily: C.mono }}>{value}%</span>
    </div>
  );
}

/* ─────────── Vanguard card ──────────────────────────────── */
function VanguardCard({
  session, personaName, index, isExpanded, onToggle,
}: {
  session: VanguardSession | null;
  personaName: string;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const status    = session?.status ?? "queued";
  const isPassed  = status === "passed";
  const isFailed  = status === "failed";
  const isRunning = status === "running";
  const isDone    = isPassed || isFailed;
  const score     = session?.overall_score != null ? Math.round(session.overall_score) : null;
  const hasTx     = (session?.transcript?.turns?.length ?? 0) > 0;
  const [hover, setHover] = useState(false);

  const borderColor = isPassed  ? C.successBd
    : isFailed  ? C.errorBd
    : isRunning ? "rgba(124,58,237,0.45)"
    : C.border;
  const glowAnim = isPassed  ? "glow-green  2.8s ease-in-out infinite"
    : isFailed  ? "glow-red   2.8s ease-in-out infinite"
    : isRunning ? "glow-purple 2.8s ease-in-out infinite"
    : "none";
  const statusColor = isPassed ? C.success : isFailed ? C.error : isRunning ? C.warning : C.text3;
  const statusBg    = isPassed ? C.successBg : isFailed ? C.errorBg : isRunning ? C.warningBg : "transparent";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        onClick={hasTx ? onToggle : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: hover && hasTx && isDone ? C.cardUp
            : isPassed  ? "rgba(34,197,94,0.04)"
            : isFailed  ? "rgba(239,68,68,0.04)"
            : isRunning ? "rgba(124,58,237,0.04)"
            : C.card,
          border: `${isDone ? 1.5 : 1}px solid ${borderColor}`,
          borderRadius: 10, padding: 14,
          cursor: hasTx ? "pointer" : "default",
          animation: `vg-pop-in 0.32s ease-out ${index * 60}ms both, ${glowAnim}`,
          transition: "background 0.2s, border-color 0.4s",
          display: "flex", flexDirection: "column", gap: 10,
          minHeight: 148,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.3, flex: 1 }}>
            {personaName}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
            background: statusBg, color: statusColor, flexShrink: 0, letterSpacing: "0.04em",
          }}>
            {status}
          </span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
          {(isRunning || isDone) && session ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, color: C.text3, width: 36, flexShrink: 0, letterSpacing: "0.06em", fontFamily: C.mono, textTransform: "uppercase" }}>Atk</span>
                <Waveform color={C.warning} active={isRunning} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, color: C.text3, width: 36, flexShrink: 0, letterSpacing: "0.06em", fontFamily: C.mono, textTransform: "uppercase" }}>Agt</span>
                <Waveform color={C.brandLt} active={isRunning} />
              </div>
            </>
          ) : (
            <div style={{ display: "flex", gap: 5, justifyContent: "center", paddingTop: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: C.border }} />
              ))}
            </div>
          )}
        </div>

        {isDone && score !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2 }}>
              <div style={{
                width: `${score}%`, height: "100%", borderRadius: 2,
                background: `linear-gradient(90deg,${isPassed ? C.success : C.error}80,${isPassed ? C.success : C.error})`,
                transition: "width 0.7s cubic-bezier(.23,1,.32,1)",
              }} />
            </div>
            <span style={{ fontSize: 11, color: C.text2, width: 32, textAlign: "right", fontFamily: C.mono }}>{score}%</span>
            {session?.duration_seconds && (
              <span style={{ fontSize: 10, color: C.text3, width: 26, fontFamily: C.mono }}>
                {Math.round(session.duration_seconds)}s
              </span>
            )}
          </div>
        )}

        {isDone && hasTx && (
          <div style={{ fontSize: 10, color: C.text3, display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronDown size={10} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            {isExpanded ? "Hide transcript" : "View transcript"}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isExpanded && hasTx && session?.transcript?.turns && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{
              background: C.bg, border: `1px solid ${C.border}`, borderTop: "none",
              borderRadius: "0 0 10px 10px", padding: 12,
              maxHeight: 260, overflowY: "auto",
            }}>
              {session.evaluation?.dimension_scores && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                  <ScorePill label="Consistency" value={session.evaluation.dimension_scores.character_consistency} />
                  <ScorePill label="Jailbreak"   value={session.evaluation.dimension_scores.jailbreak_resistance} />
                  <ScorePill label="Factual"     value={session.evaluation.dimension_scores.factual_accuracy} />
                  <ScorePill label="Degrade"     value={session.evaluation.dimension_scores.graceful_degradation} />
                  {session.evaluation.provider && (
                    <span style={{ fontSize: 10, color: C.text3, display: "flex", alignItems: "center" }}>
                      via {session.evaluation.provider}
                    </span>
                  )}
                </div>
              )}
              {session.transcript.turns.map((turn, i) => {
                const isAtk = turn.role === "caller" || turn.role === "user" || turn.role.toLowerCase() === "attacker";
                return (
                  <div key={i} style={{
                    display: "flex", flexDirection: "column",
                    alignItems: isAtk ? "flex-start" : "flex-end", marginBottom: 7,
                  }}>
                    <span style={{
                      fontSize: 9, color: isAtk ? C.warning : C.text3, marginBottom: 2,
                      letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: C.mono,
                    }}>
                      {isAtk ? "Attacker" : "Agent"}
                    </span>
                    <div style={{
                      fontSize: 11, color: C.text, lineHeight: 1.5,
                      background: isAtk ? C.warningBg : C.card,
                      border: `1px solid ${isAtk ? C.warningBd : C.border}`,
                      borderRadius: 7, padding: "5px 10px", maxWidth: "90%",
                    }}>
                      {turn.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────── Vanguard grid ──────────────────────────────── */
function VanguardGrid({
  suite, sessions, expectedTotal, expandedSessions, onToggleSession,
}: {
  suite: AttackSuiteItem[];
  sessions: VanguardSession[];
  expectedTotal: number;
  expandedSessions: Set<string>;
  onToggleSession: (id: string) => void;
}) {
  const sessionMap = new Map(sessions.map((s) => [s.session_id, s]));
  type Slot = { personaName: string; session: VanguardSession | null; key: string };
  let slots: Slot[];

  if (suite.length > 0) {
    slots = suite.map((item) => ({
      key:         item.session_id,
      personaName: PERSONA_NAMES[item.attack_persona] || item.attack_persona,
      session:     sessionMap.get(item.session_id) ?? null,
    }));
    sessions.forEach((s) => {
      if (!slots.find((sl) => sl.key === s.session_id))
        slots.push({ key: s.session_id, personaName: PERSONA_NAMES[s.attack_persona] || s.attack_persona, session: s });
    });
  } else {
    const liveSlots: Slot[] = sessions.map((s) => ({
      key: s.session_id, personaName: PERSONA_NAMES[s.attack_persona] || s.attack_persona, session: s,
    }));
    const ph = Math.max(0, expectedTotal - liveSlots.length);
    slots = [
      ...liveSlots,
      ...Array.from({ length: ph }, (_, i) => ({
        key: `placeholder-${i}`, personaName: `Room ${liveSlots.length + i + 1}`, session: null,
      })),
    ];
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
      {slots.map((slot, i) => (
        <VanguardCard
          key={slot.key} index={i}
          personaName={slot.personaName}
          session={slot.session}
          isExpanded={slot.session ? expandedSessions.has(slot.session.session_id) : false}
          onToggle={() => slot.session && onToggleSession(slot.session.session_id)}
        />
      ))}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════ *
 *  MAIN PAGE                                                *
 * ═════════════════════════════════════════════════════════ */
export default function Page() {
  const [activeSection,       setActiveSection]       = useState("build");
  const [files,               setFiles]               = useState<File[]>([]);
  const [isDragging,          setIsDragging]          = useState(false);
  const [completedSteps,      setCompletedSteps]      = useState<string[]>([]);
  const [buildJobId,          setBuildJobId]          = useState<string | null>(null);
  const [buildStage,          setBuildStage]          = useState<string | null>(null);
  const [callInfo,            setCallInfo]            = useState<{ room_url: string; phone_number: string } | null>(null);
  const [runId,               setRunId]               = useState<string | null>(null);
  const [run,                 setRun]                 = useState<VanguardRun | null>(null);
  const [dashboard,           setDashboard]           = useState<Dashboard>({});
  const [statusInfo,          setStatusInfo]          = useState<SystemStatus | null>(null);
  const [lastUpdated,         setLastUpdated]         = useState<Date>(new Date());
  const [busy,                setBusy]                = useState<string | null>(null);
  const [error,               setError]               = useState<string | null>(null);
  const [copiedText,          setCopiedText]          = useState<string | null>(null);
  const [chatMessage,         setChatMessage]         = useState("");
  const [chatResponse,        setChatResponse]        = useState<string | null>(null);
  const [chatLatency,         setChatLatency]         = useState<number | null>(null);
  const [chatLoading,         setChatLoading]         = useState(false);
  const [transcriptScores,    setTranscriptScores]    = useState<TranscriptScores | null>(null);
  const [improvementRunning,  setImprovementRunning]  = useState(false);
  const [chatFocused,         setChatFocused]         = useState(false);
  const [expandedSessions,    setExpandedSessions]    = useState<Set<string>>(new Set());
  const [attackSuite,         setAttackSuite]         = useState<AttackSuiteItem[]>([]);
  const [autoLoopActive,      setAutoLoopActive]      = useState(false);
  const [autoLoopCycle,       setAutoLoopCycle]       = useState(0);
  const [autoLoopRunning,     setAutoLoopRunning]     = useState(false);
  const [expandedGridSession, setExpandedGridSession] = useState<Set<string>>(new Set());

  const improvePollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const improveStartCount = useRef(0);
  const autoLoopActiveRef = useRef(false);
  const autoLoopCycleRef  = useRef(0);

  /* ── Derived ─────────────────────────────────────────── */
  const chartData = useMemo(() => {
    const passRates = dashboard.pass_rate_history || [];
    const sizes     = dashboard.attack_suite_history || [];
    const byCycle   = new Map<number, ChartPoint>();
    passRates.forEach((item) => {
      byCycle.set(item.cycle, { ...(byCycle.get(item.cycle) || { cycle: item.cycle }), passRate: item.pass_rate * 100 });
    });
    sizes.forEach((item) => {
      byCycle.set(item.cycle, { ...(byCycle.get(item.cycle) || { cycle: item.cycle }), suiteSize: item.size });
    });
    return Array.from(byCycle.values()).sort((a, b) => a.cycle - b.cycle);
  }, [dashboard]);

  const cyclesRun = chartData.length;

  const systemStatusColor = useMemo(() => {
    if (!statusInfo) return "zinc";
    const { personality_spec_ready, voice_clone_ready, rag_ready } = statusInfo;
    if (personality_spec_ready && voice_clone_ready && rag_ready) return "green";
    if (personality_spec_ready || voice_clone_ready || rag_ready) return "amber";
    return "red";
  }, [statusInfo]);

  const statusDotColor =
    systemStatusColor === "green" ? C.success
    : systemStatusColor === "amber" ? C.warning
    : systemStatusColor === "red"   ? C.error
    : C.text3;

  const activeRun       = run || dashboard.latest_vanguard_run_summary || null;
  const total           = activeRun?.total || 0;
  const passed          = activeRun?.passed || 0;
  const passRate        = total ? Math.round((passed / total) * 100) : 0;
  const vanguardRunning = !!runId && total > 0 && (passed + (activeRun?.failed || 0)) < total;
  const isFineTuneReady = !!dashboard.adapter_id;

  const statusItems = useMemo(() => [
    { key: "personality", label: "Personality", ready: statusInfo?.personality_spec_ready || false },
    { key: "voice",       label: "Voice",       ready: statusInfo?.voice_clone_ready || false },
    { key: "rag",         label: "RAG",         ready: statusInfo?.rag_ready || false },
    { key: "finetune",    label: "Fine-tune",   ready: isFineTuneReady },
    { key: "vanguard",    label: "Vanguard",    ready: (statusInfo?.vanguard_runs || 0) > 0 },
    { key: "cycles",      label: "Cycles",      ready: (statusInfo?.improvement_cycles || 0) > 0 },
  ], [statusInfo, isFineTuneReady]);

  const worstPersonas = useMemo(() => {
    const byPersona = dashboard.pass_rate_by_persona;
    if (!byPersona) return [];
    return Object.entries(byPersona)
      .map(([persona, stats]) => ({ persona, ...stats }))
      .sort((a, b) => a.pass_rate - b.pass_rate);
  }, [dashboard.pass_rate_by_persona]);

  const buildComplete   = buildStage === "submitted" || completedSteps.length >= BUILD_STEPS.length || !!dashboard.personality_spec;
  const personalitySpec = dashboard.personality_spec as Record<string, unknown> | null | undefined;
  const sessions        = activeRun?.sessions || [];

  function getActiveStepIndex(stage: string | null): number | null {
    if (!stage) return null;
    if (stage.includes("personality")) return 2;
    if (stage.includes("scoring"))     return 3;
    if (stage.includes("voice"))       return 4;
    if (stage.includes("rag"))         return 5;
    if (stage.includes("fine"))        return 6;
    return null;
  }
  const activeStepIdx = getActiveStepIndex(buildStage);

  /* ── API helpers ─────────────────────────────────────── */
  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/status`);
      if (res.ok) { setStatusInfo(await res.json()); setLastUpdated(new Date()); }
    } catch { /* silent */ }
  }
  async function refreshDashboard() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/dashboard`);
      if (res.ok) setDashboard(await res.json());
    } catch { /* silent */ }
  }
  async function fetchTranscriptScores() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/transcript_scores`);
      if (res.ok) setTranscriptScores(await res.json());
    } catch { /* silent */ }
  }
  async function copyToClipboard(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* fallback */ }
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  }
  function scrollTo(id: string) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  /* ── Action handlers ─────────────────────────────────── */
  async function uploadAndBuild() {
    setBusy("build"); setCompletedSteps([]); setError(null);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`${API_BASE}/users/${USER_ID}/ingest`, { method: "POST", body });
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
      }
      setCompletedSteps(["Ingest", "Transcribe"]);
      const res = await fetch(`${API_BASE}/users/${USER_ID}/build`, { method: "POST" });
      setBuildJobId((await res.json()).job_id);
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function callAgent() {
    setBusy("call"); setError(null);
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/call`, { method: "POST" });
      if (!res.ok) throw new Error("Call agent failed");
      setCallInfo(await res.json());
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function launchAttack() {
    setBusy("attack"); setError(null);
    try {
      try {
        const sr = await fetch(`${API_BASE}/users/${USER_ID}/attack_suite`);
        if (sr.ok) setAttackSuite(await sr.json());
      } catch { /* best-effort */ }
      const res = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/run`, { method: "POST" });
      if (!res.ok) throw new Error("Launch attack failed");
      const payload = await res.json();
      setRunId(payload.run_id);
      setRun({ run_id: payload.run_id, total: 0, passed: 0, failed: 0, pass_rate: 0, sessions: [] });
      setExpandedSessions(new Set());
      setExpandedGridSession(new Set());
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  function toggleAutoLoop() {
    const next = !autoLoopActive;
    setAutoLoopActive(next); autoLoopActiveRef.current = next;
    if (!next) { setAutoLoopCycle(0); autoLoopCycleRef.current = 0; setAutoLoopRunning(false); }
  }
  function toggleGridSession(id: string) {
    setExpandedGridSession((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  async function improve() {
    setBusy("improve"); setError(null);
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/improve`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as Record<string, string>).detail || "Improvement cycle failed");
      }
      improveStartCount.current = chartData.length;
      setImprovementRunning(true);
      if (improvePollRef.current) clearInterval(improvePollRef.current);
      improvePollRef.current = setInterval(refreshDashboard, 20000);
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function sendChat() {
    if (!chatMessage.trim() || chatLoading) return;
    setChatLoading(true); setChatResponse(null); setChatLatency(null);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMessage, user_id: USER_ID }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      const data = await res.json();
      setChatResponse(data.response); setChatLatency(data.latency_ms);
    } catch (e) { setError(String(e)); } finally { setChatLoading(false); }
  }

  /* ── Effects ─────────────────────────────────────────── */
  useEffect(() => {
    fetchStatus(); refreshDashboard(); fetchTranscriptScores();
    const st = setInterval(fetchStatus, 30000);
    const dt = setInterval(refreshDashboard, 15000);
    return () => { clearInterval(st); clearInterval(dt); };
  }, []);

  useEffect(() => {
    if (!buildJobId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/users/${USER_ID}/build/status`);
        if (!res.ok) return;
        const status: BuildStatus = await res.json();
        const nxt = new Set(completedSteps);
        if (status.stage.includes("personality")) nxt.add("Extract Personality");
        if (status.stage.includes("scoring") || status.stage.includes("rag") || status.stage.includes("fine") || status.status === "completed") nxt.add("Score Transcripts");
        if (status.stage.includes("voice")) nxt.add("Configure Voice");
        if (status.stage.includes("rag"))   nxt.add("Build RAG");
        if (status.stage.includes("fine"))  nxt.add("Fine-tune");
        if (status.status === "completed")  BUILD_STEPS.forEach((s) => nxt.add(s));
        setCompletedSteps(Array.from(nxt));
        setBuildStage(status.stage);
        if (status.status === "completed" || status.status === "failed") {
          window.clearInterval(timer); refreshDashboard(); fetchStatus();
          if (status.status === "completed") fetchTranscriptScores();
        }
      } catch { /* silent */ }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [buildJobId, completedSteps]);

  useEffect(() => {
    if (!runId) return;
    const pollUrl = `${API_BASE}/users/${USER_ID}/vanguard/runs/${runId}/live` as const;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(pollUrl);
        if (!res.ok) return;
        const live: LiveResponse = await res.json();
        if (live.sessions.length > 0 || live.expected_total > 0) {
          setRun((prev) => {
            const base = prev || { run_id: runId, total: 0, passed: 0, failed: 0, pass_rate: 0 };
            const ps   = live.sessions.filter((s) => s.status === "passed").length;
            const fs   = live.sessions.filter((s) => s.status === "failed").length;
            return {
              ...base,
              sessions:  live.sessions,
              total:     live.expected_total || live.sessions.length,
              passed: ps, failed: fs,
              pass_rate: live.sessions.length > 0 ? ps / live.sessions.length : 0,
            };
          });
        }
        if (live.complete) {
          window.clearInterval(timer); setRunId(null); refreshDashboard(); fetchStatus();
          const ps   = live.sessions.filter((s) => s.status === "passed").length;
          const rate = live.sessions.length > 0 ? ps / live.sessions.length : 0;
          if (autoLoopActiveRef.current && rate < 0.8 && autoLoopCycleRef.current < 5) {
            autoLoopCycleRef.current += 1;
            setAutoLoopCycle(autoLoopCycleRef.current); setAutoLoopRunning(true);
            setTimeout(async () => {
              try { await fetch(`${API_BASE}/users/${USER_ID}/vanguard/improve`, { method: "POST" }); } catch { /* best-effort */ }
              setTimeout(async () => {
                if (!autoLoopActiveRef.current) { setAutoLoopRunning(false); return; }
                try {
                  const r = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/run`, { method: "POST" });
                  if (r.ok) {
                    const p = await r.json();
                    setRun({ run_id: p.run_id, total: 0, passed: 0, failed: 0, pass_rate: 0, sessions: [] });
                    setExpandedGridSession(new Set()); setRunId(p.run_id); refreshDashboard();
                  }
                } catch { /* best-effort */ }
                setAutoLoopRunning(false);
              }, 22000);
            }, 1500);
          } else {
            setAutoLoopRunning(false);
            if (autoLoopCycleRef.current >= 5 || rate >= 0.8) { setAutoLoopActive(false); autoLoopActiveRef.current = false; }
          }
        }
      } catch { /* silent */ }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [runId]);

  useEffect(() => {
    if (improvementRunning && chartData.length > improveStartCount.current) {
      setImprovementRunning(false);
      if (improvePollRef.current) { clearInterval(improvePollRef.current); improvePollRef.current = null; }
    }
  }, [improvementRunning, chartData.length]);

  useEffect(() => {
    return () => { if (improvePollRef.current) clearInterval(improvePollRef.current); };
  }, []);

  /* ════════════════ RENDER ════════════════════════════════ */
  return (
    <div
      className={`${inter.className} ${firaCode.variable}`}
      style={{ minHeight: "100vh", display: "flex", background: C.bg, color: C.text }}
    >
      {/* ── SIDEBAR ─────────────────────────────────────── */}
      <aside style={{
        width: 220, position: "fixed", top: 0, left: 0, bottom: 0,
        background: C.card, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", padding: "20px 12px", zIndex: 50,
      }}>
        {/* Brand */}
        <div style={{ padding: "4px 12px 24px" }}>
          <div style={{
            fontSize: 14, fontWeight: 800, letterSpacing: "0.18em",
            background: `linear-gradient(90deg,${C.brandLt},${C.brand})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            marginBottom: 3,
          }}>
            FORGE
          </div>
          <div style={{ fontSize: 10, color: C.text3, letterSpacing: "0.04em" }}>
            Voice Agent Infrastructure
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {SIDEBAR_NAV.map(({ id, label, Icon }) => {
            const isActive = activeSection === id;
            return (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 9,
                  padding: "9px 12px", fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? C.text : C.text2,
                  background: isActive ? "rgba(124,58,237,0.13)" : "transparent",
                  borderRadius: 8, border: "none", cursor: "pointer",
                  textAlign: "left", position: "relative",
                  transition: "all 0.15s",
                }}
              >
                {isActive && (
                  <div style={{
                    position: "absolute", left: 0, top: 6, bottom: 6, width: 3,
                    background: `linear-gradient(180deg,${C.brandLt},${C.brand})`,
                    borderRadius: "0 3px 3px 0",
                  }} />
                )}
                <Icon size={14} color={isActive ? C.brandLt : C.text3} />
                {label}
              </button>
            );
          })}
        </nav>

        {/* Status footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: statusDotColor,
              boxShadow: `0 0 8px ${statusDotColor}`,
              animation: systemStatusColor === "green" ? "pulse-dot 2s ease-in-out infinite" : "none",
            }} />
            <span style={{ fontSize: 11, color: C.text2, fontWeight: 500 }}>
              {systemStatusColor === "green" ? "All Systems Ready"
               : systemStatusColor === "amber" ? "Partial Setup"
               : systemStatusColor === "red"   ? "Not Configured"
               : "Checking…"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.text3 }}>
            <Clock size={9} />
            <span style={{ fontFamily: C.mono }}>{formatTime(lastUpdated)}</span>
          </div>
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────────────── */}
      <main style={{ marginLeft: 220, flex: 1, padding: "36px 52px", maxWidth: 1180 }}>

        {/* Error toast */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: C.errorBg, border: `1px solid ${C.errorBd}`,
                color: "#FCA5A5", padding: "10px 16px", borderRadius: 8, marginBottom: 24,
                fontSize: 13, boxShadow: "0 4px 20px rgba(239,68,68,0.12)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={14} color={C.error} />
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} style={{ background: "transparent", border: "none", color: "#FCA5A5", cursor: "pointer", padding: 0, marginLeft: 12 }}>
                <XCircle size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ══════════════ BUILD ══════════════════════════ */}
        <section id="build" style={{ marginBottom: 64, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: "linear-gradient(135deg,rgba(124,58,237,0.25),rgba(124,58,237,0.08))",
                border: "1px solid rgba(124,58,237,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Zap size={15} color={C.brandLt} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}>Build</h2>
                <p style={{ fontSize: 11, color: C.text3, margin: 0, marginTop: 2 }}>Ingest transcripts → train your agent</p>
              </div>
            </div>
            <PrimaryBtn onClick={uploadAndBuild} disabled={!files.length || busy === "build"}>
              {busy === "build" ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              Start Build
            </PrimaryBtn>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files || [])]); }}
            style={{
              border: `2px dashed ${isDragging ? C.brand : "#1B2F4A"}`,
              background: isDragging ? "rgba(124,58,237,0.05)" : "linear-gradient(180deg,#0D1222,#080C18)",
              borderRadius: 12, minHeight: 136,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: 24, marginBottom: 20,
              transition: "all 0.2s",
              boxShadow: isDragging ? `0 0 0 4px ${C.brandGlow}` : "none",
            }}
          >
            <label htmlFor="file-input" style={{ cursor: "pointer", width: "100%", textAlign: "center" }}>
              {files.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
                  {files.map((file, i) => (
                    <span key={i} style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: C.cardUp, border: `1px solid ${C.border}`,
                      padding: "4px 10px", borderRadius: 6, fontSize: 12, color: C.text,
                    }}>
                      {file.name}
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeFile(i); }}
                        style={{ background: "transparent", border: "none", color: C.text3, cursor: "pointer", padding: 0, display: "inline-flex" }}
                      >
                        <XCircle size={12} />
                      </button>
                    </span>
                  ))}
                  <span style={{ fontSize: 12, color: C.brandLt, cursor: "pointer" }}>+ Add more</span>
                </div>
              ) : (
                <div>
                  <UploadCloud size={28} color={C.text3} style={{ marginBottom: 10 }} />
                  <div style={{ fontSize: 13, color: C.text2, marginBottom: 4 }}>Drop audio, text, CSV, JSON, EML, PDF, or DOCX</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>or click to browse</div>
                </div>
              )}
            </label>
          </div>
          <input
            id="file-input" className="sr-only" type="file" multiple
            accept="audio/*,.txt,.eml,.json,.csv,.pdf,.docx"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
          />

          {/* Pipeline stepper */}
          <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 24 }}>
            {BUILD_STEPS.map((step, i) => {
              const done     = completedSteps.includes(step);
              const isActive = !done && activeStepIdx === i;
              const isLast   = i === BUILD_STEPS.length - 1;
              return (
                <React.Fragment key={step}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: done ? `linear-gradient(135deg,${C.brandLt},${C.brand})` : isActive ? C.warningBg : C.card,
                      border: `2px solid ${done ? C.brand : isActive ? C.warning : C.border}`,
                      boxShadow: done ? `0 0 10px ${C.brandGlow}` : "none",
                      transition: "all 0.3s", flexShrink: 0,
                    }}>
                      {done ? <CheckCircle2 size={13} color="#fff" />
                        : isActive ? <Loader2 size={12} color={C.warning} className="animate-spin" />
                        : <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.border }} />}
                    </div>
                    <span style={{
                      fontSize: 10, textAlign: "center", whiteSpace: "nowrap",
                      color: done ? C.text : isActive ? C.warning : C.text3,
                      transition: "color 0.3s", maxWidth: 72,
                      overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {step}
                    </span>
                  </div>
                  {!isLast && (
                    <div style={{
                      flex: 1, height: 2, marginTop: 12, marginBottom: 20,
                      background: done ? `linear-gradient(90deg,${C.brand},rgba(124,58,237,0.4))` : C.border,
                      transition: "background 0.4s",
                    }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Status grid */}
          {statusInfo && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 20 }}>
              {statusItems.map((item) => (
                <div key={item.key} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: item.ready ? C.successBg : C.card,
                  border: `1px solid ${item.ready ? C.successBd : C.border}`,
                  borderRadius: 8, padding: "10px 14px", transition: "all 0.3s",
                }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: item.ready ? C.success : C.text3,
                    boxShadow: item.ready ? "0 0 7px rgba(34,197,94,0.5)" : "none",
                    flexShrink: 0,
                    animation: item.ready ? "pulse-ring 2.5s ease-in-out infinite" : "none",
                  }} />
                  <span style={{ fontSize: 12, color: item.ready ? "#D4FAE5" : C.text2, flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: 10, color: item.ready ? C.success : C.text3, fontFamily: C.mono, fontWeight: 600 }}>
                    {item.ready ? "ready" : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Build results */}
          {buildComplete && personalitySpec && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 20 }}>
              <Card>
                <SectionLabel>Personality</SectionLabel>
                {[
                  ["Formality", (personalitySpec.communication_style as Record<string,unknown>)?.formality],
                  ["Hedging",   (personalitySpec.communication_style as Record<string,unknown>)?.hedging_frequency],
                  ["Humor",     (personalitySpec.communication_style as Record<string,unknown>)?.humor_style],
                ].map(([lbl, val]) => val != null ? (
                  <div key={String(lbl)} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: C.text2 }}>{String(lbl)}</span>
                    <span style={{ color: C.text, fontFamily: C.mono, fontSize: 11 }}>{String(val)}</span>
                  </div>
                ) : null)}
                {(() => {
                  const domains = personalitySpec.knowledge_domains;
                  let txt = "—";
                  if (Array.isArray(domains)) txt = (domains as Array<{domain:string}>).slice(0,2).map(d=>d.domain).join(", ");
                  if (typeof domains === "string") txt = domains;
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: C.text2 }}>Domains</span>
                      <span style={{ color: C.text, fontFamily: C.mono, fontSize: 11 }}>{txt}</span>
                    </div>
                  );
                })()}
              </Card>
              <Card>
                <SectionLabel>Gemini Voice</SectionLabel>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: C.text2 }}>Voice</span>
                  <span style={{ color: C.text, fontFamily: C.mono, fontSize: 11 }}>{dashboard.gemini_voice || "Puck"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: C.text2 }}>Runtime</span>
                  <span style={{ color: C.success, fontWeight: 600, fontSize: 11 }}>Gemini Live</span>
                </div>
              </Card>
              <Card>
                <SectionLabel>RAG</SectionLabel>
                <div style={{ fontSize: 12, fontWeight: 600, color: statusInfo?.rag_ready ? C.success : C.text3 }}>
                  {statusInfo?.rag_ready ? "Knowledge base ready" : "Not ready"}
                </div>
              </Card>
              <Card>
                <SectionLabel>Fine-tune</SectionLabel>
                <div style={{ fontSize: 12 }}>
                  {dashboard.adapter_id
                    ? <span style={{ fontFamily: C.mono, fontSize: 11, color: C.success }}>{dashboard.adapter_id.slice(0,26)}…</span>
                    : <span style={{ color: C.text3 }}>Base model (no fine-tune)</span>}
                </div>
              </Card>
            </div>
          )}

          {/* Transcript quality */}
          {transcriptScores && (
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <SectionLabel>Transcript Quality</SectionLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                  <span style={{ color: C.text2 }}>
                    Overall:&nbsp;
                    <span style={{ color: C.success, fontWeight: 700, fontFamily: C.mono }}>
                      {Math.round(transcriptScores.aggregate_score * 10)}%
                    </span>
                  </span>
                  <span style={{ fontSize: 10, color: C.text3, fontFamily: C.mono }}>
                    {transcriptScores.top_k_turns?.length ?? 0} golden segs
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                {Object.entries(transcriptScores.dimension_scores).map(([dim, score]) => {
                  const pct   = Math.round((score / 10) * 100);
                  const color = pct >= 70 ? C.success : pct >= 40 ? C.warning : C.error;
                  const label = DIMENSION_LABELS[dim] || dim.replace(/_/g," ").replace(/\b\w/g,(c)=>c.toUpperCase());
                  return (
                    <div key={dim} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: C.text3, marginBottom: 4, lineHeight: 1.3 }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: C.mono, lineHeight: 1, marginBottom: 6 }}>
                        {pct}%
                      </div>
                      <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg,${color}80,${color})`, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </section>

        {/* ══════════════ AGENT ══════════════════════════ */}
        <section id="agent" style={{ marginBottom: 64, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: "linear-gradient(135deg,rgba(34,197,94,0.2),rgba(34,197,94,0.06))",
                border: "1px solid rgba(34,197,94,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Phone size={15} color={C.success} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}>Agent</h2>
                <p style={{ fontSize: 11, color: C.text3, margin: 0, marginTop: 2 }}>Connect via phone or browser</p>
              </div>
            </div>
            <GreenBtn onClick={callAgent} disabled={busy === "call"}>
              {busy === "call" ? <Loader2 size={13} className="animate-spin" /> : <Phone size={13} />}
              Call Agent
            </GreenBtn>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Card>
              <div style={{ fontSize: 10, color: C.text3, marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: C.mono }}>
                Phone Number
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22, fontFamily: C.mono, fontWeight: 600, color: C.text, letterSpacing: "0.05em" }}>
                  {callInfo?.phone_number || <span style={{ color: C.text3 }}>—</span>}
                </span>
                {callInfo?.phone_number && (
                  <button onClick={() => copyToClipboard(callInfo.phone_number, "phone")} style={{ background: "transparent", border: "none", color: C.text3, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Copy size={13} />
                    {copiedText === "phone" && <span style={{ fontSize: 10, color: C.success, fontFamily: C.mono }}>copied</span>}
                  </button>
                )}
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: 10, color: C.text3, marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: C.mono }}>
                Room URL
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontFamily: C.mono, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {callInfo?.room_url || <span style={{ color: C.text3 }}>—</span>}
                </span>
                {callInfo?.room_url && (
                  <>
                    <button onClick={() => copyToClipboard(callInfo.room_url, "room")} style={{ background: "transparent", border: "none", color: C.text3, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Copy size={13} />
                      {copiedText === "room" && <span style={{ fontSize: 10, color: C.success, fontFamily: C.mono }}>copied</span>}
                    </button>
                    <a href={callInfo.room_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: C.brandLt, textDecoration: "none" }}>
                      <LinkIcon size={13} /> Open
                    </a>
                  </>
                )}
              </div>
            </Card>
          </div>

          {/* Chat widget */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <SectionLabel>Live Chat Test</SectionLabel>
              <span style={{ fontSize: 10, color: C.text3 }}>Direct NVIDIA NIM · no caching</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                onFocus={() => setChatFocused(true)}
                onBlur={() => setChatFocused(false)}
                placeholder="Type a message and press Enter…"
                style={{
                  flex: 1, background: C.bg,
                  border: `1px solid ${chatFocused ? C.brand : C.border}`,
                  borderRadius: 8, padding: "9px 14px", fontSize: 13, color: C.text, outline: "none",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                  boxShadow: chatFocused ? `0 0 0 3px ${C.brandGlow}` : "none",
                }}
              />
              <PrimaryBtn onClick={sendChat} disabled={!chatMessage.trim() || chatLoading}>
                {chatLoading ? <Loader2 size={13} className="animate-spin" /> : "Send"}
              </PrimaryBtn>
            </div>
            <AnimatePresence>
              {chatResponse && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 13, lineHeight: 1.6, color: C.text }}>
                    {chatResponse}
                    {chatLatency !== null && (
                      <div style={{ marginTop: 8, fontSize: 10, color: C.text3, fontFamily: C.mono }}>{chatLatency}ms</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </section>

        {/* ══════════════ VANGUARD ═══════════════════════ */}
        <section id="vanguard" style={{ marginBottom: 64, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: "linear-gradient(135deg,rgba(239,68,68,0.2),rgba(239,68,68,0.06))",
                border: "1px solid rgba(239,68,68,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Shield size={15} color={C.error} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}>Vanguard</h2>
                <p style={{ fontSize: 11, color: C.text3, margin: 0, marginTop: 2 }}>Adversarial red-team testing</p>
              </div>
              {vanguardRunning && <div className="live-badge"><div className="live-dot" />LIVE</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={toggleAutoLoop}
                title={autoLoopActive ? "Auto-loop ON" : "Enable auto-improvement loop"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: autoLoopActive ? C.warningBg : "transparent",
                  border: `1px solid ${autoLoopActive ? C.warning : C.border}`,
                  color: autoLoopActive ? C.warning : C.text2,
                  fontSize: 12, fontWeight: 500, padding: "7px 12px",
                  borderRadius: 8, cursor: "pointer", transition: "all 0.2s",
                }}
              >
                <Activity size={13} />
                Auto-loop {autoLoopActive ? "ON" : "OFF"}
              </button>
              <PrimaryBtn onClick={launchAttack} disabled={busy === "attack"}>
                {busy === "attack" ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
                Launch Attack
              </PrimaryBtn>
            </div>
          </div>

          {/* Stats bar */}
          {total > 0 && (
            <Card style={{ display: "flex", alignItems: "center", gap: 20, padding: "14px 20px", marginBottom: 16 }}>
              <PassRateRing rate={passRate} size={68} />
              <div>
                <div style={{
                  fontSize: 32, fontWeight: 800, fontFamily: C.mono, lineHeight: 1,
                  color: passRate >= 80 ? C.success : passRate >= 50 ? C.warning : C.error,
                }}>
                  {passRate}%
                </div>
                <div style={{ fontSize: 12, color: C.text2, marginTop: 4 }}>
                  {passed} of {total} passed
                  {vanguardRunning && (
                    <span style={{ color: C.warning, marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Loader2 size={11} className="animate-spin" />
                      {passed + (activeRun?.failed || 0)}/{total} done
                    </span>
                  )}
                </div>
              </div>
              {dashboard.attack_suite_size != null && dashboard.attack_suite_size > 0 && (
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.text, fontFamily: C.mono }}>{dashboard.attack_suite_size}</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>attack variants</div>
                </div>
              )}
            </Card>
          )}

          {/* Auto-loop banner */}
          <AnimatePresence>
            {(autoLoopRunning || (autoLoopActive && autoLoopCycle > 0)) && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: C.warningBg, border: `1px solid ${C.warningBd}`,
                  borderRadius: 8, padding: "10px 16px", marginBottom: 16,
                }}
              >
                <Loader2 size={13} className="animate-spin" color={C.warning} />
                <span style={{ fontSize: 13, color: "#FCD34D" }}>
                  Auto-improving — cycle {autoLoopCycle}/5
                  {autoLoopRunning && !vanguardRunning ? " · running improvement cycle…" : ""}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Attack grid */}
          {(sessions.length > 0 || attackSuite.length > 0 || (runId && total > 0)) ? (
            <VanguardGrid
              suite={attackSuite} sessions={sessions} expectedTotal={total}
              expandedSessions={expandedGridSession} onToggleSession={toggleGridSession}
            />
          ) : (
            <Card style={{ padding: 48, textAlign: "center" }}>
              <Shield size={32} style={{ color: C.text3, marginBottom: 12 }} />
              <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>
                No sessions yet. Click &ldquo;Launch Attack&rdquo; to begin adversarial testing.
              </p>
            </Card>
          )}

          {/* Worst personas */}
          {worstPersonas.length > 0 && (
            <Card style={{ marginTop: 16 }}>
              <SectionLabel>Weakest Attack Categories</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {worstPersonas.map((item) => {
                  const pName   = PERSONA_NAMES[item.persona] || item.persona;
                  const ratePct = Math.round(item.pass_rate * 100);
                  const color   = ratePct >= 60 ? C.success : ratePct >= 30 ? C.warning : C.error;
                  return (
                    <div key={item.persona} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                      <span style={{ width: 140, color: C.text, flexShrink: 0 }}>{pName}</span>
                      <span style={{ color: C.text3, width: 68, flexShrink: 0, fontFamily: C.mono, fontSize: 11 }}>{item.passed}/{item.runs}</span>
                      <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
                        <div style={{ width: `${ratePct}%`, height: "100%", background: `linear-gradient(90deg,${color}60,${color})`, borderRadius: 2, transition: "width 0.5s" }} />
                      </div>
                      <span style={{ color, width: 34, textAlign: "right", fontFamily: C.mono, fontSize: 11, fontWeight: 700 }}>{ratePct}%</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </section>

        {/* ══════════════ IMPROVEMENT ════════════════════ */}
        <section id="improvement" style={{ marginBottom: 64, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: `linear-gradient(135deg,rgba(124,58,237,0.2),rgba(124,58,237,0.06))`,
                border: `1px solid rgba(124,58,237,0.25)`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <TrendingUp size={15} color={C.brandLt} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}>Improvement Curve</h2>
                <p style={{ fontSize: 11, color: C.text3, margin: 0, marginTop: 2 }}>
                  {cyclesRun} cycle{cyclesRun !== 1 ? "s" : ""} run
                </p>
              </div>
            </div>
            <PrimaryBtn onClick={improve} disabled={busy === "improve"}>
              {busy === "improve" ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
              Run Cycle
            </PrimaryBtn>
          </div>

          <AnimatePresence>
            {improvementRunning && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: C.warningBg, border: `1px solid ${C.warningBd}`,
                  borderRadius: 8, padding: "10px 16px", marginBottom: 16,
                }}
              >
                <Loader2 size={13} className="animate-spin" color={C.warning} />
                <span style={{ fontSize: 13, color: "#FCD34D" }}>
                  Improvement cycle running — results will appear when complete.
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {chartData.length > 0 ? (
            <>
              <Card style={{ height: 296, padding: 20, marginBottom: 14 }}>
                <ImprovementChartNoSsr data={chartData} />
              </Card>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {chartData.map((point) => {
                  const histItem  = dashboard.pass_rate_history?.find((h) => h.cycle === point.cycle);
                  const regPassed = histItem?.regression_passed;
                  const pr        = point.passRate != null ? Math.round(point.passRate) : null;
                  const prColor   = pr == null ? C.text3 : pr >= 80 ? C.success : pr >= 50 ? C.warning : C.error;
                  return (
                    <div key={point.cycle} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12,
                    }}>
                      <span style={{ color: C.text3, fontFamily: C.mono, fontSize: 11 }}>Cycle {point.cycle}</span>
                      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                        {regPassed !== undefined && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: regPassed ? C.success : C.error, fontSize: 11, fontFamily: C.mono }}>
                            Gate {regPassed ? "✓" : "✗"}
                          </span>
                        )}
                        <span style={{ color: prColor, fontFamily: C.mono, fontWeight: 700 }}>
                          {pr != null ? `${pr}%` : "—"} pass
                        </span>
                        <span style={{ color: C.text3, fontFamily: C.mono, fontSize: 11 }}>
                          {point.suiteSize ?? "—"} variants
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <Card style={{ padding: 56, textAlign: "center" }}>
              <TrendingUp size={32} style={{ color: C.text3, marginBottom: 12 }} />
              <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>
                No improvement cycles yet. Run Vanguard first, then run a cycle to see hardening progress.
              </p>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
