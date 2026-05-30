# Forge — AGENTS.md

## What This Is
Forge turns bulk sales call transcripts into production-ready voice agents. Companies upload their calls — Forge scores, curates, fine-tunes, and delivers a Twilio webhook URL. Paste it in. Done.

The pitch: every other team built a voice agent. Forge builds the infrastructure that makes voice agents production-ready, continuously improving, and verifiably robust before they ship.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Voice pipeline | Pipecat + Gemini 3.1 Flash Live (STT + LLM + TTS, audio-to-audio) |
| Telephony | Twilio (WebSocket media stream) |
| Transport | Daily (WebRTC for Daily room calls + Vanguard sessions) |
| Fine-tuning | NVIDIA NIM LoRA Customization API |
| RAG embeddings | NVIDIA NIM (`nvidia/llama-3.2-nv-embedqa-1b-v2`) |
| Transcript scoring | NVIDIA NIM (`meta/llama-4-maverick-17b-128e-instruct`) |
| Evaluation | Cekura (LLM fallback: NVIDIA NIM) |
| Vector DB | ChromaDB (local) / pgvector (prod) |
| Storage | `storage.py` shim → `./local_data/` (local) or AWS S3 (prod) |
| Compute | AWS EC2 |
| Backend | FastAPI (Python 3.11+) |
| Frontend | Next.js 14 (TypeScript, Tailwind) |
| Audio transcription | faster-whisper (local, large-v3) |

## Directory Structure
```
forge/
├── api/main.py              ← All HTTP + WebSocket endpoints
├── pipeline/
│   ├── persona_bot.py       ← Pipecat + Gemini Live pipeline
│   └── attacker_bot.py      ← Attacker pipeline for Vanguard
├── vanguard/orchestrator.py ← Concurrent attack sessions, Cekura scoring
├── cekura/evaluator.py      ← Cekura first; NVIDIA NIM fallback
├── autoloop/loop_controller.py ← Failure annotation → fine-tune → regression
├── ingestion/
│   ├── pipeline.py          ← ingest_file() entry point
│   ├── transcript_scorer.py ← [NEW] LLM quality scoring (5 dimensions)
│   ├── transcribe.py        ← faster-whisper audio → text
│   └── diarize.py           ← pyannote speaker diarization
├── personality/extractor.py ← extract_personality() via NVIDIA NIM
├── rag/retriever.py         ← ChromaDB / pgvector
├── finetune/persona_finetune.py ← NVIDIA NIM LoRA fine-tune jobs
├── frontend/app/page.tsx    ← Dashboard: Build / Agent / Vanguard / Improvement
├── storage.py               ← S3 shim
└── prompts.py               ← ALL prompts — edit here only
```

## Agent Model Routing
| Task Type | Model |
|-----------|-------|
| Isolated edits, boilerplate, narrow transforms (1–2 files) | Haiku |
| Feature implementation, multi-file integration, refactors | Sonnet |
| Architecture decisions, root-cause analysis, security review | Opus |

Escalate only when lower tier fails with a clear reasoning gap.

## Key Entry Points
| What | Where |
|------|-------|
| FastAPI app | `api/main.py:app` |
| Pipecat voice pipeline (Daily) | `pipeline/persona_bot.py:run_persona_bot()` |
| Twilio inbound webhook | `api/main.py:POST /webhook/twilio/inbound` |
| Twilio media stream (Gemini Live) | `api/main.py:WS /media-stream` |
| Build pipeline | `api/main.py:POST /users/{user_id}/build` → `_run_build()` |
| Transcript scoring | `ingestion/transcript_scorer.py:score_transcripts()` |
| Vanguard attack | `api/main.py:POST /users/{user_id}/vanguard/run` |
| All prompts | `prompts.py` |
| Storage shim | `storage.py:s3_client(), bucket_name()` |

## Security Non-Negotiables
1. No API keys in code — env vars only; every key in `.env.example`
2. `user_id` path param is untrusted — `storage.py` enforces `lstrip("/")` to block path traversal
3. Twilio webhook must validate `X-Twilio-Signature` before production
4. Transcript data is PII — `local_data/` is gitignored; never commit audio or transcripts
5. No unguarded endpoints — all `/users/{user_id}/*` routes validate user context before prod

## Testing Standard
- Regression test every modified domain
- Integration tests hit real ChromaDB, not mocks
- External API calls mocked at HTTP boundary via `httpx`
- Transcript scorer tested with edge case fixtures
- Read the code — never trust the implementer's report

## Agent-Driven Development Workflow
Every non-trivial task:
1. Decompose into 15-minute units (single dominant risk, verifiable done condition)
2. Dispatch to fresh implementer subagent with full task text + file context
3. Spec review: read the code, verify against requirements
4. Quality review: clean, tested, no regressions
5. Commit per task, not per feature

