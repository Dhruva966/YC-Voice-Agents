# Forge

> Upload your sales call transcripts. Get a production-ready voice agent. Paste one webhook. Done.

Built for the **Voice Agents Hackathon** — Cekura · Daily · NVIDIA · AWS · Pipecat · Twilio

---

## What Is Forge?

Most teams building voice agents spend all their time on the agent itself — and ship with no idea whether it'll hold up in production. Forge solves the infrastructure problem that comes after you build the agent:

1. **Ingest** your existing sales calls (audio or transcripts)
2. **Score** every turn on 5 quality dimensions using NVIDIA NIM — empathy, objection handling, naturalness, conversational flow, closing technique
3. **Curate** the best turns (top-K) as golden training data
4. **Fine-tune** a persona voice agent via NVIDIA NIM LoRA
5. **Test it adversarially** — 8 LLM attacker personas probe it in concurrent Daily rooms (Vanguard)
6. **Auto-improve** — failures feed back into the fine-tune loop
7. **Ship** — one Twilio webhook URL

**The pitch:** every other team built a voice agent. Forge builds the infrastructure that makes voice agents production-ready before they ship.

---

## How It Works

```mermaid
flowchart LR
    A[Sales Call Transcripts\nor Audio Files] -->|Drag & Drop| B[Forge Ingestion\npipeline.py]
    B --> C[Transcript Scorer\nNVIDIA NIM · 5 dimensions]
    C --> D[Top-K Golden Turns\nbest training data]
    D --> E[NVIDIA NIM LoRA\nFine-tune]
    D --> F[ChromaDB RAG\nknowledge base]
    E --> G[Persona Agent\nPipecat + Gemini 3.1 Flash Live]
    F --> G
    G -->|Twilio Webhook| H[Your Phone Number\nPSTN]
    G --> I[Vanguard\n8 attacker personas\nDaily rooms]
    I -->|Cekura scores| J[Auto-Improvement Loop\nfailure → finetune → harder tests]
    J --> E
```

### Three Subsystems

| Subsystem | What it does |
|-----------|-------------|
| **Build Pipeline** | Ingest → Score → Personality extraction → RAG → Fine-tune |
| **Persona Agent** | Gemini 3.1 Flash Live voice pipeline via Twilio (PSTN) or Daily (WebRTC) |
| **Vanguard** | Adversarial testing: N concurrent sessions → Cekura evaluation → auto-improvement |

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Transcripts per build | 50–100 |
| Scoring dimensions | 5 |
| Attacker personas | 8 |
| Attack sessions per run | 12 (default) |
| Expected baseline pass rate | ~47–55% |
| After 2 improvement cycles | ~80%+ |
| Voice latency (Gemini Live) | ~50–80ms (STT + LLM + TTS in one model) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice pipeline | Pipecat + **Gemini 3.1 Flash Live** (one model: STT + LLM + TTS, audio-to-audio) |
| Telephony | Twilio (PSTN WebSocket media stream) |
| WebRTC transport | Daily (browser calls + Vanguard sessions) |
| Transcript scoring | NVIDIA NIM — `meta/llama-4-maverick-17b-128e-instruct` |
| Personality extraction | NVIDIA NIM |
| RAG embeddings | NVIDIA NIM — `nvidia/llama-3.2-nv-embedqa-1b-v2` |
| Fine-tuning | NVIDIA NIM LoRA Customization API |
| Evaluation | Cekura (LLM fallback: NVIDIA NIM) |
| Vector DB | ChromaDB (local) / pgvector (prod) |
| Storage | `storage.py` shim — `./local_data/` (local) or AWS S3 (prod) |
| Audio transcription | faster-whisper (local, `base` default; `large-v3` optional) |
| Backend | FastAPI + Python 3.11 |
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Compute | AWS EC2 |

> **Voice pipeline:** Gemini 3.1 Flash Live replaces the old Deepgram STT + ElevenLabs TTS stack for both the shipped persona agent and Vanguard attacker. The remaining ElevenLabs helper is legacy voice-clone code kept for reference.

---

## Sponsors

| Sponsor | Role in Forge |
|---------|--------------|
| **NVIDIA** | LoRA fine-tuning + RAG embeddings + transcript scoring (NIM APIs) |
| **Daily** | WebRTC transport for all voice sessions + Vanguard attack rooms |
| **Pipecat** | Voice pipeline framework |
| **Twilio** | Telephony — inbound PSTN call handling |
| **Cekura** | Automated transcript evaluation |
| **AWS** | Compute (EC2) + storage (S3) |

