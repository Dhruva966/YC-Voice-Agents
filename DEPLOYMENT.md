# Forge — DEPLOYMENT.md

## Quick Start (Local, No AWS)

This mode stores files locally, but it still calls Gemini, NVIDIA, Daily, Twilio,
and optionally Cekura. Do not upload real borrower/healthcare PII unless a
redaction/private-provider path is in place.

```bash
cd forge
cp .env.example .env
# Fill: GEMINI_API_KEY, NVIDIA_API_KEY + NVIDIA_BASE_URL + NVIDIA_BASE_MODEL,
#       DAILY_API_KEY, TWILIO_*
# Leave USE_LOCAL_STORAGE=true, USE_LOCAL_RAG=true

python3 -m pip install -r requirements.txt

# Backend
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
# → http://localhost:3000

# Expose for Twilio webhook. Twilio Media Streams require a wss URL, so use
# an HTTPS tunnel or TLS-terminating proxy.
ngrok http 8000
# → Set Twilio webhook: https://<ngrok-url>/users/demo/webhook/twilio/inbound
```

---

## Environment Variables

### Required (demo fails without these)
| Variable | Value / Instructions |
|----------|---------------------|
| `GEMINI_API_KEY` | Google AI Studio → API Keys |
| `NVIDIA_API_KEY` | build.nvidia.com → API Key |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_BASE_MODEL` | `meta/llama-4-maverick-17b-128e-instruct` |
| `NVIDIA_EMBEDDING_MODEL` | `nvidia/llama-nemotron-embed-1b-v2` |
| `NVIDIA_EMBEDDING_DIMENSIONS` | `1024` |
| `DAILY_API_KEY` | dashboard.daily.co → Developers → API Key |
| `TWILIO_ACCOUNT_SID` | console.twilio.com → Account Info |
| `TWILIO_AUTH_TOKEN` | console.twilio.com → Account Info |
| `TWILIO_PHONE_NUMBER` | E.164 format, e.g. `+14155551234` |

### Local dev defaults (leave as-is for hackathon)
| Variable | Default | Effect |
|----------|---------|--------|
| `USE_LOCAL_STORAGE` | `true` | `./local_data/` instead of S3 |
| `USE_LOCAL_RAG` | `true` | ChromaDB instead of pgvector |
| `GEMINI_MODEL` | `gemini-3.1-flash-live-preview` | Gemini Live model code |
| `GEMINI_VOICE` | `Puck` | Persona voice name |
| `ATTACKER_GEMINI_VOICE` | `Charon` | Vanguard attacker voice name |
| `WHISPER_MODEL_SIZE` | `base` | Set to `large-v3` for best transcription quality |
| `TRANSCRIPT_SCORE_TOP_K` | `50` | Segments selected per scoring dimension |
| `PERSONA_AGENT_URL` | `http://localhost:8000` | Where Vanguard finds the persona API. Use `http://backend:8000` for Docker |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS allowlist for the frontend |
| `FINETUNE_MAX_WAIT_SECONDS` | `3600` | Max customization polling time before fallback |

### Optional
| Variable | When needed |
|----------|-------------|
| `NVIDIA_CUSTOMIZATION_BASE_URL` | Submitting LoRA fine-tune jobs |
| `NVIDIA_PERSONA_MODEL` | Adapter ID saved/displayed after fine-tune; Gemini Live does not load it |
| `TWILIO_STREAM_URL` | Explicit `wss://.../media-stream` override behind TLS/proxy |
| `CEKURA_API_KEY` | Cekura evaluator; NVIDIA NIM fallback is used when unset |
| `CEKURA_BASE_URL` | Cekura endpoint URL; optional with NVIDIA NIM fallback |
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
| `HUGGINGFACE_TOKEN` | Better speaker diarization via pyannote |

---

## Infrastructure Diagram

```
[Caller's Phone]
       │ PSTN
       ▼
[Twilio] ──── POST /webhook/twilio/inbound ──► [FastAPI: 8000]
              WS /media-stream ◄──────────────       │
                                               GeminiLiveLLMService
                                               rag/retriever.py (ChromaDB)
                                               prompts.py:persona_system()

[Browser]
       │ Daily WebRTC
       ▼
[Daily Room] ◄──── run_persona_bot() ──── [FastAPI: 8000]
                                               │
                                         GeminiLiveLLMService

[Vanguard]
N × Daily Rooms ──► persona bot + attacker bot ──► Cekura evaluation
                                                         │
                                               autoloop/loop_controller.py
                                               NVIDIA NIM LoRA fine-tune path

[Frontend: 3000] ──► API polling ──► FastAPI: 8000
```

---

## Twilio Webhook Setup

1. Start ngrok: `ngrok http 8000`
2. Copy the `https://` URL
3. Twilio Console → Phone Numbers → Manage → Active Numbers → your number
4. Voice Configuration:
   - **A call comes in:** Webhook
   - **URL:** `https://<ngrok-url>/users/demo/webhook/twilio/inbound`
   - **HTTP Method:** POST