Parallel dispatch: independent tasks (different files, no shared state) only.
Sequential: shared state (`prompts.py`, `storage.py`, RAG) or ordering dependencies.

## Common Task Patterns

### Adding a new API endpoint
1. Add route to `api/main.py`
2. Wrap long-running work in `BackgroundTasks`
3. Persist result via `_s3_client().put_object(...)`
4. Add status endpoint if async
5. Wire into `frontend/app/page.tsx`

### Extending the transcript pipeline
1. Add step to `ingestion/pipeline.py:ingest_file()`
2. Add prompts to `prompts.py` only — never inline
3. Update `api/main.py:_run_build()` stage name
4. Update `BUILD_STEPS` in `frontend/app/page.tsx`

### Adding a new attacker persona
1. Add key + prompt to `prompts.py:ATTACKER_PERSONAS`
2. `vanguard/orchestrator.py:build_default_attack_suite()` picks it up automatically

### Running a fine-tune job
1. Score → `ingestion/transcript_scorer.py:score_transcripts()`
2. Format → `finetune/persona_finetune.py:generate_synthetic_conversations()`
3. Submit → `submit_finetune(user_id, examples, label)`

## gstack + Superpowers Workflow
| Phase | Tools |
|-------|-------|
| 1 IDEATION | /office-hours |
| 2 PLANNING | /autoplan → writing-plans → blueprint |
| 3 IMPLEMENT | subagent-driven-development + using-git-worktrees |
| 4 REVIEW | /review → /qa → /cso → /health |
| 5 RELEASE | /ship → /land-and-deploy → /canary |
| 6 REFLECT | /retro → /learn → context-save |

## Environment Setup
| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | ✅ | Gemini 3.1 Flash Live voice pipeline |
| `NVIDIA_API_KEY` | ✅ | Fine-tuning, RAG embeddings, transcript scoring |
| `NVIDIA_BASE_URL` | ✅ | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_BASE_MODEL` | ✅ | `meta/llama-4-maverick-17b-128e-instruct` |
| `NVIDIA_EMBEDDING_MODEL` | ✅ | `nvidia/llama-3.2-nv-embedqa-1b-v2` |
| `DAILY_API_KEY` | ✅ | Daily room creation |
| `TWILIO_ACCOUNT_SID` | ✅ | Twilio telephony |
| `TWILIO_AUTH_TOKEN` | ✅ | Twilio auth |
| `TWILIO_PHONE_NUMBER` | ✅ | Inbound phone number |
| `CEKURA_API_KEY` | ✅ | Transcript evaluation |
| `CEKURA_BASE_URL` | ✅ | Cekura endpoint |
| `USE_LOCAL_STORAGE` | optional | `true` (default) → `./local_data/` |
| `USE_LOCAL_RAG` | optional | `true` (default) → ChromaDB |
| `TRANSCRIPT_SCORE_TOP_K` | optional | Top segments per dimension (default: `50`) |
| `NVIDIA_CUSTOMIZATION_BASE_URL` | optional | LoRA fine-tune submission |
| `PERSONA_AGENT_URL` | optional | `http://localhost:8000` local |

---

## Codex Agent Stubs

```toml
[agents.implementer]
description = "Implement a single task from the plan. Read the CLAUDE.md and relevant subsystem CLAUDE.md first. Verify your output matches the spec exactly — do not summarize."
model = "codex-1"

[agents.spec-reviewer]
description = "Verify implementation matches spec. Read the actual code — do not trust the implementer's report. Check: correct files modified, no extra changes, edge cases handled."
model = "codex-1"

[agents.quality-reviewer]
description = "Verify implementation is clean, tested, and maintainable. Check: no inline prompts (all prompts in prompts.py), no raw boto3 calls (use storage shim), no hardcoded values, tests exist."
model = "codex-1"

[agents.transcript-scorer-agent]
description = "Score and select the best transcript segments from a batch. Use NVIDIA NIM for scoring. Return top-K turns per dimension formatted as NVIDIA NIM finetune JSONL."
model = "codex-1"

[agents.vanguard-analyst]
description = "Analyze a Vanguard run result. Identify failure patterns per persona. Propose harder attack variants for the next cycle."
model = "codex-1"
```

## Skill Catalog

| Trigger | Skill | Phase |
|---------|-------|-------|
| New feature idea | /office-hours | Ideation |
| Starting feature | /autoplan + writing-plans | Planning |
| Multi-file work | subagent-driven-development | Implement |
| Parallel tasks | using-git-worktrees | Implement |
| Pre-PR | /review + /qa | Review |
| Security check | /cso | Review |
| Health check | /health | Review |
| Shipping | /ship → /land-and-deploy | Release |
| Post-deploy | /canary | Release |
| Weekly | /retro + /learn | Reflect |
| Save context | context-save | Any |