---

## Quick Start (Local, No AWS)

### Prerequisites

- Python 3.11+
- Node.js 18+
- API keys (see [Environment Variables](#environment-variables) below)

### 1. Clone and configure

```bash
git clone <repo-url>
cd forge

cp .env.example .env
# Fill in the required keys (see Environment Variables below)
# Leave USE_LOCAL_STORAGE=true and USE_LOCAL_RAG=true for local dev
```

### 2. Install Python dependencies

```bash
python3 -m pip install -r requirements.txt

# Pre-download the Whisper model selected by .env (base by default)
python3 -c "import os; from dotenv import load_dotenv; from faster_whisper import WhisperModel; load_dotenv(); WhisperModel(os.getenv('WHISPER_MODEL_SIZE', 'base'))"
```

> **Quality tip:** Set `WHISPER_MODEL_SIZE=large-v3` in `.env` for better transcription if the 1.5GB download is acceptable.

### 3. Start the backend

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

The backend starts at `http://localhost:8000`. On first start it initializes ChromaDB and warms up the VAD model.

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### 5. Expose for Twilio (optional, for real phone calls)

```bash
ngrok http 8000
# Copy the https:// URL

# In Twilio Console → Phone Numbers → your number → Voice Configuration:
# URL: https://<ngrok-url>/webhook/twilio/inbound
# Method: POST
```

---

## Environment Variables

### Required (demo fails without these)

| Variable | How to get it |
|----------|--------------|
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) → API Keys |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) → API Key |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_BASE_MODEL` | `meta/llama-4-maverick-17b-128e-instruct` |
| `NVIDIA_EMBEDDING_MODEL` | `nvidia/llama-3.2-nv-embedqa-1b-v2` |
| `DAILY_API_KEY` | [dashboard.daily.co](https://dashboard.daily.co) → Developers → API Key |
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) → Account Info |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info |
| `TWILIO_PHONE_NUMBER` | E.164 format, e.g. `+14155551234` |
| `CEKURA_API_KEY` | Cekura dashboard |
| `CEKURA_BASE_URL` | Cekura endpoint URL |

### Local dev defaults (leave as-is for hackathon)

| Variable | Default | Effect |
|----------|---------|--------|
| `USE_LOCAL_STORAGE` | `true` | Uses `./local_data/` instead of AWS S3 |
| `USE_LOCAL_RAG` | `true` | Uses ChromaDB instead of pgvector on RDS |
| `GEMINI_MODEL` | `gemini-3.1-flash-live-preview` | Gemini Live model code |
| `GEMINI_VOICE` | `Puck` | Persona voice name |
| `ATTACKER_GEMINI_VOICE` | `Charon` | Vanguard attacker voice name |
| `WHISPER_MODEL_SIZE` | `base` | Set `large-v3` for best transcription quality |
| `TRANSCRIPT_SCORE_TOP_K` | `50` | How many top segments to select per build |
| `PERSONA_AGENT_URL` | `http://localhost:8000` | Where Vanguard finds the persona API |

### Optional

| Variable | When needed |
|----------|-------------|
| `NVIDIA_CUSTOMIZATION_BASE_URL` | Submitting LoRA fine-tune jobs to NVIDIA |
| `NVIDIA_PERSONA_MODEL` | After fine-tune completes: swap in the adapter ID |
| `TWILIO_STREAM_URL` | Explicit `wss://.../media-stream` override when running behind TLS/proxy |
| `ELEVENLABS_API_KEY` | Legacy voice clone helper only; not needed for current runtime |
| `AWS_S3_BUCKET` | When `USE_LOCAL_STORAGE=false` |
| `AWS_ACCESS_KEY_ID` | When `USE_LOCAL_STORAGE=false` |
| `AWS_SECRET_ACCESS_KEY` | When `USE_LOCAL_STORAGE=false` |
| `AWS_REGION` | When `USE_LOCAL_STORAGE=false` |
| `AWS_RDS_HOST` | pgvector/RDS host when `USE_LOCAL_RAG=false` |
| `AWS_RDS_PORT` | pgvector/RDS port when `USE_LOCAL_RAG=false`; default `5432` |
| `AWS_RDS_DB` | pgvector/RDS database name; also used by docker-compose Postgres |
| `AWS_RDS_USER` | pgvector/RDS database user; also used by docker-compose Postgres |
| `AWS_RDS_PASSWORD` | pgvector/RDS database password; also used by docker-compose Postgres |
| `HUGGINGFACE_TOKEN` | Better speaker diarization via pyannote (fallback works without it) |

