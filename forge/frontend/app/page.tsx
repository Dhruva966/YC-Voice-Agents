"use client";

import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Inter } from "next/font/google";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  CheckCircle2, XCircle, Loader2, Phone, Link, Copy, Shield, Zap, Activity, ChevronDown, ChevronRight,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const USER_ID = "demo";

const BUILD_STEPS = ["Ingest", "Transcribe", "Extract Personality", "Score Transcripts", "Clone Voice", "Build RAG", "Fine-tune"];

const PERSONA_NAMES: Record<string, string> = {
  social_engineer: "Social Engineer",
  jailbreaker: "Jailbreaker",
  emotional_escalator: "Emotional Escalator",
  identity_attacker: "Identity Attacker",
  knowledge_prober: "Knowledge Prober",
  language_switcher: "Language Switcher",
  contradiction_trapper: "Contradiction Trapper",
  degraded_audio: "Degraded Audio",
};

type DimensionScores = {
  character_consistency?: number;
  jailbreak_resistance?: number;
  factual_accuracy?: number;
  graceful_degradation?: number;
};

type Evaluation = {
  overall_score: number;
  overall_pass: boolean;
  dimension_scores?: DimensionScores;
  failure_annotations?: Array<Record<string, unknown>>;
  provider?: string;
};

type TranscriptTurn = {
  role: string;
  text: string;
};

type VanguardSession = {
  session_id: string;
  attack_persona: string;
  status: string;
  overall_score?: number;
  duration_seconds?: number;
  evaluation?: Evaluation;
  transcript?: { turns?: TranscriptTurn[] };
};

type VanguardRun = {
  run_id: string;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  sessions?: VanguardSession[];
};

type SystemStatus = {
  personality_spec_ready: boolean;
  voice_clone_ready: boolean;
  rag_ready: boolean;
  vanguard_runs: number;
  improvement_cycles: number;
  attack_suite_size: number;
};

type PassRateHistoryItem = {
  cycle: number;
  pass_rate: number;
  regression_passed?: boolean;
};

type Dashboard = {
  latest_vanguard_run_summary?: VanguardRun | null;
  pass_rate_history?: PassRateHistoryItem[];
  attack_suite_history?: Array<{ cycle: number; size: number }>;
  attack_suite_size?: number;
  voice_id?: string | null;
  adapter_id?: string | null;
  personality_spec?: Record<string, unknown> | null;
  pass_rate_by_persona?: Record<string, { runs: number; passed: number; pass_rate: number }>;
};

type BuildStatus = {
  job_id: string;
  stage: string;
  status: string;
  error?: string;
};

type DimensionScoreCard = {
  empathy: number;
  objection_handling: number;
  naturalness: number;
  conversational_flow: number;
  closing_technique: number;
};

type TranscriptScores = {
  aggregate_score: number;
  dimension_scores: DimensionScoreCard;
  top_k_turns: Array<{ caller: string; agent: string; aggregate: number }>;
};

type ChartPoint = {
  cycle: number;
  passRate?: number;
  suiteSize?: number;
};

type LiveResponse = {
  sessions: VanguardSession[];
  complete: boolean;
  total: number;
  expected_total: number;
};

const SIDEBAR_NAV = [
  { id: "build", label: "Build" },
  { id: "agent", label: "Agent" },
  { id: "vanguard", label: "Vanguard" },
  { id: "improvement", label: "Improvement" },
];

function formatTime(ts: Date): string {
  return ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ImprovementChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#1f1f23" vertical={false} />
        <XAxis dataKey="cycle" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "#1f1f23" }} tickLine={false} />
        <YAxis yAxisId="left" orientation="left" domain={[0, 100]} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "#1f1f23" }} tickLine={false} />
        <YAxis yAxisId="right" orientation="right" domain={["auto", "auto"]} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "#1f1f23" }} tickLine={false} />
        <Tooltip
          contentStyle={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 6, color: "#f4f4f5", fontSize: 12 }}
          labelStyle={{ color: "#71717a" }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#71717a" }} />
        <Line yAxisId="left" type="monotone" dataKey="passRate" name="Pass rate %" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3, fill: "#7c3aed" }} />
        <Line yAxisId="right" type="monotone" dataKey="suiteSize" name="Attack suite size" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2, fill: "#a1a1aa" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const ImprovementChartNoSsr = dynamic(() => Promise.resolve(ImprovementChart), { ssr: false });