5. Save. Call the number to test.

---

## AWS Setup ($25 credit path)

For serving from EC2 instead of local:

```bash
# Launch EC2 t3.medium (Ubuntu 22.04)
# ~$0.04/hr = well within $25 budget for hackathon day

# SSH in, then:
sudo apt-get update && sudo apt-get install -y python3.11 python3-pip nodejs npm
git clone <repo> && cd forge
python3 -m pip install -r requirements.txt
cp .env.example .env && nano .env  # fill keys

# Run with nohup
nohup uvicorn api.main:app --host 0.0.0.0 --port 8000 &

# Security group: open 443 inbound for TLS-terminated traffic.
# Set PERSONA_AGENT_URL=https://<public-host>
# Update Twilio webhook to https://<public-host>/webhook/twilio/inbound
```

Note: Twilio `<Stream>` establishes a `wss` WebSocket connection, and Twilio documents `wss` as the only supported protocol. For EC2 demos, put Caddy, nginx, an ALB, or ngrok in front of uvicorn instead of pointing Twilio at plain HTTP.

Do not expose an EC2/ngrok demo to untrusted users without an auth layer. The
current demo validates `user_id` shape but does not authenticate tenant access,
and public endpoints can trigger paid provider calls.

---

## Docker Compose (optional)

```bash
cd forge
docker-compose up --build
# backend → localhost:8000
# frontend → localhost:3000
# postgres → localhost:5432 (only if USE_LOCAL_RAG=false)
```

When using docker-compose: set `PERSONA_AGENT_URL=http://backend:8000` in `.env`.
The checked-in `.env.example` includes local pgvector defaults so Compose has
Postgres credentials before you add production RDS settings.

---

## Pre-Demo Checklist

Run this sequence Thursday/Friday before the hackathon:

```bash
# 1. Pre-download the Whisper model selected by .env
python3 -c "import os; from dotenv import load_dotenv; from faster_whisper import WhisperModel; load_dotenv(); WhisperModel(os.getenv('WHISPER_MODEL_SIZE', 'base'))"

# 2. Seed demo data
python3 scripts/seed_demo.py

# 3. Verify backend starts clean
uvicorn api.main:app --reload

# 4. Check system status
curl http://localhost:8000/users/demo/status | python3 -m json.tool

# 5. Verify Vanguard dependencies, then run baseline (Cycle 0 — takes ~10min)
python3 scripts/validate.py --vanguard
curl -X POST http://localhost:8000/users/demo/vanguard/run
# Save run_id, verify ~40-55% pass rate

# 6. Run improvement cycle (Cycle 1)
curl -X POST http://localhost:8000/users/demo/vanguard/improve
# Expect pass rate → 65-75%

# 7. Run Cycle 2 if time allows
# Expect pass rate → 80%+

# 8. Snapshot local_data/ — this is your pre-computed demo state
cp -r local_data/ local_data_backup/
```

---

## Demo Video Flow

1. **Skit** (~30s): Funny example sales call — one person plays customer, one plays agent
2. **Fast-forward** (~15s): Grid of 100 simultaneous calls playing at once
3. **Transcript dump** (~20s): Drag all transcripts into the Forge dashboard
4. **Build pipeline** (~30s): Watch the stepper light up — Extract → Score (show quality scores per transcript) → RAG → Fine-tune
5. **Live call** (~45s): Call the Twilio number live on camera — talk to the trained agent
6. **Vanguard** (~15s): Brief clip of adversarial sessions running + resilience score
7. **Close** (~10s): Show the webhook URL — "Paste this. Done."

---

## Runbook — If Something Breaks on Stage

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Backend won't start | Missing env var | Check `.env`, run `python3 -m dotenv run python3 -c "import os; print(os.getenv('GEMINI_API_KEY'))"` |
| `init_db()` fails at startup | ChromaDB missing | `python3 -m pip install chromadb` then restart |
| Gemini Live fails | `GEMINI_API_KEY` wrong or rate-limited | Verify key at aistudio.google.com, check quota |
| Twilio doesn't connect | ngrok URL not in Twilio console | Re-run ngrok, update webhook URL |
| Vanguard sessions all fail | `PERSONA_AGENT_URL` wrong, server down, or Gemini/Daily key issue | Confirm `http://localhost:8000`, server health, `GEMINI_API_KEY`, and `DAILY_API_KEY` |
| Cekura scores all 0 | Cekura unreachable | Expected — `"provider": "llm_fallback"` still works |
| Build hangs at fine-tune | Customization job stays pending | `FINETUNE_MAX_WAIT_SECONDS` bounds polling; build falls back to the Gemini Live base runtime |
| Transcript scorer times out | NVIDIA NIM rate limit | Reduce batch size or add retry in `transcript_scorer.py` |
| Frontend shows stale data | Dashboard poll interval (30s) | Click Refresh or wait |