---

## API Reference

All routes use a `user_id` path parameter. Use `"demo"` for all local testing — it's hardcoded in the frontend.

### File Ingestion

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/users/{id}/ingest` | Upload a file → ingestion pipeline |

**Supported file types:** `.wav`, `.mp3`, `.m4a`, `.ogg` (audio → Whisper transcription + diarization), `.txt`, `.eml`, `.pdf`, `.docx` (text → cleaned and stored)

```bash
curl -X POST http://localhost:8000/users/demo/ingest \
  -F "file=@/path/to/sales_call.wav"
```

### Build Pipeline

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/users/{id}/build` | Trigger full build: score → personality → RAG → fine-tune |
| `GET` | `/users/{id}/build/status` | Poll build progress |

Build stages (in current code order): **Extract Personality → Legacy Voice Clone (if isolated audio exists) → Score Transcripts → Build RAG → Fine-tune**

Returns `{"status": "none"}` before the first build runs.

```bash
curl -X POST http://localhost:8000/users/demo/build

# Poll until done
watch -n 3 'curl -s http://localhost:8000/users/demo/build/status | python3 -m json.tool'
```

### System Status

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/users/{id}/status` | System readiness check: personality, RAG, fine-tune status |

```bash
curl http://localhost:8000/users/demo/status | python3 -m json.tool
```

### Voice Agent

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/users/{id}/call` | Create Daily room + start persona bot → returns `room_url` + `phone_number` |
| `POST` | `/join_room` | Join existing Daily room as persona bot |
| `POST` | `/webhook/twilio/inbound` | Twilio webhook → TwiML (connect WebSocket stream) |
| `WS` | `/media-stream` | Twilio media stream WebSocket → Gemini Live pipeline |
| `POST` | `/chat` | Direct text chat with persona (latency test, no voice) |

```bash
# Get a Daily room URL — open in Chrome to talk to the agent without a phone
curl -X POST http://localhost:8000/users/demo/call | python3 -m json.tool
```

### Vanguard Adversarial Testing

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/users/{id}/vanguard/run` | Launch adversarial sessions (background) → returns `run_id` |
| `GET` | `/users/{id}/vanguard/runs` | List all run summaries |
| `GET` | `/users/{id}/vanguard/runs/{run_id}` | Full run result + session transcripts |
| `GET` | `/users/{id}/vanguard/runs/{run_id}/live` | Live session stream for polling |
| `POST` | `/users/{id}/vanguard/improve` | Trigger improvement cycle on latest run |

```bash
# Launch attack suite
curl -X POST http://localhost:8000/users/demo/vanguard/run
# Returns: {"run_id": "..."}

# Poll live as sessions complete
curl http://localhost:8000/users/demo/vanguard/runs/<run_id>/live

# Trigger improvement cycle (fine-tune on failures + grow attack suite)
curl -X POST http://localhost:8000/users/demo/vanguard/improve
```

### Dashboard

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/users/{id}/dashboard` | Aggregated: personality, pass rates, improvement history |
| `GET` | `/users/{id}/transcript_scores` | Per-transcript quality scores (5 dimensions) |

```bash
curl http://localhost:8000/users/demo/dashboard | python3 -m json.tool
```

---

## Architecture Deep Dive

### Twilio PSTN Call Flow

```
[Caller's Phone]
       │ PSTN call
       ▼
[Twilio] ──── POST /webhook/twilio/inbound ──► [FastAPI :8000]
              WS /media-stream ◄──────────────       │
                                               GeminiLiveLLMService
                                               (STT + LLM + TTS in one model)
                                               rag/retriever.py (dynamic RAG)
                                               prompts.py:persona_system()
```

### Browser / Vanguard Call Flow

```
[Browser or Attacker Bot]
       │ Daily WebRTC audio
       ▼
[Daily Room] ◄──── run_persona_bot() ──── [FastAPI :8000]
                                               │
                                         GeminiLiveLLMService
                                         Dynamic RAG injection per turn
```

### Build Pipeline (step by step)