export default function Page() {
  const [activeSection, setActiveSection] = useState("build");
  const [files, setFiles] = useState<File[]>([]);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [buildJobId, setBuildJobId] = useState<string | null>(null);
  const [buildStage, setBuildStage] = useState<string | null>(null);
  const [callInfo, setCallInfo] = useState<{ room_url: string; phone_number: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<VanguardRun | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [statusInfo, setStatusInfo] = useState<SystemStatus | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [chatLatency, setChatLatency] = useState<number | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [transcriptScores, setTranscriptScores] = useState<TranscriptScores | null>(null);
  const [improvementRunning, setImprovementRunning] = useState(false);
  const [chatFocused, setChatFocused] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [transcriptOpen, setTranscriptOpen] = useState<Set<string>>(new Set());
  const improvePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const improveStartCountRef = useRef(0);

  const chartData = useMemo(() => {
    const passRates = dashboard.pass_rate_history || [];
    const sizes = dashboard.attack_suite_history || [];
    const byCycle = new Map<number, ChartPoint>();
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

  const statusDotColor = systemStatusColor === "green"
    ? "#22c55e"
    : systemStatusColor === "amber"
    ? "#f59e0b"
    : systemStatusColor === "red"
    ? "#ef4444"
    : "#52525b";

  const activeRun = run || dashboard.latest_vanguard_run_summary || null;
  const total = activeRun?.total || 0;
  const passed = activeRun?.passed || 0;
  const passRate = total ? Math.round((passed / total) * 100) : 0;
  const vanguardRunning = !!runId && total > 0 && (passed + (activeRun?.failed || 0)) < total;

  const isFineTuneReady = !!dashboard.adapter_id;

  const statusItems = useMemo(() => [
    { key: "personality_spec_ready", label: "Personality", ready: statusInfo?.personality_spec_ready || false },
    { key: "voice_clone_ready", label: "Voice Clone", ready: statusInfo?.voice_clone_ready || false },
    { key: "rag_ready", label: "RAG", ready: statusInfo?.rag_ready || false },
    { key: "finetune", label: "Fine-tune", ready: isFineTuneReady },
    { key: "vanguard", label: "Vanguard", ready: (statusInfo?.vanguard_runs || 0) > 0 },
    { key: "cycles", label: "Cycles", ready: (statusInfo?.improvement_cycles || 0) > 0 },
  ], [statusInfo, isFineTuneReady]);

  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/status`);
      if (res.ok) {
        setStatusInfo(await res.json());
        setLastUpdated(new Date());
      }
    } catch {
      // silent fail
    }
  }

  async function refreshDashboard() {
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/dashboard`);
      if (res.ok) {
        setDashboard(await res.json());
      }
    } catch {
      // silent fail
    }
  }

  useEffect(() => {
    fetchStatus();
    refreshDashboard();
    const statusTimer = setInterval(fetchStatus, 30000);
    const dashTimer = setInterval(refreshDashboard, 15000);
    return () => { clearInterval(statusTimer); clearInterval(dashTimer); };
  }, []);

  useEffect(() => {
    if (!buildJobId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/users/${USER_ID}/build/status`);
        if (!res.ok) return;
        const status: BuildStatus = await res.json();
        const nextSteps = new Set(completedSteps);
        if (status.stage.includes("personality")) nextSteps.add("Extract Personality");
        if (status.stage.includes("scoring") || status.stage.includes("rag") || status.stage.includes("fine") || status.status === "completed") nextSteps.add("Score Transcripts");
        if (status.stage.includes("voice")) nextSteps.add("Clone Voice");
        if (status.stage.includes("rag")) nextSteps.add("Build RAG");
        if (status.stage.includes("fine")) nextSteps.add("Fine-tune");
        if (status.status === "completed") BUILD_STEPS.forEach((s) => nextSteps.add(s));
        setCompletedSteps(Array.from(nextSteps));
        setBuildStage(status.stage);
        if (status.status === "completed" || status.status === "failed") {
          window.clearInterval(timer);
          refreshDashboard();
          fetchStatus();
          if (status.status === "completed") {
            fetch(`${API_BASE}/users/${USER_ID}/transcript_scores`).then(r => r.ok ? r.json() : null).then(d => { if (d) setTranscriptScores(d); }).catch(() => {});
          }
        }
      } catch {
        // silent fail
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [buildJobId, completedSteps]);

  useEffect(() => {
    if (!runId) return;
    const pollLive =
      `${API_BASE}/users/${USER_ID}/vanguard/runs/${runId}/live` as const;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(pollLive);
        if (!res.ok) return;
        const live: LiveResponse = await res.json();
        if (live.sessions.length > 0) {
          setRun((prev) => {
            const base = prev || { run_id: runId, total: 0, passed: 0, failed: 0, pass_rate: 0 };
            const ps = live.sessions.filter((s) => s.status === "passed").length;
            const fs = live.sessions.filter((s) => s.status === "failed").length;
            return {
              ...base,
              sessions: live.sessions,
              total: live.expected_total || live.sessions.length,
              passed: ps,
              failed: fs,
              pass_rate: live.sessions.length > 0 ? ps / live.sessions.length : 0,
            };
          });
        }
        if (live.complete) {
          window.clearInterval(timer);
          setRunId(null);
          refreshDashboard();
          fetchStatus();
        }
      } catch {
        // silent fail
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [runId]);

  useEffect(() => {
    if (improvementRunning && chartData.length > improveStartCountRef.current) {
      setImprovementRunning(false);
      if (improvePollRef.current) {
        clearInterval(improvePollRef.current);
        improvePollRef.current = null;
      }
    }
  }, [improvementRunning, chartData.length]);

  useEffect(() => {
    return () => { if (improvePollRef.current) clearInterval(improvePollRef.current); };
  }, []);

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
    }
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  }

  function scrollTo(id: string) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadAndBuild() {
    setBusy("build");
    setCompletedSteps([]);
    setError(null);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`${API_BASE}/users/${USER_ID}/ingest`, { method: "POST", body });
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
      }
      setCompletedSteps(["Ingest", "Transcribe"]);
      const res = await fetch(`${API_BASE}/users/${USER_ID}/build`, { method: "POST" });
      const payload = await res.json();
      setBuildJobId(payload.job_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function callAgent() {
    setBusy("call");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/call`, { method: "POST" });
      if (!res.ok) throw new Error("Call agent failed");
      setCallInfo(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function launchAttack() {
    setBusy("attack");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/run`, { method: "POST" });
      if (!res.ok) throw new Error("Launch attack failed");
      const payload = await res.json();
      setRunId(payload.run_id);
      setRun({ run_id: payload.run_id, total: 0, passed: 0, failed: 0, pass_rate: 0, sessions: [] });
      setExpandedSessions(new Set());
      setTranscriptOpen(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function improve() {
    setBusy("improve");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/users/${USER_ID}/vanguard/improve`, { method: "POST" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || "Improvement cycle failed");
      }
      improveStartCountRef.current = chartData.length;
      setImprovementRunning(true);
      if (improvePollRef.current) clearInterval(improvePollRef.current);
      improvePollRef.current = setInterval(refreshDashboard, 20000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendChat() {
    if (!chatMessage.trim() || chatLoading) return;
    setChatLoading(true);
    setChatResponse(null);
    setChatLatency(null);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMessage, user_id: USER_ID }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      const data = await res.json();
      setChatResponse(data.response);
      setChatLatency(data.latency_ms);
    } catch (e) {
      setError(String(e));
    } finally {
      setChatLoading(false);
    }
  }

  function toggleSessionExpand(id: string) {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTranscript(id: string) {
    setTranscriptOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sessions = activeRun?.sessions || [];

  function getActiveStepIndex(stage: string | null): number | null {
    if (!stage) return null;
    if (stage.includes("personality")) return 2;
    if (stage.includes("scoring")) return 3;
    if (stage.includes("voice")) return 4;
    if (stage.includes("rag")) return 5;
    if (stage.includes("fine")) return 6;
    return null;
  }
  const activeStepIdx = getActiveStepIndex(buildStage);

  const buildComplete = buildStage === "submitted" || completedSteps.length >= BUILD_STEPS.length || !!dashboard.personality_spec;
  const personalitySpec = dashboard.personality_spec as Record<string, unknown> | null | undefined;

  const worstPersonas = useMemo(() => {
    const byPersona = dashboard.pass_rate_by_persona;
    if (!byPersona) return [];
    return Object.entries(byPersona)
      .map(([persona, stats]) => ({ persona, ...stats }))
      .sort((a, b) => a.pass_rate - b.pass_rate);
  }, [dashboard.pass_rate_by_persona]);

  return (
    <div className={inter.className} style={{ minHeight: "100vh", display: "flex", background: "#0c0c0d", color: "#f4f4f5" }}>
      {/* SIDEBAR */}
      <aside style={{
        width: 240, position: "fixed", top: 0, left: 0, bottom: 0,
        background: "#0c0c0d", borderRight: "1px solid #1f1f23",
        display: "flex", flexDirection: "column", padding: "24px 16px", zIndex: 50,
      }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ letterSpacing: "0.15em", fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 2 }}>FORGE</div>
          <div style={{ fontSize: 11, color: "#71717a" }}>Voice Agent Infrastructure</div>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {SIDEBAR_NAV.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                  fontSize: 14, color: isActive ? "#f4f4f5" : "#a1a1aa",
                  borderLeft: isActive ? "2px solid #7c3aed" : "2px solid transparent",
                  background: "transparent", borderTop: 0, borderRight: 0, borderBottom: 0,
                  cursor: "pointer", textAlign: "left", borderRadius: 0,
                  transition: "color 0.15s",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div style={{ borderTop: "1px solid #1f1f23", paddingTop: 16, marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusDotColor, display: "inline-block" }} />
            <span style={{ fontSize: 11, color: "#71717a" }}>System</span>
          </div>
          <div style={{ fontSize: 11, color: "#52525b" }}>Last updated {formatTime(lastUpdated)}</div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ marginLeft: 240, flex: 1, padding: "32px 48px", maxWidth: 1100 }}>
        {/* ERROR TOAST */}
        {error && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "#1a0505", border: "1px solid #7f1d1d", color: "#fca5a5",
            padding: "10px 16px", borderRadius: 6, marginBottom: 24, fontSize: 13,
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{
              background: "transparent", border: "none", color: "#fca5a5", cursor: "pointer", padding: 0, marginLeft: 12,
            }}>
              <XCircle size={16} />
            </button>
          </div>
        )}

        {/* SECTION 1: BUILD */}
        <section id="build" style={{ marginBottom: 48, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#f4f4f5", margin: 0 }}>Build</h2>
            <button
              onClick={uploadAndBuild}
              disabled={!files.length || busy === "build"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: busy === "build" ? "#5b21b6" : "#7c3aed",
                color: "#fff", fontSize: 13, fontWeight: 500,
                padding: "8px 16px", borderRadius: 6, border: "none", cursor: busy === "build" ? "not-allowed" : "pointer",
                opacity: !files.length && busy !== "build" ? 0.5 : 1,
              }}
            >
              {busy === "build" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Start Build
            </button>
          </div>

          {/* DROP ZONE */}
          <div style={{
            border: "2px dashed #1f1f23", background: "#141416", borderRadius: 8,
            minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: 24, cursor: "pointer", position: "relative",
            marginBottom: 16,
          }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files || [])]);
            }}
          >
            <label htmlFor="file-input" style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {files.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
                  {files.map((file, i) => (
                    <span key={i} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: "#1f1f23", padding: "4px 8px", borderRadius: 6, fontSize: 12, color: "#f4f4f5",
                    }}>
                      {file.name}
                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeFile(i); }} style={{
                        background: "transparent", border: "none", color: "#71717a", cursor: "pointer", padding: 0, display: "inline-flex",
                      }}>
                        <XCircle size={12} />
                      </button>
                    </span>
                  ))}
                  <span style={{ fontSize: 12, color: "#7c3aed", cursor: "pointer", textDecoration: "underline" }}>Add more</span>
                </div>
              ) : (
                <>
                  <span style={{ fontSize: 13, color: "#f4f4f5", display: "block", marginBottom: 4 }}>
                    Drop audio, text, CSV, JSON, EML, or PDF files
                  </span>
                  <span style={{ fontSize: 11, color: "#71717a" }}>or click to browse</span>
                </>
              )}
            </label>
          </div>
          <input id="file-input" className="sr-only" type="file" multiple accept="audio/*,.txt,.eml,.json,.csv,.pdf" onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const incoming = Array.from(e.target.files || []);
            setFiles((prev) => [...prev, ...incoming]);
          }} />

          {/* PIPELINE STEPPER */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20 }}>
            {BUILD_STEPS.map((step, i) => {
              const done = completedSteps.includes(step);
              const isLast = i === BUILD_STEPS.length - 1;
              return (
                <div key={step} style={{ display: "flex", alignItems: "center", flex: isLast ? 0 : 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      background: done ? "#7c3aed" : "#1f1f23",
                      boxShadow: !done && activeStepIdx === i ? "0 0 0 2px #f59e0b" : "none",
                      transition: "background 0.3s",
                    }}>
                      {done ? <CheckCircle2 size={14} color="#fff" /> : <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#3f3f46" }} />}
                    </div>
                    <span style={{ fontSize: 11, color: done ? "#f4f4f5" : "#52525b" }}>{step}</span>
                  </div>
                  {!isLast && <div style={{ flex: 1, height: 1, background: "#27272a", margin: "0 8px" }} />}
                </div>
              );
            })}
          </div>

          {/* SYSTEM STATUS 2x3 GRID */}
          {statusInfo && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16,
            }}>
              {statusItems.map((item) => (
                <div key={item.key} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "#141416", border: "1px solid #1f1f23", borderRadius: 6,
                  padding: "8px 12px", fontSize: 12,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: item.ready ? "#22c55e" : "#52525b",
                    display: "inline-block", flexShrink: 0,
                  }} />
                  <span style={{ color: item.ready ? "#f4f4f5" : "#52525b" }}>{item.label}</span>
                  <span style={{ marginLeft: "auto", color: item.ready ? "#22c55e" : "#52525b", fontSize: 10 }}>
                    {item.ready ? "Ready" : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* BUILD RESULTS PANEL */}
          {buildComplete && personalitySpec && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16,
            }}>
              <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 8 }}>Personality</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  <div style={{ color: "#71717a" }}>
                    Formality: <span style={{ color: "#f4f4f5" }}>
                      {(personalitySpec.communication_style as Record<string, unknown>)?.formality != null
                        ? String((personalitySpec.communication_style as Record<string, unknown>).formality) : "—"}
                    </span>
                  </div>
                  <div style={{ color: "#71717a" }}>
                    Hedging: <span style={{ color: "#f4f4f5" }}>
                      {(personalitySpec.communication_style as Record<string, unknown>)?.hedging_frequency != null
                        ? String((personalitySpec.communication_style as Record<string, unknown>).hedging_frequency) : "—"}
                    </span>
                  </div>
                  <div style={{ color: "#71717a" }}>
                    Humor: <span style={{ color: "#f4f4f5" }}>
                      {(personalitySpec.communication_style as Record<string, unknown>)?.humor_style != null
                        ? String((personalitySpec.communication_style as Record<string, unknown>).humor_style) : "—"}
                    </span>
                  </div>
                  <div style={{ color: "#71717a" }}>
                    Domains: <span style={{ color: "#f4f4f5" }}>
                      {(() => {
                        const domains = personalitySpec.knowledge_domains;
                        if (Array.isArray(domains)) {
                          return (domains as Array<{domain: string}>).slice(0, 2).map(d => d.domain).join(", ");
                        }
                        if (typeof domains === "string") return domains;
                        return "—";
                      })()}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 8 }}>Voice Clone</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  <div style={{ color: "#71717a" }}>
                    Voice ID: <span style={{ color: "#f4f4f5", fontFamily: "monospace", fontSize: 11 }}>
                      {dashboard.voice_id ? dashboard.voice_id.slice(0, 16) + "..." : "—"}
                    </span>
                  </div>
                  <div style={{ color: "#71717a" }}>
                    Similarity: <span style={{ color: "#22c55e" }}>0.82</span>
                    <span style={{ color: "#52525b", marginLeft: 4 }}>(stub)</span>
                  </div>
                </div>
              </div>
              <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 8 }}>RAG</div>
                <div style={{ fontSize: 12, color: statusInfo?.rag_ready ? "#22c55e" : "#52525b" }}>
                  {statusInfo?.rag_ready ? "Knowledge base built" : "Not ready"}
                </div>
              </div>
              <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 8 }}>Fine-tune</div>
                <div style={{ fontSize: 12, color: dashboard.adapter_id ? "#22c55e" : "#52525b" }}>
                  {dashboard.adapter_id
                    ? <span style={{ fontFamily: "monospace", fontSize: 11 }}>{dashboard.adapter_id.slice(0, 24)}...</span>
                    : "Base model (fine-tune skipped)"}
                </div>
              </div>
            </div>
          )}
          {/* TRANSCRIPT QUALITY SCORES */}
          {transcriptScores && (
            <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>Transcript Quality Scores</div>
                <div style={{ fontSize: 12, color: "#22c55e" }}>
                  Overall: <span style={{ fontWeight: 600 }}>{Math.round(transcriptScores.aggregate_score * 10)}%</span>
                  <span style={{ color: "#52525b", marginLeft: 8, fontSize: 10 }}>
                    {transcriptScores.top_k_turns?.length ?? 0} golden segments selected
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {Object.entries(transcriptScores.dimension_scores).map(([dim, score]) => {
                  const pct = Math.round((score / 10) * 100);
                  const color = pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
                  const label = dim.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                  return (
                    <div key={dim} style={{ background: "#0c0c0d", border: "1px solid #1f1f23", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color }}>{pct}%</div>
                      <div style={{ height: 3, background: "#1f1f23", borderRadius: 2, marginTop: 4 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* SECTION 2: AGENT */}
        <section id="agent" style={{ marginBottom: 48, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#f4f4f5", margin: 0 }}>Agent</h2>
            <button
              onClick={callAgent}
              disabled={busy === "call"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 500,
                padding: "8px 16px", borderRadius: 6, border: "none", cursor: busy === "call" ? "not-allowed" : "pointer",
                opacity: busy === "call" ? 0.6 : 1,
              }}
            >
              {busy === "call" ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
              Call Agent
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#71717a", marginBottom: 8 }}>Phone Number</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20, fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "#f4f4f5" }}>
                  {callInfo?.phone_number || "—"}
                </span>
                {callInfo?.phone_number && (
                  <button onClick={() => copyToClipboard(callInfo.phone_number, "phone")} style={{
                    background: "transparent", border: "none", color: "#71717a", cursor: "pointer", padding: 0,
                  }}>
                    <Copy size={14} />
                    {copiedText === "phone" && <span style={{ fontSize: 10, color: "#22c55e", marginLeft: 4 }}>Copied!</span>}
                  </button>
                )}
              </div>
            </div>
            <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#71717a", marginBottom: 8 }}>Room URL</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "#f4f4f5",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                }}>
                  {callInfo?.room_url || "—"}
                </span>
                {callInfo?.room_url && (
                  <>
                    <button onClick={() => copyToClipboard(callInfo.room_url, "room")} style={{
                      background: "transparent", border: "none", color: "#71717a", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                      <Copy size={14} />
                      {copiedText === "room" && <span style={{ fontSize: 10, color: "#22c55e" }}>Copied!</span>}
                    </button>
                    <a href={callInfo.room_url} target="_blank" rel="noopener noreferrer" style={{
                      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#7c3aed", textDecoration: "none",
                    }}>
                      <Link size={14} /> Open
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* CHAT WIDGET */}
          <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, color: "#71717a", marginBottom: 12 }}>Live chat test &mdash; real NVIDIA NIM response</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                onFocus={() => setChatFocused(true)}
                onBlur={() => setChatFocused(false)}
                placeholder="Type a message..."
                style={{
                  flex: 1, background: "#0c0c0d", border: chatFocused ? "1px solid #7c3aed" : "1px solid #1f1f23", borderRadius: 4,
                  padding: "8px 12px", fontSize: 13, color: "#f4f4f5", outline: "none",
                }}
              />
              <button
                onClick={sendChat}
                disabled={!chatMessage.trim() || chatLoading}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 500,
                  padding: "8px 16px", borderRadius: 4, border: "none",
                  cursor: !chatMessage.trim() || chatLoading ? "not-allowed" : "pointer",
                  opacity: !chatMessage.trim() || chatLoading ? 0.5 : 1,
                }}
              >
                {chatLoading ? <Loader2 size={14} className="animate-spin" /> : "Send"}
              </button>
            </div>
            {chatResponse && (
              <div style={{
                background: "#0c0c0d", border: "1px solid #1f1f23", borderRadius: 6, padding: 12, fontSize: 13, lineHeight: 1.5, color: "#f4f4f5",
              }}>
                {chatResponse}
                {chatLatency !== null && (
                  <div style={{ marginTop: 8, fontSize: 10, color: "#71717a" }}>{chatLatency}ms latency</div>
                )}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 10, color: "#52525b" }}>Direct NVIDIA NIM call &mdash; no caching, no mocks.</div>
          </div>
        </section>

        {/* SECTION 3: VANGUARD */}
        <section id="vanguard" style={{ marginBottom: 48, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: "#f4f4f5", margin: 0 }}>Vanguard</h2>
              {total > 0 && (
                <span style={{ fontSize: 13, color: passRate >= 60 ? "#22c55e" : "#ef4444" }}>
                  {passed}/{total} passed ({passRate}%)
                </span>
              )}
              {vanguardRunning && (
                <span style={{ fontSize: 12, color: "#f59e0b", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Loader2 size={12} className="animate-spin" />
                  {passed + (activeRun?.failed || 0)}/{total} sessions complete
                </span>
              )}
              {dashboard.attack_suite_size != null && dashboard.attack_suite_size > 0 && (
                <span style={{ fontSize: 11, color: "#71717a" }}>{dashboard.attack_suite_size} attack variants</span>
              )}
            </div>
            <button
              onClick={launchAttack}
              disabled={busy === "attack"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: busy === "attack" ? "#5b21b6" : "#7c3aed",
                color: "#fff", fontSize: 13, fontWeight: 500,
                padding: "8px 16px", borderRadius: 6, border: "none", cursor: busy === "attack" ? "not-allowed" : "pointer",
                opacity: busy === "attack" ? 0.6 : 1,
              }}
            >
              {busy === "attack" ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
              Launch Attack
            </button>
          </div>
          {sessions.length > 0 ? (
            <div style={{ overflowX: "auto", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1f1f23" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px 10px 0", fontWeight: 500, color: "#71717a", fontSize: 12, width: 20 }} />
                    <th style={{ textAlign: "left", padding: "10px 12px 10px 0", fontWeight: 500, color: "#71717a", fontSize: 12 }}>Persona</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 500, color: "#71717a", fontSize: 12 }}>Status</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 500, color: "#71717a", fontSize: 12 }}>Score</th>
                    <th style={{ textAlign: "left", padding: "10px 0 10px 12px", fontWeight: 500, color: "#71717a", fontSize: 12 }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const pName = PERSONA_NAMES[session.attack_persona] || session.attack_persona;
                    const statusBg = session.status === "passed" ? "#052e16" : session.status === "failed" ? "#1a0505" : session.status === "running" ? "#1c1917" : "#141416";
                    const statusColor = session.status === "passed" ? "#22c55e" : session.status === "failed" ? "#ef4444" : session.status === "running" ? "#f59e0b" : "#71717a";
                    const score = session.overall_score != null ? Math.round(session.overall_score) : 0;
                    const barColor = session.status === "passed" ? "#22c55e" : session.status === "failed" ? "#ef4444" : "#7c3aed";
                    const isExpanded = expandedSessions.has(session.session_id);
                    const ds = session.evaluation?.dimension_scores;
                    const annotations = session.evaluation?.failure_annotations || [];
                    const firstAnnotation = annotations.length > 0 ? annotations[0] as Record<string, unknown> : null;
                    return (
                      <React.Fragment key={session.session_id}>
                        <tr
                          onClick={() => toggleSessionExpand(session.session_id)}
                          style={{ borderBottom: "1px solid #1f1f23", cursor: "pointer" }}
                        >
                          <td style={{ padding: "10px 0 10px 0", color: "#52525b" }}>
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </td>
                          <td style={{ padding: "10px 12px 10px 0", color: "#f4f4f5" }}>{pName}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{
                              display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 12,
                              background: statusBg, color: statusColor,
                            }}>
                              {session.status}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, height: 4, background: "#1f1f23", borderRadius: 2, maxWidth: 100 }}>
                                <div style={{ width: `${score}%`, height: "100%", background: barColor, borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 12, color: "#71717a", width: 32, textAlign: "right" }}>{score}%</span>
                            </div>
                          </td>
                          <td style={{ padding: "10px 0 10px 12px", color: "#71717a", fontSize: 12 }}>
                            {session.duration_seconds ? `${session.duration_seconds.toFixed(0)}s` : "—"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ borderBottom: "1px solid #1f1f23" }}>
                            <td colSpan={5} style={{ padding: "0 0 12px 32px" }}>
                              {/* Dimension scores */}
                              {ds && (
                                <div style={{ display: "flex", gap: 8, marginBottom: firstAnnotation ? 12 : 0, flexWrap: "wrap" }}>
                                  <ScorePill label="Char. Consistency" value={ds.character_consistency} />
                                  <ScorePill label="Jailbreak Resist." value={ds.jailbreak_resistance} />
                                  <ScorePill label="Factual Accuracy" value={ds.factual_accuracy} />
                                  <ScorePill label="Graceful Degrade" value={ds.graceful_degradation} />
                                  {session.evaluation?.provider && (
                                    <span style={{ fontSize: 10, color: "#52525b", display: "flex", alignItems: "center" }}>
                                      via {session.evaluation.provider}
                                    </span>
                                  )}
                                </div>
                              )}
                              {/* Failure annotation */}
                              {firstAnnotation && (
                                <div style={{
                                  background: "#1a0505", border: "1px solid #7f1d1d", borderRadius: 6, padding: 12, fontSize: 12,
                                }}>
                                  <div style={{ color: "#fca5a5", fontWeight: 500, marginBottom: 6 }}>Failure Annotation</div>
                                  {firstAnnotation.correct_response != null && (
                                    <div style={{ color: "#71717a", marginBottom: 4 }}>
                                      Expected response:
                                      <div style={{
                                        background: "#0c0c0d", padding: "8px 12px", borderRadius: 4, marginTop: 4,
                                        color: "#f4f4f5", fontFamily: "ui-monospace, monospace", fontSize: 11, whiteSpace: "pre-wrap",
                                      }}>
                                        {String(firstAnnotation.correct_response)}
                                      </div>
                                    </div>
                                  )}
                                  {firstAnnotation.failure_turn != null && (
                                    <div style={{ color: "#71717a", marginTop: 4 }}>
                                      Failed at turn {String(firstAnnotation.failure_turn)}
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* Transcript viewer */}
                              {session.transcript?.turns && session.transcript.turns.length > 0 && (
                                <div style={{ marginTop: 12 }}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleTranscript(session.session_id); }}
                                    style={{
                                      background: "transparent", border: "1px solid #1f1f23", borderRadius: 4,
                                      color: "#71717a", fontSize: 11, cursor: "pointer", padding: "4px 10px",
                                    }}
                                  >
                                    {transcriptOpen.has(session.session_id) ? "Hide" : "View"} Transcript
                                  </button>
                                  {transcriptOpen.has(session.session_id) && (
                                    <div style={{
                                      marginTop: 8, background: "#0c0c0d", border: "1px solid #1f1f23",
                                      borderRadius: 6, padding: 12, maxHeight: 300, overflowY: "auto",
                                    }}>
                                      {session.transcript.turns.map((turn, i) => {
                                        const isAttacker = turn.role === "caller" || turn.role === "user" || turn.role.toLowerCase() === "attacker";
                                        return (
                                          <div key={i} style={{
                                            display: "flex", flexDirection: "column",
                                            alignItems: isAttacker ? "flex-start" : "flex-end",
                                            marginBottom: 8,
                                          }}>
                                            <span style={{ fontSize: 10, color: isAttacker ? "#f59e0b" : "#71717a", marginBottom: 2 }}>
                                              {isAttacker ? "ATTACKER" : "AGENT"}
                                            </span>
                                            <div style={{
                                              fontSize: 12, color: "#f4f4f5", lineHeight: 1.4,
                                              background: isAttacker ? "#1c1917" : "#141416",
                                              borderRadius: 6, padding: "6px 10px", maxWidth: "80%",
                                            }}>
                                              {turn.text}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{
              background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 48,
              textAlign: "center", color: "#71717a", fontSize: 13, marginBottom: 16,
            }}>
              No sessions yet. Click Launch Attack to begin real adversarial testing.
            </div>
          )}

          {/* WORST PERSONAS */}
          {worstPersonas.length > 0 && (
            <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#71717a", fontWeight: 600, marginBottom: 12 }}>Weakest Attack Categories</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {worstPersonas.map((item) => {
                  const pName = PERSONA_NAMES[item.persona] || item.persona;
                  const ratePct = Math.round(item.pass_rate * 100);
                  return (
                    <div key={item.persona} style={{
                      display: "flex", alignItems: "center", gap: 12, fontSize: 12,
                    }}>
                      <span style={{ width: 120, color: "#f4f4f5", flexShrink: 0 }}>{pName}</span>
                      <span style={{ color: "#71717a", width: 80, flexShrink: 0 }}>
                        {item.passed}/{item.runs} passed
                      </span>
                      <div style={{ flex: 1, height: 4, background: "#1f1f23", borderRadius: 2 }}>
                        <div style={{
                          width: `${ratePct}%`, height: "100%",
                          background: ratePct >= 60 ? "#22c55e" : ratePct >= 30 ? "#f59e0b" : "#ef4444",
                          borderRadius: 2,
                        }} />
                      </div>
                      <span style={{
                        color: ratePct >= 60 ? "#22c55e" : ratePct >= 30 ? "#f59e0b" : "#ef4444",
                        width: 32, textAlign: "right",
                      }}>
                        {ratePct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* SECTION 4: IMPROVEMENT */}
        <section id="improvement" style={{ marginBottom: 48, scrollMarginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: "#f4f4f5", margin: 0 }}>Improvement Curve</h2>
              <span style={{ fontSize: 13, color: "#71717a" }}>{cyclesRun} cycle{cyclesRun !== 1 ? "s" : ""} run</span>
            </div>
            <button
              onClick={improve}
              disabled={busy === "improve"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: busy === "improve" ? "#5b21b6" : "#7c3aed",
                color: "#fff", fontSize: 13, fontWeight: 500,
                padding: "8px 16px", borderRadius: 6, border: "none", cursor: busy === "improve" ? "not-allowed" : "pointer",
                opacity: busy === "improve" ? 0.6 : 1,
              }}
            >
              {busy === "improve" ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
              Run Improvement Cycle
            </button>
          </div>
          {improvementRunning && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1c1917", border: "1px solid #78350f", borderRadius: 6, padding: "10px 16px", marginBottom: 16 }}>
              <Loader2 size={14} className="animate-spin" color="#f59e0b" />
              <span style={{ fontSize: 13, color: "#fbbf24" }}>Improvement cycle running &mdash; results will appear when complete.</span>
            </div>
          )}
          {chartData.length > 0 ? (
            <>
              <div style={{ background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 16, height: 288, marginBottom: 16 }}>
                <ImprovementChartNoSsr data={chartData} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {chartData.map((point) => {
                  const histItem = dashboard.pass_rate_history?.find((h) => h.cycle === point.cycle);
                  const regPassed = histItem?.regression_passed;
                  return (
                    <div key={point.cycle} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px", background: "#141416", border: "1px solid #1f1f23", borderRadius: 6, fontSize: 12,
                    }}>
                      <span style={{ color: "#71717a" }}>Cycle {point.cycle}</span>
                      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                        {regPassed !== undefined && (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            color: regPassed ? "#22c55e" : "#ef4444",
                          }}>
                            {regPassed ? "Gate \u2713" : "Gate \u2717"}
                          </span>
                        )}
                        <span style={{ color: "#7c3aed" }}>{point.passRate != null ? `${Math.round(point.passRate)}%` : "—"} pass</span>
                        <span style={{ color: "#a1a1aa" }}>{point.suiteSize ?? "—"} variants</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{
              background: "#141416", border: "1px solid #1f1f23", borderRadius: 8, padding: 48,
              textAlign: "center",
            }}>
              <Shield size={32} style={{ color: "#52525b", marginBottom: 12 }} />
              <p style={{ fontSize: 13, color: "#71717a", margin: 0 }}>
                No improvement cycles yet. Run Vanguard first, then run an improvement cycle to see hardening progress.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value?: number }) {
  if (value == null) return null;
  const color = value >= 70 ? "#22c55e" : value >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: "#0c0c0d", border: "1px solid #1f1f23", borderRadius: 6,
      padding: "4px 8px", fontSize: 11,
    }}>
      <span style={{ color: "#71717a" }}>{label}:</span>
      <span style={{ color, fontWeight: 600 }}>{value}%</span>
    </div>
  );
}
