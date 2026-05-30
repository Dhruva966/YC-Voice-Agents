"use client";

import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Fira_Code } from "next/font/google";
import { motion, AnimatePresence } from "framer-motion";
import {
  CartesianGrid, Line, LineChart, Radar, RadarChart, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
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
  cekura_run_id?:       string;
  cekura_scenario_id?:  string;
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

/* ─────────── PersonalityConstellation (no-SSR) ─────────── */
function PersonalityConstellation({ scores }: { scores: DimensionScoreCard | null }) {
  const data = useMemo(() => {
    if (!scores) return [];
    return Object.entries(scores).map(([key, val]) => ({
      dimension: DIMENSION_LABELS[key] || key.replace(/_/g, " "),
      abbr: (DIMENSION_LABELS[key] || key).split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 3),
      value: Math.round((val / 10) * 100),
      fullMark: 100,
    }));
  }, [scores]);

  if (!scores || data.length === 0) return null;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: 16, marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div className="forge-section-label">PERSONALITY DIMENSIONS</div>
        <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
          {data.length} dimensions from transcript
        </span>
      </div>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div style={{ flex: "0 0 220px", height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="dimension" tick={{ fill: "var(--ink-3)", fontSize: 9, fontFamily: "var(--font-mono)" }} />
              <Radar name="Score" dataKey="value" stroke="var(--clay)" fill="var(--clay)" fillOpacity={0.18} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {data.map((d) => {
            const color = d.value >= 70 ? "var(--status-green)" : d.value >= 40 ? "var(--status-amber)" : "var(--status-red)";
            return (
              <div key={d.dimension} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  background: `color-mix(in srgb, ${color} 14%, var(--surface-2))`,
                  border: `1.5px solid ${color}55`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 700, fontFamily: "var(--font-mono)", color,
                }}>{d.abbr}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: "var(--ink)", fontWeight: 500 }}>{d.dimension}</span>
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color }}>{d.value}%</span>
                  </div>
                  <div style={{ height: 3, background: "var(--border)", borderRadius: 2 }}>
                    <div style={{ width: `${d.value}%`, height: "100%", background: `linear-gradient(90deg,${color}60,${color})`, borderRadius: 2 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
const PersonalityConstellationNoSsr = dynamic(() => Promise.resolve(PersonalityConstellation), { ssr: false });

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
                    <span style={{ fontSize: 10, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)" }}>
                      via {session.evaluation.provider}
                      {session.evaluation.cekura_run_id && (
                        <a
                          href={`https://dashboard.cekura.ai/call-logs/${session.evaluation.cekura_run_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 10, padding: "1px 6px",
                            background: "rgba(99,102,241,0.12)", color: "#818cf8",
                            borderRadius: 4, border: "1px solid rgba(99,102,241,0.3)",
                            textDecoration: "none", fontFamily: "var(--font-mono)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          ↗ Cekura
                        </a>
                      )}
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

/* ─────────── Transcript Stream Panel ───────────────────── */
function TranscriptStreamPanel({
  turns,
}: {
  turns: Array<{ caller: string; agent: string; aggregate: number }>;
}) {
  if (turns.length === 0) return null;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 20,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--status-green)" }} />
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.12em", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>
            Top-Scored Transcript Turns
          </span>
        </div>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>
          {turns.length} golden segments
        </span>
      </div>
      <div style={{ height: 260, overflowY: "auto", padding: "12px 16px", scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}>
        {turns.map((turn, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 3 }}>
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--status-amber)", letterSpacing: "0.07em", textTransform: "uppercase" }}>CALLER </span>
              <div style={{
                display: "inline-block",
                background: "color-mix(in srgb, var(--status-amber) 7%, var(--surface))",
                border: "1px solid color-mix(in srgb, var(--status-amber) 18%, transparent)",
                borderRadius: "0 var(--radius-sm) var(--radius-sm) var(--radius-sm)",
                padding: "5px 10px", fontSize: 12, color: "var(--ink)", lineHeight: 1.5, maxWidth: "82%",
              }}>{turn.caller}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--clay)", letterSpacing: "0.07em", textTransform: "uppercase" }}>AGENT</span>
              <div style={{
                background: "var(--clay-tint)", border: "1px solid rgba(180,90,53,0.22)",
                borderRadius: "var(--radius-sm) 0 var(--radius-sm) var(--radius-sm)",
                padding: "5px 10px", fontSize: 12, color: "var(--ink)", lineHeight: 1.5, maxWidth: "82%", textAlign: "right",
              }}>{turn.agent}</div>
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", marginTop: 2, color: turn.aggregate >= 7 ? "var(--status-green)" : turn.aggregate >= 4 ? "var(--status-amber)" : "var(--status-red)" }}>
                quality {turn.aggregate.toFixed(1)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────── Battle Arena ───────────────────────────────── */
function BattleArena({ session, isRunning }: { session: VanguardSession | null; isRunning: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);

  const turns = session?.transcript?.turns || [];
  const personaName = session ? (PERSONA_NAMES[session.attack_persona] || session.attack_persona) : "—";
  const isPassed = session?.status === "passed";
  const isFailed = session?.status === "failed";
  const score    = session?.overall_score != null ? Math.round(session.overall_score) : null;

  useEffect(() => {
    if (scrollRef.current && turns.length > prevLen.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLen.current = turns.length;
  }, [turns.length]);

  if (!session) return null;

  const isAtk = (role: string) => role === "caller" || role === "user" || role.toLowerCase() === "attacker";
  const borderColor = isPassed ? "var(--status-green)" : isFailed ? "var(--status-red)" : isRunning ? "rgba(180,90,53,0.45)" : "var(--border)";

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.3 }}
      style={{
        background: "var(--surface)", border: `1.5px solid ${borderColor}`,
        borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 16,
        boxShadow: isRunning ? "0 0 28px rgba(180,90,53,0.07)" : "none",
        transition: "border-color 0.4s, box-shadow 0.4s",
      }}
    >
      {/* Header bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 16px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.12em", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>Battle Arena</span>
          {isRunning && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--status-amber)", fontWeight: 700 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--status-amber)", animation: "pulse-dot 1.2s ease-in-out infinite" }} />
              LIVE
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {score !== null && (
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: isPassed ? "var(--status-green)" : isFailed ? "var(--status-red)" : "var(--ink-3)" }}>
              {score}% score
            </span>
          )}
          {session.duration_seconds && (
            <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{Math.round(session.duration_seconds)}s</span>
          )}
        </div>
      </div>

      {/* Two-agent split */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--border)" }}>
        <div style={{
          padding: "14px 20px", borderRight: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--status-red) 4%, var(--surface))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%",
            background: "color-mix(in srgb, var(--status-red) 12%, var(--surface))",
            border: "1.5px solid color-mix(in srgb, var(--status-red) 35%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🎭</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--status-red)", marginBottom: 1 }}>{personaName}</div>
            <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--ink-3)", letterSpacing: "0.08em" }}>ATTACKER</div>
          </div>
          <Waveform color="var(--status-red)" active={isRunning} />
        </div>
        <div style={{
          padding: "14px 20px",
          background: "color-mix(in srgb, var(--clay) 4%, var(--surface))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%", background: "var(--clay-tint)",
            border: "1.5px solid rgba(180,90,53,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🤖</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--clay-deep)", marginBottom: 1 }}>Forge Agent</div>
            <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--ink-3)", letterSpacing: "0.08em" }}>DEFENDER</div>
          </div>
          <Waveform color="var(--clay)" active={isRunning} />
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} style={{
        height: 224, overflowY: "auto", padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 7,
        scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent",
      }}>
        {turns.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
              {isRunning ? "Waiting for conversation to begin…" : "No transcript available."}
            </span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {turns.map((turn, i) => {
            const attacker = isAtk(turn.role);
            return (
              <motion.div key={`t-${i}`} initial={{ opacity: 0, x: attacker ? -14 : 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }}
                style={{ display: "flex", justifyContent: attacker ? "flex-start" : "flex-end" }}>
                <div style={{
                  maxWidth: "74%",
                  background: attacker ? "color-mix(in srgb, var(--status-red) 8%, var(--surface))" : "var(--clay-tint)",
                  border: attacker ? "1px solid color-mix(in srgb, var(--status-red) 22%, transparent)" : "1px solid rgba(180,90,53,0.24)",
                  borderRadius: attacker ? "0 var(--radius-sm) var(--radius-sm) var(--radius-sm)" : "var(--radius-sm) 0 var(--radius-sm) var(--radius-sm)",
                  padding: "7px 11px", fontSize: 12, color: "var(--ink)", lineHeight: 1.55,
                }}>{turn.text}</div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ═════════════════════════════════════════════════════════ *
 *  MAIN PAGE                                                *
 * ═════════════════════════════════════════════════════════ */
export default function Page() {
  const [userId,              setUserId]              = useState("demo");
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
  const agentReady = systemStatusColor === "green";

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

  const featuredSession = useMemo(() => {
    if (sessions.length === 0) return null;
    const running = sessions.filter((s) => s.status === "running");
    if (running.length > 0) {
      return running.reduce((best, curr) =>
        (curr.transcript?.turns?.length || 0) > (best.transcript?.turns?.length || 0) ? curr : best
      );
    }
    return sessions[sessions.length - 1];
  }, [sessions]);

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
      if (!userId) return;
      const res = await fetch(`${API_BASE}/users/${userId}/status`);
      if (res.ok) { setStatusInfo(await res.json()); setLastUpdated(new Date()); }
    } catch { /* silent */ }
  }
  async function refreshDashboard() {
    try {
      if (!userId) return;
      const res = await fetch(`${API_BASE}/users/${userId}/dashboard`);
      if (res.ok) setDashboard(await res.json());
    } catch { /* silent */ }
  }
  async function fetchTranscriptScores() {
    try {
      if (!userId) return;
      const res = await fetch(`${API_BASE}/users/${userId}/transcript_scores`);
      if (res.ok) setTranscriptScores(await res.json());
    } catch { /* silent */ }
  }

  function switchWorkspace(mode: "demo" | "sandbox") {
    if (mode === "demo") {
      localStorage.setItem("forge_active_workspace", "demo");
      setUserId("demo");
    } else {
      localStorage.setItem("forge_active_workspace", "sandbox");
      let sbId = localStorage.getItem("forge_sandbox_id");
      if (!sbId) {
        sbId = "sb_" + Math.random().toString(36).substring(2, 10);
        localStorage.setItem("forge_sandbox_id", sbId);
      }
      setUserId(sbId);
    }
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
    if (!userId) return;
    setBusy("build"); setCompletedSteps([]); setError(null);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`${API_BASE}/users/${userId}/ingest`, { method: "POST", body });
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
      }
      setCompletedSteps(["Ingest", "Transcribe"]);
      const res = await fetch(`${API_BASE}/users/${userId}/build`, { method: "POST" });
      setBuildJobId((await res.json()).job_id);
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function callAgent() {
    if (!userId) return;
    setBusy("call"); setError(null);
    try {
      const res = await fetch(`${API_BASE}/users/${userId}/call`, { method: "POST" });
      if (!res.ok) throw new Error("Call agent failed");
      setCallInfo(await res.json());
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function launchAttack() {
    if (!userId) return;
    setBusy("attack"); setError(null);
    try {
      try {
        const sr = await fetch(`${API_BASE}/users/${userId}/attack_suite`);
        if (sr.ok) setAttackSuite(await sr.json());
      } catch { /* best-effort */ }
      const res = await fetch(`${API_BASE}/users/${userId}/vanguard/run`, { method: "POST" });
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
    if (!userId) return;
    setBusy("improve"); setError(null);
    try {
      const res = await fetch(`${API_BASE}/users/${userId}/vanguard/improve`, { method: "POST" });
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
    if (!chatMessage.trim() || chatLoading || !userId) return;
    setChatLoading(true); setChatResponse(null); setChatLatency(null);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMessage, user_id: userId }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      const data = await res.json();
      setChatResponse(data.response); setChatLatency(data.latency_ms);
    } catch (e) { setError(String(e)); } finally { setChatLoading(false); }
  }

  /* ── Effects ─────────────────────────────────────────── */
  useEffect(() => {
    const lastActive = localStorage.getItem("forge_active_workspace") || "demo";
    if (lastActive === "demo") {
      setUserId("demo");
    } else {
      const sbId = localStorage.getItem("forge_sandbox_id") || ("sb_" + Math.random().toString(36).substring(2, 10));
      localStorage.setItem("forge_sandbox_id", sbId);
      setUserId(sbId);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    
    // Reset states on workspace switch to avoid leakages
    setCompletedSteps([]);
    setBuildJobId(null);
    setBuildStage(null);
    setCallInfo(null);
    setRunId(null);
    setRun(null);
    setDashboard({});
    setStatusInfo(null);
    setTranscriptScores(null);
    setAttackSuite([]);

    fetchStatus(); refreshDashboard(); fetchTranscriptScores();
    const st = setInterval(fetchStatus, 30000);
    const dt = setInterval(refreshDashboard, 15000);
    return () => { clearInterval(st); clearInterval(dt); };
  }, [userId]);

  useEffect(() => {
    if (!buildJobId || !userId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/users/${userId}/build/status`);
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
  }, [buildJobId, completedSteps, userId]);

  useEffect(() => {
    if (!runId || !userId) return;
    const pollUrl = `${API_BASE}/users/${userId}/vanguard/runs/${runId}/live` as const;
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
              try { await fetch(`${API_BASE}/users/${userId}/vanguard/improve`, { method: "POST" }); } catch { /* best-effort */ }
              setTimeout(async () => {
                if (!autoLoopActiveRef.current) { setAutoLoopRunning(false); return; }
                try {
                  const r = await fetch(`${API_BASE}/users/${userId}/vanguard/run`, { method: "POST" });
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
  }, [runId, userId]);

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
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20, padding: "0 8px" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--ink)" }}>
            FORGE
          </span>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--clay)" }} />
        </div>

        {/* Workspace selector */}
        <div style={{
          display: "flex", background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", padding: 2, marginBottom: 20, gap: 2,
        }}>
          <button
            onClick={() => switchWorkspace("demo")}
            style={{
              flex: 1, border: "none", borderRadius: "calc(var(--radius-sm) - 2px)",
              fontSize: 11, padding: "5px 2px", fontWeight: 600,
              background: userId === "demo" ? "var(--clay-tint)" : "transparent",
              color: userId === "demo" ? "var(--clay-deep)" : "var(--ink-2)",
              cursor: "pointer", transition: "all 0.15s",
              fontFamily: "var(--font-mono)",
            }}
          >
            Demo
          </button>
          <button
            onClick={() => switchWorkspace("sandbox")}
            style={{
              flex: 1, border: "none", borderRadius: "calc(var(--radius-sm) - 2px)",
              fontSize: 11, padding: "5px 2px", fontWeight: 600,
              background: userId !== "demo" ? "var(--clay-tint)" : "transparent",
              color: userId !== "demo" ? "var(--clay-deep)" : "var(--ink-2)",
              cursor: "pointer", transition: "all 0.15s",
              fontFamily: "var(--font-mono)",
            }}
          >
            Sandbox
          </button>
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
            <span suppressHydrationWarning>{formatTime(lastUpdated)}</span>
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
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", margin: 0, marginTop: 2 }}>Ingest transcripts · extract personality · fine-tune</p>
              </div>
            </div>
            <button
              onClick={uploadAndBuild}
              disabled={!files.length || busy === "build"}
              className="forge-btn-primary"
            >
              {busy === "build" ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              Start Build
            </button>
          </div>

          {/* Drop zone */}
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

          {/* Transcript stream panel — only shown when real scored turns exist */}
          {(transcriptScores?.top_k_turns?.length ?? 0) > 0 && (
            <TranscriptStreamPanel turns={transcriptScores!.top_k_turns} />
          )}

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

          {/* Build results */}
          {buildComplete && personalitySpec && (
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
          )}

          {/* Personality constellation */}
          {transcriptScores && (
            <PersonalityConstellationNoSsr scores={transcriptScores.dimension_scores} />
          )}

          {/* Transcript quality */}
          {transcriptScores && (
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
              disabled={busy === "call"}
              className={agentReady ? "forge-btn-success" : "forge-btn-primary"}
            >
              {busy === "call" ? <Loader2 size={13} className="animate-spin" /> : <Phone size={13} />}
              Call Agent
            </button>
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
                placeholder="Type a message and press Enter…"
                className="forge-input"
              />
              <button
                onClick={sendChat}
                disabled={!chatMessage.trim() || chatLoading}
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
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--ink)", margin: 0, lineHeight: 1.2 }}>Vanguard</h2>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", margin: 0, marginTop: 2 }}>Adversarial attack suite · red-team evaluation</p>
              </div>
              {vanguardRunning && <div className="live-badge"><div className="live-dot" />LIVE</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={toggleAutoLoop}
                title={autoLoopActive ? "Auto-loop ON" : "Enable auto-improvement loop"}
                className={`forge-btn-secondary ${autoLoopActive ? "active" : ""}`}
              >
                <Activity size={13} />
                Auto-loop {autoLoopActive ? "ON" : "OFF"}
              </button>
              <button
                onClick={launchAttack}
                disabled={busy === "attack"}
                className="forge-btn-primary"
              >
                {busy === "attack" ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
                Launch Attack
              </button>
            </div>
          </div>

          {/* Stats bar */}
          {total > 0 && (
            <div className="forge-card" style={{ display: "flex", alignItems: "center", gap: 20, padding: "14px 20px", marginBottom: 16 }}>
              <PassRateRing rate={passRate} size={68} />
              <div>
                <div style={{
                  fontSize: 32, fontWeight: 800, fontFamily: "var(--font-mono)", lineHeight: 1,
                  color: passRate >= 60 ? "var(--status-green)" : "var(--status-red)",
                }}>
                  {passRate}%
                </div>
                <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: passRate >= 60 ? "var(--status-green)" : "var(--status-red)", marginTop: 4 }}>
                  {passed} of {total} passed
                  {vanguardRunning && (
                    <span style={{ color: "var(--status-amber)", fontFamily: "var(--font-mono)", fontSize: 12, marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Loader2 size={11} className="animate-spin" />
                      {passed + (activeRun?.failed || 0)}/{total} done
                    </span>
                  )}
                </div>
              </div>
              {dashboard.attack_suite_size != null && dashboard.attack_suite_size > 0 && (
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{dashboard.attack_suite_size}</div>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>attack variants</div>
                </div>
              )}
            </div>
          )}

          {/* Battle arena */}
          <AnimatePresence>
            {featuredSession && (
              <BattleArena
                key={featuredSession.session_id}
                session={featuredSession}
                isRunning={featuredSession.status === "running"}
              />
            )}
          </AnimatePresence>

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
          {(sessions.length > 0 || attackSuite.length > 0 || (runId && total > 0)) ? (
            <VanguardGrid
              suite={attackSuite} sessions={sessions} expectedTotal={total}
              expandedSessions={expandedGridSession} onToggleSession={toggleGridSession}
            />
          ) : (
            <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", padding: 48, textAlign: "center" }}>
              <Shield size={32} style={{ color: "var(--ink-3)", marginBottom: 12, display: "inline-block" }} />
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
                No sessions yet. Click &ldquo;Launch Attack&rdquo; to begin adversarial testing.
              </p>
            </div>
          )}

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
        </section>

        {/* ══════════════ IMPROVEMENT ════════════════════ */}
        <section id="improvement" style={{ marginBottom: 64, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: "var(--clay-tint)",
                border: "1px solid rgba(180, 90, 53, 0.35)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <TrendingUp size={15} color="var(--clay-deep)" />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", margin: 0, fontWeight: 600, lineHeight: 1.2 }}>Improvement Curve</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", margin: 0 }}>RL hardening · pass rate over iterations</p>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-3)" }}>
                    ({cyclesRun} cycle{cyclesRun !== 1 ? "s" : ""} run)
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={improve}
              disabled={busy === "improve"}
              className="forge-btn-primary"
            >
              {busy === "improve" ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
              Run Cycle
            </button>
          </div>

          <AnimatePresence>
            {improvementRunning && (
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
                  Improvement cycle running — results will appear when complete.
                </span>
              </motion.div>
            )}
          </AnimatePresence>

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
                          {pr != null ? `${pr}%` : "—"} pass
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
                No improvement cycles yet. Run Vanguard first, then run a cycle to see hardening progress.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