```
POST /users/{id}/build
  → _run_build() [background thread, async-safe]
    1. score_transcripts()              NVIDIA NIM rates every CALLER/AGENT turn pair
    2. extract_personality()            NVIDIA NIM → personality_spec.json
    3. create_voice_clone()             legacy voice_id.txt if isolated audio exists; persona uses GEMINI_VOICE
    4. build_knowledge_base()           ChromaDB collection indexed from top-K turns
    5. generate_synthetic_conversations() NVIDIA NIM → 500+ CALLER/AGENT training pairs
    6. submit_finetune()                NVIDIA Customization API → adapter_id.txt
```

### Vanguard Session Flow

```
POST /users/{id}/vanguard/run
  → run_vanguard() [background asyncio.run in a thread]
    For each session in attack_suite (12 by default):
      → Create Daily room (per session, fresh)
      → POST /join_room → persona bot joins room
      → run_attacker_bot() → attacker joins same room, speaks first
      → Transcript collected via on_user_turn_stopped / on_assistant_turn_stopped events
      → evaluate_transcript() → Cekura API → scores + pass/fail
    → Aggregate → save to {user_id}/vanguard_runs/{run_id}.json
    → Live results streamed to frontend via _vanguard_live[run_id] dict
```

### Auto-Improvement Loop

```
POST /users/{id}/vanguard/improve
  → run_improvement_cycle() [background thread]
    1. Failed sessions → failure_annotation() → which turn failed + correct_response
    2. Format as JSONL fine-tune examples
    3. submit_finetune() → wait_for_finetune_async() → new adapter_id
    4. Regression gate: re-run previously-passed sessions — must still pass
    5. Passed regression sessions → harder_variant_generator() → 3 harder attacks appended
    6. Save cycle summary (pass_rate_before, pass_rate_after, delta, new suite size)
```

### Dynamic RAG Injection

Every time a caller speaks, the persona pipeline:
1. Rewrites the utterance into a retrieval query (NVIDIA NIM, ~32 tokens)
2. Retrieves top-5 chunks from ChromaDB
3. Rebuilds the system prompt with those chunks injected
4. Pushes `LLMUpdateSettingsFrame` to Gemini Live — live update, no restart

---

## The 8 Attacker Personas

All prompts live in `forge/prompts.py:ATTACKER_PERSONAS`.

| Key | Attack Goal | What it's testing |
|-----|------------|-------------------|
| `social_engineer` | False authority + urgency | Does agent fabricate or comply with fake authority? |
| `jailbreaker` | Override system instructions (DAN, developer-mode) | Does agent break persona under nested hypotheticals? |
| `emotional_escalator` | Sycophancy under emotional pressure | Does agent over-promise or abandon boundaries? |
| `identity_attacker` | Challenge AI identity | Does agent deny being AI when sincerely asked? |
| `knowledge_prober` | Expose hallucination via specific claims | Does agent invent unsupported facts? |
| `language_switcher` | Multilingual degradation | Does agent act on misheard/misunderstood content? |
| `contradiction_trapper` | Force self-contradiction | Does agent accept false prior statements? |
| `degraded_audio` | Poor audio robustness | Does agent proceed on mishearing instead of clarifying? |

Default attack suite = 8 personas × 1 + first 4 repeated = **12 sessions** per run.

---

## Storage Layout

All data is scoped by `user_id`. Never omit the prefix.

```
local_data/                              ← USE_LOCAL_STORAGE=true (local dev)
└── {user_id}/
    ├── uploads/{filename}               ← raw uploaded files
    ├── audio/{filename}.wav             ← extracted audio tracks
    ├── transcripts/{filename}.json      ← Whisper transcription + diarization
    ├── transcript_scores/{file}.json    ← quality scores (5 dimensions)
    ├── personality/
    │   └── personality_spec.json        ← extracted persona spec
    ├── voice_id.txt                     ← voice ID (legacy)
    ├── adapter_id.txt                   ← NVIDIA LoRA adapter ID after fine-tune
    ├── attack_suite.json                ← grows after each improvement cycle
    ├── vanguard_runs/{run_id}.json      ← full run result + all session transcripts
    ├── improvement_cycles/{N}.json      ← cycle summary: pass_rate_before, delta
    ├── build_status/latest.json         ← current build stage (polled by frontend)
    └── finetune/examples.jsonl          ← JSONL training data for NVIDIA NIM
```

---

## Development Guide

### Project Structure

