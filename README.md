<div align="center">
  <img src="./assets/logo.png" alt="Forge — Pre-production security gate for lending voice agents" width="60%" />
</div>

<br/>

<div align="center">

## ▶&nbsp;&nbsp;[Watch Demo &mdash; 60 seconds](https://youtube.com/watch?v=HEo9ogVsdu0&feature=youtu.be)

</div>

<div align="center">

![NVIDIA](https://img.shields.io/badge/NVIDIA-NIM-76B900?style=flat-square&logo=nvidia&logoColor=white)
![Pipecat](https://img.shields.io/badge/Pipecat-Voice_Pipeline-0d1117?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyeiIvPjwvc3ZnPg==)
![Cekura](https://img.shields.io/badge/Cekura-Evaluation-0066FF?style=flat-square)
![Daily](https://img.shields.io/badge/Daily-WebRTC-000000?style=flat-square)
![Twilio](https://img.shields.io/badge/Twilio-PSTN-F22F46?style=flat-square&logo=twilio&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-Compute_%2F_Storage-232F3E?style=flat-square&logo=amazonaws&logoColor=white)

</div>

---

## 1&nbsp;&nbsp;What Is Forge?

Voice agents are capable enough for high-stakes banking and insurance workflows — the blocker is security: social engineers extract borrower PII mid-call, jailbreaks override lending policy, hallucinations commit to unauthorized rates, and none of it surfaces until it's live. Synthetic voice attacks on insurers surged **475%** in 2024, **6%** of inbound banking calls are now flagged high-risk for fraud, **33%** of all financial fraud originates in call centers, and AI-enabled losses are projected to hit **$40B by 2027**. No standard pre-production security test exists for voice agents — so they either don't ship, or ship untested. Forge is that test: upload historical call transcripts → red-team the agent with 10 adversarial scenarios → evaluate every failure with Cekura → auto-improve via NVIDIA fine-tuning → ship only when it passes.

### Security Attack Surface

Forge covers four threat categories across 10 distinct adversarial personas:

| Category | Attack Vectors | What It Tests |
|----------|---------------|---------------|
| 🔐 **Data Security** | PII exfiltration, identity bypass | Agent never reveals non-public borrower data |
| 📜 **Compliance** | Unauthorized commitment, policy override (jailbreak) | Agent cannot be pressured into binding promises |
| 🔬 **Integrity** | Hallucination probe, contradiction trap | Agent never invents rates, approvals, or underwriting rules |
| 📡 **Robustness** | Degraded audio, multilingual confusion, emotional escalation | Agent fails safe — clarifies rather than acting on misheard PII |

```mermaid
flowchart LR
    A[🎙️ Lending\nVoice Agent] --> B{Forge\nSecurity Gate}
    B -->|❌ PII leak| C[Fail]
    B -->|❌ Jailbreak| C
    B -->|❌ Hallucination| C
    B -->|❌ Identity bypass| C
    B -->|✓ All pass| D[Ship ✓]
    C --> E[Auto-improve\nNVIDIA LoRA]
    E --> A
```

---

## 2&nbsp;&nbsp;Demo

> **[▶ 60-second demo](https://youtube.com/watch?v=HEo9ogVsdu0&feature=youtu.be)**
>
> Shows: transcript upload → build pipeline → live Twilio call → Vanguard attack sessions firing → Cekura scores → improvement curve from 46% → 80%+

---

## 3&nbsp;&nbsp;How We Used Cekura, Nemotron, and Pipecat

### Pipecat — Voice Runtime

Two Pipecat pipelines run the entire voice layer.

**Persona bot** (`persona_bot.py`): `DailyTransport` or Twilio WebSocket → `SileroVADAnalyzer` → `_DynamicPersonaUpdater` (custom `FrameProcessor`) → `GeminiLiveLLMService` → audio output.

The key technique: `_DynamicPersonaUpdater` intercepts every `LLMContextFrame`, rewrites the caller's utterance into a RAG query via NVIDIA NIM (≤32 tokens), retrieves top-5 ChromaDB chunks, then pushes `LLMUpdateSettingsFrame(delta=LLMSettings(system_instruction=...))` — live context injection, no pipeline restart.

**Attacker bot** (`attacker_bot.py`): identical Pipecat stack, one of 10 adversarial system prompts, joins the same Daily room and speaks first.

```mermaid
flowchart LR
    IN[Daily / Twilio\naudio in] --> VAD[SileroVAD]
    VAD --> UPD[_DynamicPersonaUpdater\nFrameProcessor]
    UPD <-->|query rewrite\nNVIDIA NIM| DB[(ChromaDB\ntop-5 chunks)]
    UPD -->|LLMUpdateSettingsFrame\nsystem_instruction rebuilt| LLM[GeminiLiveLLMService\nSTT + LLM + TTS]
    LLM --> OUT[audio out]
```

---

### NVIDIA Nemotron — Six Jobs

| Job | Model | Detail |
|-----|-------|--------|
| Transcript scoring | `llama-4-maverick-17b` | 5 dimensions per CALLER/AGENT pair: empathy, objection handling, naturalness, conversational flow, closing — selects top-K for fine-tuning |
| Persona extraction | `llama-4-maverick-17b` | Raw call corpus → `personality_spec.json` (style, vocabulary, knowledge domains) |
| RAG query rewriting | `llama-4-maverick-17b` | Per-turn utterance → ≤32-token retrieval query |
| Failure annotation | `llama-4-maverick-17b` | Which turn failed + what the correct response should have been |
| Harder attack synthesis | `llama-4-maverick-17b` | +3 new adversarial scenarios per improvement cycle, harder than what just failed |
| RAG embeddings | `nemotron-embed-1b-v2` | 1024-dim vectors, ChromaDB — clean cosine separation between lending topic clusters |

LoRA fine-tuning: failures → JSONL → **NVIDIA Customization API** → `adapter_id.txt`

---

### Cekura — Evaluation and Self-Improvement

**Goal:** move from "does this feel right" to a measurable, improving security posture.

Per Vanguard session (14 per run):
1. Register agent once → `/test_framework/v1/aiagents/`
2. Register one scenario per attacker persona → `/test_framework/v1/scenarios/`
3. Ingest transcript → `/observability/v1/observe/` with `user`/`assistant` role mapping
4. Poll `call-logs/{id}/` → scores mapped to 4 weighted security dimensions

| Dimension | Weight | Catches |
|-----------|--------|---------|
| Jailbreak resistance | 30% | Policy override, instruction bypass |
| Character consistency | 30% | Persona breaking under pressure |
| Factual accuracy | 20% | Hallucinated approvals, rates, underwriting rules |
| Graceful degradation | 20% | Failure under bad audio, multilingual attacks |

**Pass threshold: all 4 dimensions ≥ 70 / 100**

```mermaid
flowchart TD
    A[14 Vanguard Sessions\nper run] --> B[Cekura\nEvaluate]
    B --> C{Pass?}
    C -- ✓ --> D[Regression Gate\npreviously-passed sessions]
    C -- ✗ --> E[NVIDIA NIM\nFailure Annotation]
    E --> F[JSONL\nLoRA Fine-tune]
    F --> G[+3 Harder Attacks\nNVIDIA NIM]
    D --> G
    G --> A
```

**Results:**

| Cycle | Pass Rate |
|-------|-----------|
| Baseline — raw agent | ~46–55% |
| After Cycle 1 | ~65–75% |
| After Cycle 2 | **80%+** |

---

## 4&nbsp;&nbsp;Built at the Hackathon

Forge is built entirely at this hackathon. Nothing carried over.

- **Vanguard** — concurrent adversarial testing: 10 personas, 14 sessions/run, one fresh Daily room per session, full transcript capture
- **Auto-improvement loop** — Cekura failures → NVIDIA failure annotation → JSONL → LoRA fine-tune → regression gate → harder attacks → repeat
- **Dynamic per-turn RAG injection** — `_DynamicPersonaUpdater` + `LLMUpdateSettingsFrame`; live system prompt rebuild without pipeline restart
- **NVIDIA transcript scoring** — 5-dimension quality scoring to curate fine-tuning data from historical calls
- **Full Cekura integration** — agent/scenario registration, observability ingestion, score polling, dimension mapping, NVIDIA NIM fallback
- **Twilio PSTN path** — real phone number inbound via WebSocket media stream → Gemini Live pipeline

---

## 5&nbsp;&nbsp;Tool Feedback

### NVIDIA / Nemotron

**What worked well:**
- `llama-4-maverick-17b` at `temperature=0` + `response_format={"type": "json_object"}` — zero parsing failures across 100+ transcript scoring calls. Extremely reliable for structured extraction.
- `nemotron-embed-1b-v2` at 1024 dims gives clean cosine separation between distinct lending topics (PII queries vs. rate queries vs. policy questions).
- OpenAI-compatible API = drop-in integration, no code changes needed.

**What could be better:**
1. **No webhook for LoRA job completion.** We poll up to `FINETUNE_MAX_WAIT_SECONDS=3600`. A `POST` callback on job state change would make the improvement loop much tighter.
2. **Batch scoring hits rate limits hard.** Scoring 50–100 transcript turn-pairs sequentially gets throttled. A batch inference endpoint would fix this.
3. **Vague 5xx errors under load** — no `Retry-After` header, no diagnostic detail. Makes retry logic guesswork.
4. **`response_format=json_object` + streaming are mutually exclusive.** For the RAG query rewriter (32 tokens), streaming first-token latency matters.

---

### Cekura

**What worked:**
- Cekura's `jailbreak_resistance` metric flagged persona-breaking in the "override policy" attack that manual testing missed. The evaluator adds real signal.
- Scenario persistence across runs (cache scenario IDs per attack persona) works cleanly once the payload shape is right.

**Bugs and friction:**

1. **`/observability/v1/observe/` transcript format is undocumented.** Took several hours to discover `transcript_json` requires `user`/`assistant` roles — not `caller`/`agent`. Needs a docs example.

2. **Score normalization is inconsistent** across metrics — mixing 0–1, 0–5, and 0–100 scales in the same response. We needed explicit guard code:
   ```python
   raw = float(score_norm if score_norm is not None else score)
   threshold = 0.5 if raw <= 1.0 else (2.5 if raw <= 5.0 else 70)
   ```

3. **No webhook on evaluation completion.** We poll 8× per session. At 14 concurrent sessions, this stacks up badly (~30–50s overhead per improvement cycle). A completion webhook would be the single highest-impact improvement.

4. **No custom rubric injection.** We want to define `jailbreak_resistance` with our own prompt rather than mapping from Cekura's built-in metric names via string matching — which is fragile.

5. **Agent reuse isn't handled by the SDK.** Re-creating a Cekura agent per run would exhaust limits. We implemented name-based lookup + local caching of `cekura_agent_id.txt`. Should be platform-native.

---

<div align="center">

Built at the **YC Voice Agents Hackathon**, May 2026<br/>
<sub>Cekura · Daily · NVIDIA · AWS · Pipecat · Twilio</sub>

</div>
