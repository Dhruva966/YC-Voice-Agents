"use client";

import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Fira_Code } from "next/font/google";
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


const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const API_KEY = process.env.NEXT_PUBLIC_FORGE_API_KEY || "";
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
  unauthorized_commitment: "Unauthorized Commitment",
  pii_exfiltration:       "PII Exfiltration",
  social_engineer:       "Social Engineer",
  jailbreaker:           "Jailbreaker",
  emotional_escalator:   "Emotional Escalator",
  identity_attacker:     "Identity Attacker",
  knowledge_prober:      "Knowledge Prober",
  language_switcher:     "Language Switcher",
  contradiction_trapper: "Contradiction Trapper",
  degraded_audio:        "Degraded Audio",
};

const DISPLAY_PERSONA_LIMIT = 9;

const SIDEBAR_NAV = [
  { id: "build",       label: "Build",       Icon: Zap },
  { id: "agent",       label: "Live Call",   Icon: Phone },
  { id: "vanguard",    label: "Robustness",  Icon: Shield },
] as const;

function withApiKey(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (API_KEY) headers.set("X-API-Key", API_KEY);
  return { ...init, headers };
}

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
  attack_definition_id?: string;
  attack_persona:    string;
  status:            string;
  overall_score?:    number;
  duration_seconds?: number;
  room_url?:          string;
  evaluation?:       Evaluation;
  transcript?:       { turns?: TranscriptTurn[] };
};
type VanguardRun = {
  run_id: string; total: number; passed: number; failed: number;
  pass_rate: number; sessions?: VanguardSession[];
};
type SystemStatus = {
  personality_spec_ready: boolean; instant_spec_ready: boolean; voice_clone_ready: boolean; rag_ready: boolean;
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
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
      color: "var(--clay)", textTransform: "uppercase", marginBottom: 10,
      fontFamily: "var(--font-mono)",
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
  const clr  = rate >= 80 ? "var(--status-green)" : rate >= 50 ? "var(--status-amber)" : "var(--status-red)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
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
        <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="cycle"
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis yAxisId="left" orientation="left" domain={[0, 100]}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          axisLine={false} tickLine={false}
          tickFormatter={(v) => `${v}%`} />
        <YAxis yAxisId="right" orientation="right" domain={["auto", "auto"]}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, color: "var(--ink)", fontSize: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
          }}
          labelStyle={{ color: "var(--ink-3)", marginBottom: 4 }}
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
        />
        <Line yAxisId="left" type="monotone" dataKey="passRate" name="Pass Rate %"
          stroke="var(--clay)" strokeWidth={2.5}
          dot={{ r: 4, fill: "var(--clay)", stroke: "var(--surface)", strokeWidth: 2 }}
          activeDot={{ r: 6, fill: "var(--clay-deep)", stroke: "var(--surface)", strokeWidth: 2 }} />
        <Line yAxisId="right" type="monotone" dataKey="suiteSize" name="Attack Variants"
          stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="5 3"
          dot={{ r: 3, fill: "var(--ink-2)", strokeWidth: 0 }} />
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
          background: active ? color : "var(--border)",
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
  const color = value >= 70 ? "var(--status-green)" : value >= 40 ? "var(--status-amber)" : "var(--status-red)";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: "var(--surface-2)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)", padding: "3px 8px", fontSize: 11,
    }}>
      <span style={{ color: "var(--ink-3)" }}>{label}:</span>
      <span style={{ color, fontWeight: 600, fontFamily: "var(--font-mono)" }}>{value}%</span>
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

  const borderColor = isPassed  ? "var(--status-green)"
    : isFailed  ? "var(--status-red)"
    : isRunning ? "var(--clay)"
    : "var(--border)";
  const glowAnim = isPassed  ? "glow-green  2.8s ease-in-out infinite"
    : isFailed  ? "glow-red   2.8s ease-in-out infinite"
    : isRunning ? "glow-purple 2.8s ease-in-out infinite"
    : "none";

  const statusColor = isPassed ? "var(--status-green)"
    : isFailed ? "var(--status-red)"
    : isRunning ? "var(--clay-deep)"
    : "var(--ink-3)";
  const statusBg = isPassed ? "color-mix(in srgb, var(--status-green) 15%, transparent)"
    : isFailed ? "color-mix(in srgb, var(--status-red) 15%, transparent)"
    : isRunning ? "var(--clay-tint)"
    : "var(--surface-2)";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        onClick={hasTx ? onToggle : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: hover && hasTx && isDone ? "var(--surface-2)"
            : "var(--surface)",
          border: `${isDone || isRunning ? 1.5 : 1}px solid ${borderColor}`,
          borderRadius: "var(--radius-lg)", padding: 14,
          cursor: hasTx ? "pointer" : "default",
          animation: `vg-pop-in 0.32s ease-out ${index * 60}ms both, ${glowAnim}`,
          transition: "background 0.2s, border-color 0.4s",
          display: "flex", flexDirection: "column", gap: 10,
          minHeight: 148,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3, flex: 1 }}>
            {personaName}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
            background: statusBg, color: statusColor, flexShrink: 0, letterSpacing: "0.04em",
            fontFamily: "var(--font-mono)",
          }}>
            {status}
          </span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
          {(isRunning || isDone) && session ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, color: "var(--ink-3)", width: 72, flexShrink: 0, letterSpacing: "0.06em", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>ATTACKER</span>
                <Waveform color="var(--status-amber)" active={isRunning} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, color: "var(--ink-3)", width: 72, flexShrink: 0, letterSpacing: "0.06em", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>AGENT</span>
                <Waveform color="var(--clay)" active={isRunning} />
              </div>
            </>
          ) : (
            <div style={{ display: "flex", gap: 5, justifyContent: "center", paddingTop: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--border)" }} />
              ))}
            </div>
          )}
        </div>

        {isDone && score !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 3, background: "var(--surface-2)", borderRadius: 2 }}>
              <div style={{
                width: `${score}%`, height: "100%", borderRadius: 2,
                background: isPassed ? "var(--status-green)" : "var(--status-red)",
                transition: "width 0.7s cubic-bezier(.23,1,.32,1)",
              }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--ink-2)", width: 32, textAlign: "right", fontFamily: "var(--font-mono)" }}>{score}%</span>
            {session?.duration_seconds && (
              <span style={{ fontSize: 10, color: "var(--ink-3)", width: 26, fontFamily: "var(--font-mono)" }}>
                {Math.round(session.duration_seconds)}s
              </span>
            )}
          </div>
        )}

        {isDone && hasTx && (
          <div style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronDown size={10} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            {isExpanded ? "Hide transcript" : "View transcript"}
          </div>
        )}

        {isRunning && session?.room_url && (
          <a
            href={session.room_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 10, color: "var(--clay)", textDecoration: "none",
              fontFamily: "var(--font-mono)",
            }}
          >
            <LinkIcon size={10} /> Listen live
          </a>
        )}
        {isDone && session?.room_url && (
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 10, color: "var(--ink-3)", textDecoration: "none",
              fontFamily: "var(--font-mono)",
            }}
          >
            <Clock size={10} /> Ended
          </span>
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
              background: "var(--surface-2)", border: "1px solid var(--border)", borderTop: "none",
              borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", padding: 12,
              maxHeight: 260, overflowY: "auto",
            }}>
              {session.evaluation?.dimension_scores && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                  <ScorePill label="Consistency" value={session.evaluation.dimension_scores.character_consistency} />
                  <ScorePill label="Jailbreak"   value={session.evaluation.dimension_scores.jailbreak_resistance} />
                  <ScorePill label="Factual"     value={session.evaluation.dimension_scores.factual_accuracy} />
                  <ScorePill label="Degrade"     value={session.evaluation.dimension_scores.graceful_degradation} />
                  {session.evaluation.provider && (
                    <span style={{ fontSize: 10, color: "var(--ink-3)", display: "flex", alignItems: "center", fontFamily: "var(--font-mono)" }}>
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
                      fontSize: 9, color: isAtk ? "var(--status-amber)" : "var(--ink-3)", marginBottom: 2,
                      letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono)",
                    }}>
                      {isAtk ? "ATTACKER" : "AGENT"}
                    </span>
                    <div style={{
                      fontSize: 11, color: "var(--ink)", lineHeight: 1.5,
                      background: isAtk ? "color-mix(in srgb, var(--status-amber) 8%, var(--surface))" : "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)", padding: "5px 10px", maxWidth: "90%",
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
  suite, sessions, expandedSessions, onToggleSession,
}: {
  suite: AttackSuiteItem[];
  sessions: VanguardSession[];
  expandedSessions: Set<string>;
  onToggleSession: (id: string) => void;
}) {
  type Slot = { personaName: string; session: VanguardSession | null; key: string };
  let slots: Slot[];

  if (suite.length > 0) {
    const suiteSessionMap = new Map<string, VanguardSession>();
    sessions.forEach((session) => {
      suiteSessionMap.set(session.session_id, session);
      if (session.attack_definition_id) suiteSessionMap.set(session.attack_definition_id, session);
    });
    slots = suite.map((item) => ({
      key:         item.session_id,
      personaName: PERSONA_NAMES[item.attack_persona] || item.attack_persona,
      session:     suiteSessionMap.get(item.session_id) ?? null,
    }));
    sessions.forEach((s) => {
      if (!slots.find((sl) => sl.key === s.session_id))
        slots.push({ key: s.session_id, personaName: PERSONA_NAMES[s.attack_persona] || s.attack_persona, session: s });
    });
  } else {
    slots = sessions.map((s) => ({
      key: s.session_id, personaName: PERSONA_NAMES[s.attack_persona] || s.attack_persona, session: s,
    }));
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
  const [ingestMode,          setIngestMode]          = useState<"files" | "text">("files");
  const [rawTranscriptText,   setRawTranscriptText]   = useState("");
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
    systemStatusColor === "green" ? "var(--status-green)"
    : systemStatusColor === "amber" ? "var(--status-amber)"
    : systemStatusColor === "red"   ? "var(--status-red)"
    : "var(--ink-3)";

  const activeRun       = run || dashboard.latest_vanguard_run_summary || null;
  const total           = activeRun?.total || 0;
  const passed          = activeRun?.passed || 0;
  const passRate        = total ? Math.round((passed / total) * 100) : 0;
  const vanguardRunning = !!runId && total > 0 && (passed + (activeRun?.failed || 0)) < total;
  const isFineTuneReady = !!dashboard.adapter_id;
  const agentReady = !!statusInfo?.personality_spec_ready;

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
  const hasBuildInput   = ingestMode === "files" ? files.length > 0 : rawTranscriptText.trim().length > 0;
  const transcriptHighlights = transcriptScores?.top_k_turns?.slice(0, 3) || [];
  const displayAttackSuite = useMemo(() => attackSuite.slice(0, DISPLAY_PERSONA_LIMIT), [attackSuite]);
  const displaySessions = useMemo(() => sessions.slice(0, DISPLAY_PERSONA_LIMIT), [sessions]);
  const robustnessScore = passRate;
  const priorPoint = chartData.length > 1 ? chartData[chartData.length - 2] : null;
  const robustnessDelta = priorPoint?.passRate != null ? Math.round(robustnessScore - priorPoint.passRate) : null;
  const projectedGoal = Math.max(95, robustnessScore);

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
      const res = await fetch(`${API_BASE}/users/${USER_ID}/status`, withApiKey());
      if (res.ok) { setStatusInfo(await res.json()); setLastUpdated(new Date()); }
    } catch { /* silent */ }
  }
  async function refreshDashboard() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/dashboard`, withApiKey());
      if (res.ok) setDashboard(await res.json());
    } catch { /* silent */ }
  }
  async function fetchBuildStatus() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/build/status`, withApiKey());
      if (!res.ok) return;
      const status: BuildStatus = await res.json();
      if (!status?.job_id) return;
      setBuildJobId(status.job_id);
      setBuildStage(status.stage || null);
      if (status.status === "completed") {
        setCompletedSteps(BUILD_STEPS);
      } else if (status.status === "failed" && status.error) {
        setError(status.error);
      }
    } catch { /* silent */ }
  }
  async function fetchTranscriptScores() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/transcript_scores`, withApiKey());
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
      const uploads = ingestMode === "text"
        ? [new File([rawTranscriptText], "pasted_transcript.txt", { type: "text/plain" })]
        : files;
      for (const file of uploads) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`${API_BASE}/users/${USER_ID}/ingest`, withApiKey({ method: "POST", body }));
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
      }
      setCompletedSteps(["Ingest", "Transcribe"]);
      const res = await fetch(`${API_BASE}/users/${USER_ID}/build`, withApiKey({ method: "POST" }));
      setBuildJobId((await res.json()).job_id);
      setFiles([]);
      if (ingestMode === "text") setRawTranscriptText("");
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function callAgent() {
    setBusy("call"); setError(null);
    if (!agentReady) {
      setBusy(null);
      setError("Build must complete before starting the live demo call.");
      return;
    }
    const roomWindow = window.open("", "_blank", "noopener,noreferrer");
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/call?mode=robust`, withApiKey({ method: "POST" }));
      if (!res.ok) throw new Error("Call agent failed");
      const payload = await res.json();
      setCallInfo(payload);
      if (roomWindow && payload.room_url) {
        roomWindow.location.href = payload.room_url;
      } else if (payload.room_url) {
        window.open(payload.room_url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      roomWindow?.close();
      setError(String(e));
    } finally { setBusy(null); }
  }
  async function launchAttack() {
    setBusy("attack"); setError(null);
    try {
      try {
        const sr = await fetch(`${API_BASE}/users/${USER_ID}/attack_suite`, withApiKey());
        if (sr.ok) setAttackSuite(await sr.json());
      } catch { /* best-effort */ }
      const res = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/run`, withApiKey({ method: "POST" }));
      if (!res.ok) throw new Error("Launch attack failed");
      const payload = await res.json();
      setRunId(payload.run_id);
      setRun({ run_id: payload.run_id, total: 0, passed: 0, failed: 0, pass_rate: 0, sessions: [] });
      setExpandedSessions(new Set());
      setExpandedGridSession(new Set());
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function runRobustnessLoop() {
    setAutoLoopActive(true);
    autoLoopActiveRef.current = true;
    autoLoopCycleRef.current = 0;
    setAutoLoopCycle(0);
    await launchAttack();
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
      const res = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/improve`, withApiKey({ method: "POST" }));
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
      const res = await fetch(`${API_BASE}/chat`, withApiKey({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMessage, user_id: USER_ID, mode: "robust" }),
      }));
      if (!res.ok) throw new Error("Chat request failed");
      const data = await res.json();
      setChatResponse(data.response); setChatLatency(data.latency_ms);
    } catch (e) { setError(String(e)); } finally { setChatLoading(false); }
  }

  /* ── Effects ─────────────────────────────────────────── */
  useEffect(() => {
    fetchStatus(); refreshDashboard(); fetchTranscriptScores(); fetchBuildStatus();
    const st = setInterval(fetchStatus, 30000);
    const dt = setInterval(refreshDashboard, 15000);
    return () => { clearInterval(st); clearInterval(dt); };
  }, []);

  useEffect(() => {
    if (!buildJobId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/users/${USER_ID}/build/status`, withApiKey());
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
        const res = await fetch(pollUrl, withApiKey());
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
              try { await fetch(`${API_BASE}/users/${USER_ID}/vanguard/improve`, withApiKey({ method: "POST" })); } catch { /* best-effort */ }
              setTimeout(async () => {
                if (!autoLoopActiveRef.current) { setAutoLoopRunning(false); return; }
                try {
                  const r = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/run`, withApiKey({ method: "POST" }));
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
      className="bg-paper text-ink"
      style={{ minHeight: "100vh", display: "flex" }}
    >
      <style>{`
        @keyframes vg-pop-in {
          from { opacity: 0; transform: scale(0.88) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);   }
        }
        @keyframes vg-wave-a { 0%,100% { height: 3px;  } 50% { height: 18px; } }
        @keyframes vg-wave-b { 0%,100% { height: 5px;  } 50% { height: 14px; } }
        @keyframes vg-wave-c { 0%,100% { height: 2px;  } 50% { height: 20px; } }
        @keyframes vg-wave-d { 0%,100% { height: 6px;  } 50% { height: 12px; } }

        @keyframes vg-glow-green {
          0%,100% { box-shadow: 0 0 8px rgba(62,122,69,0.12); }
          50%      { box-shadow: 0 0 22px rgba(62,122,69,0.28); }
        }
        @keyframes vg-glow-red {
          0%,100% { box-shadow: 0 0 8px rgba(181,67,43,0.12); }
          50%      { box-shadow: 0 0 22px rgba(181,67,43,0.28); }
        }
        @keyframes glow-green {
          0%,100% { box-shadow: 0 0 8px rgba(62,122,69,0.12); }
          50%      { box-shadow: 0 0 22px rgba(62,122,69,0.28); }
        }
        @keyframes glow-red {
          0%,100% { box-shadow: 0 0 8px rgba(181,67,43,0.12); }
          50%      { box-shadow: 0 0 22px rgba(181,67,43,0.28); }
        }
        @keyframes glow-purple {
          0%,100% { box-shadow: 0 0 8px rgba(180,90,53,0.12); }
          50%      { box-shadow: 0 0 22px rgba(180,90,53,0.28); }
        }
        @keyframes pulse-dot {
          0%,100% { opacity: 1; transform: scale(1);   }
          50%      { opacity: 0.5; transform: scale(0.7); }
        }
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(62,122,69,0.35); }
          70%  { box-shadow: 0 0 0 8px rgba(62,122,69,0); }
          100% { box-shadow: 0 0 0 0 rgba(62,122,69,0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .forge-btn-primary { display:inline-flex; align-items:center; gap:6px; background:var(--clay); color:#fff; font-size:13px; font-weight:600; padding:8px 16px; border-radius:var(--radius-sm); border:none; cursor:pointer; transition:background 0.15s; }
        .forge-btn-primary:hover { background:var(--clay-deep); }
        .forge-btn-primary:disabled { opacity:0.45; cursor:not-allowed; }

        .forge-btn-secondary { display:inline-flex; align-items:center; gap:6px; background:var(--surface); color:var(--ink-2); font-size:13px; font-weight:500; padding:8px 14px; border-radius:var(--radius-sm); border:1px solid var(--border); cursor:pointer; transition:background 0.15s; }
        .forge-btn-secondary:hover { background:var(--surface-2); }
        .forge-btn-secondary.active { background:var(--clay-tint); border-color:var(--clay); color:var(--clay-deep); }

        .forge-btn-success { display:inline-flex; align-items:center; gap:6px; background:var(--status-green); color:#fff; font-size:13px; font-weight:600; padding:8px 16px; border-radius:var(--radius-sm); border:none; cursor:pointer; }
        .forge-btn-success:disabled { opacity:0.45; cursor:not-allowed; }

        .forge-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:16px; }
        .forge-section-label { font-family:var(--font-mono),ui-monospace,monospace; font-size:10px; letter-spacing:0.15em; color:var(--clay); font-weight:600; margin-bottom:10px; }
        .forge-textarea { width:100%; height:280px; resize:vertical; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:12px 14px; font-size:12px; font-family:var(--font-mono),ui-monospace,monospace; color:var(--ink); line-height:1.6; outline:none; transition:border-color 0.15s; }
        .forge-textarea:focus { border-color:var(--clay); }
        .forge-input { flex:1; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 12px; font-size:13px; color:var(--ink); outline:none; transition:border-color 0.15s; }
        .forge-input:focus { border-color:var(--clay); background:var(--surface); }
        .forge-nav-btn { display: flex; align-items: center; gap: 9px; padding: 9px 12px; font-size: 13px; color: var(--ink-2); background: transparent; border-radius: var(--radius-sm); border: none; cursor: pointer; text-align: left; transition: all 0.15s; width: 100%; }
        .forge-nav-btn:hover { background: var(--surface); color: var(--ink); }
        .forge-nav-btn.active { background: var(--clay-tint); color: var(--clay-deep); font-weight: 600; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
      `}</style>
      {/* ── SIDEBAR ─────────────────────────────────────── */}
      <aside style={{
        width: 244, position: "fixed", top: 0, left: 0, bottom: 0,
        background: "var(--surface-2)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", padding: "20px 16px", zIndex: 50,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 24, padding: "0 8px" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--ink)" }}>
            FORGE
          </span>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--clay)" }} />
        </div>

        {/* Nav */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {SIDEBAR_NAV.map(({ id, label, Icon }) => {
            const isActive = activeSection === id;
            return (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className={`forge-nav-btn ${isActive ? "active" : ""}`}
              >
                <Icon size={14} color={isActive ? "var(--clay-deep)" : "var(--ink-3)"} />
                {label}
              </button>
            );
          })}
        </nav>

        {/* Status footer */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: statusDotColor,
              boxShadow: `0 0 8px ${statusDotColor}`,
              animation: systemStatusColor === "green" ? "pulse-dot 2s ease-in-out infinite" : "none",
            }} />
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
              {systemStatusColor === "green" ? "All Systems Ready"
               : systemStatusColor === "amber" ? "Partial Setup"
               : systemStatusColor === "red"   ? "Not Configured"
               : "Checking…"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
            <Clock size={9} />
            <span>{formatTime(lastUpdated)}</span>
          </div>
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────────────── */}
      <main style={{ marginLeft: 244, flex: 1, padding: "36px 52px", maxWidth: 1180 }}>

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
                background: "var(--surface)", border: "1.5px solid var(--status-red)",
                color: "var(--status-red)", padding: "10px 16px", borderRadius: "var(--radius-md)", marginBottom: 24,
                fontSize: 13, boxShadow: "0 4px 20px rgba(181,67,43,0.12)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={14} color="var(--status-red)" />
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} style={{ background: "transparent", border: "none", color: "var(--status-red)", cursor: "pointer", padding: 0, marginLeft: 12 }}>
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
                background: "var(--clay-tint)",
                border: "1px solid rgba(180, 90, 53, 0.35)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Zap size={15} color="var(--clay-deep)" />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--ink)", margin: 0, lineHeight: 1.2, letterSpacing: "-0.01em" }}>Build</h2>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", margin: 0, marginTop: 2 }}>Ingest transcripts · extract personality · build retrieval · prepare runtime</p>
              </div>
            </div>
            <button
              onClick={uploadAndBuild}
              disabled={!hasBuildInput || busy === "build"}
              className="forge-btn-primary"
            >
              {busy === "build" ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              Start Build
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setIngestMode("files")}
              className={`forge-btn-secondary ${ingestMode === "files" ? "active" : ""}`}
            >
              Upload Files
            </button>
            <button
              onClick={() => setIngestMode("text")}
              className={`forge-btn-secondary ${ingestMode === "text" ? "active" : ""}`}
            >
              Paste Transcript
            </button>
            <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
              {ingestMode === "files" ? "Supports text, audio, CSV, JSON, PDF, and DOCX" : "Paste CALLER:/AGENT: transcript text directly"}
            </span>
          </div>

          {ingestMode === "files" ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files || [])]); }}
              style={{
                border: `2px dashed ${isDragging ? "var(--clay)" : "var(--border)"}`,
                background: isDragging ? "var(--clay-tint)" : "var(--surface-2)",
                borderRadius: "var(--radius-lg)", minHeight: 136,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                padding: 24, marginBottom: 20,
                transition: "all 0.2s",
                boxShadow: isDragging ? "0 0 0 4px rgba(180,90,53,0.15)" : "none",
              }}
            >
              <label htmlFor="file-input" style={{ cursor: "pointer", width: "100%", textAlign: "center" }}>
                {files.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
                    {files.map((file, i) => (
                      <span key={i} style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        background: "var(--surface)", border: "1px solid var(--border)",
                        padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--ink)",
                      }}>
                        {file.name}
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeFile(i); }}
                          style={{ background: "transparent", border: "none", color: "var(--ink-3)", cursor: "pointer", padding: 0, display: "inline-flex" }}
                        >
                          <XCircle size={12} />
                        </button>
                      </span>
                    ))}
                    <span style={{ fontSize: 12, color: "var(--clay)", fontWeight: 600, cursor: "pointer" }}>+ Add more</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <UploadCloud size={28} color="var(--clay)" style={{ marginBottom: 10 }} />
                    <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 500, marginBottom: 4 }}>Drop audio, text, CSV, JSON, EML, PDF, or DOCX</div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>or click to browse</div>
                  </div>
                )}
              </label>
            </div>
          ) : (
            <div className="forge-card" style={{ padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 10 }}>Paste call transcripts (CALLER: / AGENT: format)</div>
              <textarea
                value={rawTranscriptText}
                onChange={(e) => setRawTranscriptText(e.target.value)}
                placeholder={"CALLER: Hi, I’m calling about my loan options.\nAGENT: Absolutely, I can walk you through that."}
                className="forge-textarea"
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                  {rawTranscriptText.trim() ? `${rawTranscriptText.trim().split(/\s+/).length} words ready for ingest` : "No transcript text pasted yet"}
                </span>
                <button
                  onClick={() => setRawTranscriptText("")}
                  disabled={!rawTranscriptText}
                  className="forge-btn-secondary"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
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
                      background: done ? "var(--clay)" : "var(--surface-2)",
                      border: done ? "none" : isActive ? "none" : "1px solid var(--border)",
                      boxShadow: isActive ? "0 0 0 2px var(--status-amber)" : "none",
                      transition: "all 0.3s", flexShrink: 0,
                    }}>
                      {done ? <CheckCircle2 size={13} color="#fff" />
                        : isActive ? <Loader2 size={12} color="var(--status-amber)" className="animate-spin" />
                        : <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--border)" }} />}
                    </div>
                    <span style={{
                      fontSize: 11, textAlign: "center", whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      color: done ? "var(--ink)" : "var(--ink-3)",
                      transition: "color 0.3s", maxWidth: 72,
                      overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {step}
                    </span>
                  </div>
                  {!isLast && (
                    <div style={{
                      flex: 1, height: 2, marginTop: 12, marginBottom: 20,
                      background: "var(--border)",
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
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", padding: "8px 12px", transition: "all 0.3s",
                }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: item.ready ? "var(--status-green)" : "var(--ink-3)",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, color: item.ready ? "var(--ink)" : "var(--ink-3)", flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: 10, color: item.ready ? "var(--status-green)" : "var(--ink-3)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                    {item.ready ? "ready" : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12, marginBottom: 20 }}>
            <div className="forge-card">
              <div className="forge-section-label">BUILD STATUS</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>
                {buildStage ? buildStage.replace(/_/g, " ") : "Not started"}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {buildJobId
                  ? `Job ${buildJobId.slice(0, 8)} is ${buildComplete ? "complete" : "running"}${buildStage ? ` at ${buildStage}.` : "."}`
                  : "No build has been started yet. Upload files or paste a transcript to generate real artifacts."}
              </div>
            </div>
            <div className="forge-card">
              <div className="forge-section-label">REAL DATA COVERAGE</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {[
                  { label: "Transcript Score", ready: !!transcriptScores },
                  { label: "Personality Spec", ready: !!personalitySpec },
                  { label: "Vanguard Results", ready: (statusInfo?.vanguard_runs || 0) > 0 },
                ].map((item) => (
                  <div key={item.label} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: item.ready ? "var(--status-green)" : "var(--ink-3)" }}>
                      {item.ready ? "Available" : "No real data yet"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Build results */}
          {personalitySpec ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 20 }}>
              <div className="forge-card">
                <div className="forge-section-label">Personality</div>
                {[
                  ["Formality", (personalitySpec.communication_style as Record<string,unknown>)?.formality],
                  ["Hedging",   (personalitySpec.communication_style as Record<string,unknown>)?.hedging_frequency],
                  ["Humor",     (personalitySpec.communication_style as Record<string,unknown>)?.humor_style],
                ].map(([lbl, val]) => val != null ? (
                  <div key={String(lbl)} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12, color: "var(--ink-2)" }}>
                    <span>{String(lbl)}</span>
                    <span style={{ color: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{String(val)}</span>
                  </div>
                ) : null)}
                {(() => {
                  const domains = personalitySpec.knowledge_domains;
                  let txt = "—";
                  if (Array.isArray(domains)) txt = (domains as Array<{domain:string}>).slice(0,2).map(d=>d.domain).join(", ");
                  if (typeof domains === "string") txt = domains;
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-2)" }}>
                      <span>Domains</span>
                      <span style={{ color: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{txt}</span>
                    </div>
                  );
                })()}
              </div>
              <div className="forge-card">
                <div className="forge-section-label">Gemini Voice</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12, color: "var(--ink-2)" }}>
                  <span>Voice</span>
                  <span style={{ color: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{dashboard.gemini_voice || "Puck"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-2)" }}>
                  <span>Runtime</span>
                  <span style={{ color: "var(--status-green)", fontWeight: 600, fontSize: 11 }}>Gemini Live</span>
                </div>
              </div>
              <div className="forge-card">
                <div className="forge-section-label">RAG</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: statusInfo?.rag_ready ? "var(--status-green)" : "var(--ink-3)" }}>
                  {statusInfo?.rag_ready ? "Knowledge base ready" : "Not ready"}
                </div>
              </div>
              <div className="forge-card">
                <div className="forge-section-label">Fine-tune</div>
                <div style={{ fontSize: 12 }}>
                  {dashboard.adapter_id
                    ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--status-green)" }}>{dashboard.adapter_id.slice(0,26)}…</span>
                    : <span style={{ color: "var(--ink-3)" }}>Base model (no fine-tune)</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="forge-card" style={{ marginBottom: 20 }}>
              <div className="forge-section-label">COMPUTED BUILD ARTIFACTS</div>
              <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 }}>
                No personality, retrieval, or runtime artifacts have been generated yet. This section will populate after a real build completes.
              </div>
            </div>
          )}

          {/* Transcript quality */}
          {transcriptScores ? (
            <div className="forge-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div className="forge-section-label">TRANSCRIPT QUALITY</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                  <span style={{ color: "var(--ink-2)" }}>
                    Overall:&nbsp;
                    <span style={{ color: "var(--status-green)", fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {Math.round(transcriptScores.aggregate_score * 10)}%
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                    {transcriptScores.top_k_turns?.length ?? 0} golden segs
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                {Object.entries(transcriptScores.dimension_scores).map(([dim, score]) => {
                  const pct   = Math.round((score / 10) * 100);
                  const color = pct >= 70 ? "var(--status-green)" : pct >= 40 ? "var(--status-amber)" : "var(--status-red)";
                  const label = DIMENSION_LABELS[dim] || dim.replace(/_/g," ").replace(/\b\w/g,(c)=>c.toUpperCase());
                  return (
                    <div key={dim} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.04em", marginBottom: 4, lineHeight: 1.3 }}>{label}</div>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color, lineHeight: 1, marginBottom: 6 }}>
                        {pct}%
                      </div>
                      <div style={{ height: 3, background: "var(--border)", borderRadius: 2 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg,${color}80,${color})`, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {transcriptHighlights.length > 0 && (
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  {transcriptHighlights.map((turn, index) => (
                    <div key={`${turn.aggregate}-${index}`} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 10 }}>
                      <div style={{ fontSize: 10, color: "var(--clay)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
                        Highlight {index + 1} · {Math.round(turn.aggregate * 10)}%
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 6 }}>
                        <strong>Caller:</strong> {turn.caller}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
                        <strong>Agent:</strong> {turn.agent}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="forge-card">
              <div className="forge-section-label">TRANSCRIPT QUALITY</div>
              <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 }}>
                No transcript scoring data yet. Once a real transcript is ingested and scored, this section will show the computed quality dimensions and strongest transcript segments.
              </div>
            </div>
          )}
        </section>

        {/* ══════════════ AGENT ══════════════════════════ */}
        <section id="agent" style={{ marginBottom: 64, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: "color-mix(in srgb, var(--status-green) 12%, var(--surface))",
                border: "1px solid color-mix(in srgb, var(--status-green) 30%, transparent)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Phone size={15} color="var(--status-green)" />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--ink)", margin: 0, lineHeight: 1.2 }}>Agent</h2>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", margin: 0, marginTop: 2 }}>Voice call interface · live chat test</p>
              </div>
            </div>
            <button
              onClick={callAgent}
              disabled={busy === "call" || !agentReady}
              className={agentReady ? "forge-btn-success" : "forge-btn-primary"}
            >
              {busy === "call" ? <Loader2 size={13} className="animate-spin" /> : <Phone size={13} />}
              Live Demo Call
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.8fr", gap: 12, marginBottom: 16 }}>
            <div className="forge-card">
              <div className="forge-section-label">LIVE AGENT STATUS</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: agentReady ? "var(--status-green)" : "var(--ink)", marginBottom: 8 }}>
                {agentReady ? "Ready for transcript-trained live call" : "Build required before live call"}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
                {agentReady
                  ? "The Gemini Live harness is configured from your transcript-derived persona and retrieval context."
                  : "Paste a transcript and run the build. Once personality extraction and retrieval are ready, the call room becomes your live demo surface."}
              </div>
            </div>
            <div className="forge-card">
              <div className="forge-section-label">RETRIEVAL</div>
              <div style={{ fontSize: 12, color: statusInfo?.rag_ready ? "var(--status-green)" : "var(--ink-3)", lineHeight: 1.6 }}>
                {statusInfo?.rag_ready ? "Knowledge base built and ready." : "No retrieval index has been built yet."}
              </div>
            </div>
            <div className="forge-card">
              <div className="forge-section-label">PERSONALITY</div>
              <div style={{ fontSize: 12, color: (statusInfo?.vanguard_runs || 0) > 0 ? "var(--ink)" : "var(--ink-3)", lineHeight: 1.6 }}>
                {personalitySpec ? "Transcript personality extracted and applied to the live harness." : "No transcript-derived personality spec yet."}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div className="forge-card">
              <div className="forge-section-label">PHONE NUMBER</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22, fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--ink)", letterSpacing: "0.05em" }}>
                  {callInfo?.phone_number || <span style={{ color: "var(--ink-3)" }}>—</span>}
                </span>
                {callInfo?.phone_number && (
                  <button onClick={() => copyToClipboard(callInfo.phone_number, "phone")} style={{ background: "transparent", border: "none", color: "var(--ink-3)", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Copy size={13} />
                    {copiedText === "phone" && <span style={{ fontSize: 10, color: "var(--status-green)", fontFamily: "var(--font-mono)" }}>copied</span>}
                  </button>
                )}
              </div>
            </div>
            <div className="forge-card">
              <div className="forge-section-label">ROOM URL</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {callInfo?.room_url || <span style={{ color: "var(--ink-3)" }}>—</span>}
                </span>
                {callInfo?.room_url && (
                  <>
                    <button onClick={() => copyToClipboard(callInfo.room_url, "room")} style={{ background: "transparent", border: "none", color: "var(--ink-3)", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Copy size={13} />
                      {copiedText === "room" && <span style={{ fontSize: 10, color: "var(--status-green)", fontFamily: "var(--font-mono)" }}>copied</span>}
                    </button>
                    <a href={callInfo.room_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--clay)", textDecoration: "none" }}>
                      <LinkIcon size={13} /> Open
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Chat widget */}
          <div className="forge-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div className="forge-section-label">LIVE CHAT TEST</div>
              <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>Direct NVIDIA NIM · no caching</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                placeholder={agentReady ? "Type a message and press Enter…" : "Run the build first to test the live harness."}
                disabled={!agentReady}
                className="forge-input"
              />
              <button
                onClick={sendChat}
                disabled={!chatMessage.trim() || chatLoading || !agentReady}
                className="forge-btn-primary"
              >
                {chatLoading ? <Loader2 size={13} className="animate-spin" /> : "Send"}
              </button>
            </div>
            <AnimatePresence>
              {chatResponse && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, fontSize: 13, lineHeight: 1.6, color: "var(--ink)" }}>
                    {chatResponse}
                    {chatLatency !== null && (
                      <div style={{ marginTop: 8, fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{chatLatency}ms</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ══════════════ VANGUARD ═══════════════════════ */}
        <section id="vanguard" style={{ marginBottom: 64, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: "color-mix(in srgb, var(--status-red) 12%, var(--surface))",
                border: "1px solid color-mix(in srgb, var(--status-red) 30%, transparent)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Shield size={15} color="var(--status-red)" />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--ink)", margin: 0, lineHeight: 1.2 }}>Robustness Loop</h2>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", margin: 0, marginTop: 2 }}>Adversarial attacks + continuous improvement</p>
              </div>
              {vanguardRunning && <div className="live-badge"><div className="live-dot" />LIVE</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={runRobustnessLoop}
                disabled={busy === "attack" || busy === "improve"}
                className="forge-btn-primary"
              >
                {(busy === "attack" || busy === "improve") ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
                Run Robustness Improvement Loop
              </button>
            </div>
          </div>

          {/* Stats bar */}
          {total > 0 && (
            <div className="forge-card" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", alignItems: "center", gap: 20, padding: "14px 20px", marginBottom: 16 }}>
              <PassRateRing rate={passRate} size={68} />
              <div>
                <div style={{
                  fontSize: 32, fontWeight: 800, fontFamily: "var(--font-mono)", lineHeight: 1,
                  color: robustnessScore >= 60 ? "var(--status-green)" : "var(--status-red)",
                }}>
                  {robustnessScore}%
                </div>
                <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: robustnessScore >= 60 ? "var(--status-green)" : "var(--status-red)", marginTop: 4 }}>
                  {passed} of {total} passed
                  {vanguardRunning && (
                    <span style={{ color: "var(--status-amber)", fontFamily: "var(--font-mono)", fontSize: 12, marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Loader2 size={11} className="animate-spin" />
                      {passed + (activeRun?.failed || 0)}/{total} done
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: robustnessDelta != null && robustnessDelta >= 0 ? "var(--status-green)" : "var(--status-red)", fontFamily: "var(--font-mono)" }}>
                  {robustnessDelta == null ? "—" : `${robustnessDelta > 0 ? "+" : ""}${robustnessDelta}`}
                </div>
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>delta vs last run</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{cyclesRun}</div>
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>improvement cycles</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{displayAttackSuite.length}</div>
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>visible personas</div>
              </div>
            </div>
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
                  background: "var(--clay-tint)", border: "1px solid rgba(180,90,53,0.3)",
                  borderRadius: "var(--radius-md)", padding: "10px 16px", marginBottom: 16,
                }}
              >
                <Loader2 size={13} className="animate-spin" color="var(--clay)" />
                <span style={{ fontSize: 13, color: "var(--clay-deep)" }}>
                  Auto-improving — cycle {autoLoopCycle}/5
                  {autoLoopRunning && !vanguardRunning ? " · running improvement cycle…" : ""}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Attack grid */}
          {(displaySessions.length > 0 || displayAttackSuite.length > 0 || (runId && total > 0)) ? (
            <VanguardGrid
              suite={displayAttackSuite} sessions={displaySessions}
              expandedSessions={expandedGridSession} onToggleSession={toggleGridSession}
            />
          ) : (
            <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", padding: 48, textAlign: "center" }}>
              <Shield size={32} style={{ color: "var(--ink-3)", marginBottom: 12, display: "inline-block" }} />
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
                No robustness sessions yet. Run the loop to launch the 9 demo personas and start measuring robustness.
              </p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, marginTop: 16 }}>
            <div>
              {chartData.length > 0 ? (
                <>
                  <div style={{ height: 288, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, marginBottom: 14 }}>
                    <ImprovementChartNoSsr data={chartData} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {chartData.map((point) => {
                      const histItem  = dashboard.pass_rate_history?.find((h) => h.cycle === point.cycle);
                      const regPassed = histItem?.regression_passed;
                      const pr        = point.passRate != null ? Math.round(point.passRate) : null;
                      return (
                        <div key={point.cycle} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "8px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12,
                        }}>
                          <span style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>Cycle {point.cycle}</span>
                          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                            {regPassed !== undefined && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: regPassed ? "var(--status-green)" : "var(--status-red)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                                Gate {regPassed ? "✓" : "✗"}
                              </span>
                            )}
                            <span style={{ color: "var(--clay)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                              {pr != null ? `${pr}%` : "—"} robust
                            </span>
                            <span style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                              {point.suiteSize ?? "—"} variants
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", padding: 56, textAlign: "center" }}>
                  <TrendingUp size={32} style={{ color: "var(--ink-3)", marginBottom: 12, display: "inline-block" }} />
                  <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
                    No robustness history yet. This graph will show adversarial pass rate climbing over repeated loop runs.
                  </p>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="forge-card">
                <div className="forge-section-label">ROBUSTNESS SCORE</div>
                <div style={{ fontSize: 44, fontWeight: 800, color: robustnessScore >= 80 ? "var(--status-green)" : robustnessScore >= 60 ? "var(--status-amber)" : "var(--status-red)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {robustnessScore}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
                  Latest measured adversarial pass rate. This is the headline metric we want to push from the 80s into the mid 90s.
                </div>
              </div>
              <div className="forge-card">
                <div className="forge-section-label">LOOP EXPLAINS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12, color: "var(--ink-2)" }}>
                  <div><strong>Attack:</strong> 9 attacker personas probe the live voice agent.</div>
                  <div><strong>Evaluate:</strong> Cekura observability + rubric scoring capture failures.</div>
                  <div><strong>Improve:</strong> the next cycle hardens prompts and the attack suite.</div>
                </div>
              </div>
              <div className="forge-card">
                <div className="forge-section-label">TARGET TRAJECTORY</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {[80, 89, 91, 92, projectedGoal].map((value, index) => (
                    <div key={`${value}-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--ink-3)" }}>Run {index + 1}</span>
                      <span style={{ color: value >= robustnessScore ? "var(--ink)" : "var(--status-green)", fontWeight: 700 }}>{value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Worst personas */}
          {worstPersonas.length > 0 && (
            <div className="forge-card" style={{ marginTop: 16 }}>
              <div className="forge-section-label">WEAKEST ATTACK CATEGORIES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {worstPersonas.map((item) => {
                  const pName   = PERSONA_NAMES[item.persona] || item.persona;
                  const ratePct = Math.round(item.pass_rate * 100);
                  const color   = ratePct >= 60 ? "var(--status-green)" : ratePct >= 30 ? "var(--status-amber)" : "var(--status-red)";
                  return (
                    <div key={item.persona} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                      <span style={{ width: 140, color: "var(--ink)", flexShrink: 0 }}>{pName}</span>
                      <span style={{ color: "var(--ink-3)", width: 68, flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11 }}>{item.passed}/{item.runs}</span>
                      <div style={{ flex: 1, height: 5, background: "var(--surface-2)", borderRadius: 2 }}>
                        <div style={{ width: `${ratePct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s" }} />
                      </div>
                      <span style={{ color, width: 34, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}>{ratePct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sessions.length > 0 && sessions.some((session) => (session.evaluation?.failure_annotations || []).length > 0) && (
            <div className="forge-card" style={{ marginTop: 16 }}>
              <div className="forge-section-label">FAILURE ANNOTATIONS</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
                {sessions
                  .filter((session) => (session.evaluation?.failure_annotations || []).length > 0)
                  .slice(0, 4)
                  .map((session) => {
                    const note = session.evaluation?.failure_annotations?.[0];
                    return (
                      <div key={session.session_id} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12 }}>
                        <div style={{ fontSize: 11, color: "var(--clay)", fontWeight: 600, marginBottom: 6 }}>
                          {PERSONA_NAMES[session.attack_persona] || session.attack_persona}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {note ? JSON.stringify(note, null, 2) : "No annotation text available."}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