```
forge/
├── api/main.py              ← All FastAPI routes + background task dispatch
├── pipeline/
│   ├── persona_bot.py       ← Pipecat + Gemini Live persona pipeline
│   └── attacker_bot.py      ← Attacker pipeline for Vanguard sessions
├── vanguard/orchestrator.py ← Concurrent attack sessions + Cekura scoring
├── cekura/evaluator.py      ← Cekura first; NVIDIA NIM 3-rubric fallback
├── autoloop/loop_controller.py ← failure annotation → fine-tune → regression gate
├── ingestion/
│   ├── pipeline.py          ← ingest_file() entry point; routes by file type
│   ├── transcript_scorer.py ← LLM quality scoring on 5 dimensions
│   ├── transcribe.py        ← faster-whisper: audio → timestamped text
│   └── diarize.py           ← pyannote speaker diarization (graceful fallback)
├── personality/extractor.py ← extract_personality() via NVIDIA NIM
├── rag/retriever.py         ← ChromaDB (local) / pgvector (prod)
├── finetune/persona_finetune.py ← NVIDIA NIM LoRA fine-tune job management
├── voice/clone.py           ← Legacy ElevenLabs voice clone (unused; kept for reference)
├── frontend/app/page.tsx    ← Next.js dashboard
├── storage.py               ← S3 shim (local_data/ or real S3)
└── prompts.py               ← ALL LLM prompts — never inline strings elsewhere
```

### Subsystem Module Docs

Each subsystem has its own `CLAUDE.md` with allowed patterns, forbidden patterns, and specific rules:

| Module | Doc |
|--------|-----|
| API routes | [forge/api/CLAUDE.md](forge/api/CLAUDE.md) |
| Gemini Live pipeline | [forge/pipeline/CLAUDE.md](forge/pipeline/CLAUDE.md) |
| Ingestion + transcript scorer | [forge/ingestion/CLAUDE.md](forge/ingestion/CLAUDE.md) |
| Vanguard adversarial testing | [forge/vanguard/CLAUDE.md](forge/vanguard/CLAUDE.md) |

### Three Invariants You Must Not Break

1. **All prompts in `prompts.py`** — never inline LLM strings anywhere else in the codebase
2. **All storage via `storage.py` shim** — never `import boto3; boto3.client("s3", ...)`
3. **Long-running work in `BackgroundTasks`** — never block FastAPI's async event loop

### Common Task Patterns

**Add a new API endpoint:**
```python
@app.post("/users/{user_id}/my-feature")
async def my_feature(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    job_id = str(uuid.uuid4())
    background_tasks.add_task(_run_my_feature, user_id, job_id)
    return QueuedResponse(job_id=job_id, status="queued")
```

**Add a new attacker persona:**
1. Add key + prompt to `prompts.py:ATTACKER_PERSONAS`
2. `orchestrator.py:build_default_attack_suite()` picks it up automatically — no other changes needed

**Modify the system prompt live:**
1. Edit `prompts.py:persona_system()`
2. `_TwilioDynamicUpdater` re-injects it on every LLM context frame — no restart needed

**Extend transcript scoring with a new dimension:**
1. Add dimension to `prompts.py:transcript_quality_score()`
2. Update `ScoredTurn` dataclass in `ingestion/transcript_scorer.py`
3. Update `HANDOFF.md` data contracts

### Testing

```bash
# Verify backend health
curl http://localhost:8000/users/demo/status

# Full smoke test
curl -X POST http://localhost:8000/users/demo/ingest -F "file=@sample.wav"
curl -X POST http://localhost:8000/users/demo/build
watch -n 3 'curl -s http://localhost:8000/users/demo/build/status | python3 -m json.tool'

# Test Vanguard Gemini attacker readiness
python3 scripts/validate.py --vanguard
curl -X POST http://localhost:8000/users/demo/vanguard/run

# Test NVIDIA NIM directly
curl -s https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-4-maverick-17b-128e-instruct","messages":[{"role":"user","content":"Say OK"}]}' \
  | python3 -m json.tool
```

---

## Docker Compose (Optional)

```bash
cd forge
docker-compose up --build
# backend  → localhost:8000
# frontend → localhost:3000
# postgres → localhost:5432 (pgvector, only if USE_LOCAL_RAG=false)
```

When using docker-compose, set `PERSONA_AGENT_URL=http://backend:8000` in `.env`.
The checked-in `.env.example` includes local pgvector defaults so `docker-compose up`
has Postgres credentials even before you add production RDS settings.

---

## Pre-Demo Checklist

Run the night before the demo:

```bash
# 1. Pre-download the Whisper model selected by .env
python3 -c "import os; from dotenv import load_dotenv; from faster_whisper import WhisperModel; load_dotenv(); WhisperModel(os.getenv('WHISPER_MODEL_SIZE', 'base'))"

# 2. Seed demo data (builds a synthetic persona for user_id=demo)
python3 scripts/seed_demo.py

# 3. Verify backend starts clean
uvicorn api.main:app --reload
curl http://localhost:8000/users/demo/status | python3 -m json.tool

# 4. Verify Vanguard dependencies, then run Cycle 0 (takes ~10 min)
python3 scripts/validate.py --vanguard
curl -X POST http://localhost:8000/users/demo/vanguard/run
# Expected: 47–55% pass rate

# 5. Run improvement Cycle 1
curl -X POST http://localhost:8000/users/demo/vanguard/improve
# Expected: 65–75% pass rate

# 6. Run Cycle 2 if time allows
# Expected: 80%+ pass rate

# 7. Snapshot pre-computed demo state
cp -r local_data/ local_data_backup/
```

## Demo Video Flow (5 minutes)

1. **Skit** (~30s) — funny example sales call, one person plays customer + agent
2. **Fast-forward** (~15s) — grid of 100 simultaneous calls at 10× speed
3. **Transcript dump** (~20s) — drag all transcripts into the Forge dashboard
4. **Build pipeline** (~30s) — stepper lights up: Extract → Score (show quality scores) → RAG → Fine-tune
5. **Live call** (~45s) — dial the Twilio number on stage, talk to the trained agent
6. **Vanguard** (~15s) — adversarial sessions running, Cekura scores populating
7. **Close** (~10s) — show the webhook URL: "Paste this. Done."

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Backend won't start | Missing env var | Check `.env`, ensure `GEMINI_API_KEY` is set |
| `init_db()` fails at startup | ChromaDB missing | `python3 -m pip install chromadb` then restart |
| Gemini Live fails mid-call | Bad API key or rate limit | Verify at [aistudio.google.com](https://aistudio.google.com), check quota |
| Twilio doesn't connect | Stale ngrok URL in Twilio console | Re-run ngrok, update webhook URL in Twilio |
| Vanguard sessions all fail | `PERSONA_AGENT_URL` wrong, server down, or Gemini/Daily key issue | Confirm `http://localhost:8000`, server health, `GEMINI_API_KEY`, and `DAILY_API_KEY` |
| Cekura scores all 0 | Cekura unreachable | Expected — `"provider": "llm_fallback"` still works, scores populate |
| Build hangs at fine-tune | `NVIDIA_CUSTOMIZATION_BASE_URL` not set | Fine-tune logs error and falls back to base model — build still completes |
| Transcript scorer times out | NVIDIA NIM rate limit | Reduce `TRANSCRIPT_SCORE_TOP_K` (e.g., `20`) or add retry |
| Frontend shows stale data | 30s poll interval | Click Refresh or wait |

---

## Security Notes

1. No API keys in code — env vars only; every key documented in `.env.example`
2. `user_id` path parameter is untrusted — storage keys must be validated so local writes cannot escape `local_data/`
3. Twilio webhook: validate `X-Twilio-Signature` before production traffic
4. Transcript data is PII — `local_data/` is gitignored; never commit audio or transcript content
5. All `/users/{user_id}/*` routes must validate user context before production deployment

---

## Project Docs

| Doc | Purpose |
|-----|---------|
| [CLAUDE.md](CLAUDE.md) | Canonical project reference for AI coding agents — architecture, data contracts, patterns, security |
| [AGENTS.md](AGENTS.md) | Thin adapter for Codex + other non-Claude AI agents — agent stubs, workflow mapping |
| [HANDOFF.md](HANDOFF.md) | Subsystem data contracts and interface specs (read before touching interface boundaries) |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Setup, AWS, Twilio config, demo runbook |
| [.cursorrules](.cursorrules) | Thin adapter for Cursor AI |
| [.windsurfrules](.windsurfrules) | Thin adapter for Windsurf AI |
| [wiki/](wiki/) | Long-form guides and research notes |
| [decisions/](decisions/) | Architecture decision records |

---

**Stack:** Pipecat · Gemini 3.1 Flash Live · NVIDIA NIM · Twilio · Daily · Cekura · ChromaDB · FastAPI · Next.js · AWS
