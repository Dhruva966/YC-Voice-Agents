# Forge

## What This Is
Forge turns bulk call transcripts into a pre-production safety gate for voice agents. Companies upload redacted calls — Forge scores, curates, builds a RAG-backed Gemini Live agent, red-teams it, and reports readiness before deployment.

The pitch: every other team built a voice agent. Forge builds the infrastructure that makes voice agents measurable, adversarially tested, and harder to ship on vibes.

Current boundary: the live runtime is Gemini Live with prompts/RAG. NVIDIA LoRA fine-tune jobs can be prepared/submitted and an adapter ID can be saved, but Gemini Live does not load that adapter today.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Voice pipeline | Pipecat + Gemini 3.1 Flash Live (STT + LLM + TTS, audio-to-audio) |
| Telephony | Twilio (WebSocket media stream) |
| Transport | Daily (WebRTC for Daily room calls + Vanguard sessions) |
| Fine-tuning | NVIDIA NIM LoRA Customization API path; adapter saved/displayed, not loaded by Gemini Live runtime |
| RAG embeddings | NVIDIA NIM (`nvidia/llama-nemotron-embed-1b-v2`) |
| Transcript scoring | NVIDIA NIM (`meta/llama-4-maverick-17b-128e-instruct`) |
| Evaluation | Cekura (LLM fallback: NVIDIA NIM) |
| Vector DB | ChromaDB (local) / pgvector (prod) |
| Storage | `storage.py` shim → `./local_data/` (local) or AWS S3 (prod) |
| Compute | AWS EC2 |
| Backend | FastAPI (Python 3.11+) |
| Frontend | Next.js 14 (TypeScript, Tailwind) |
| Audio transcription | faster-whisper (local, `base` default; `large-v3` optional) |

**Dropped from old stack:** Deepgram STT, ElevenLabs TTS — both replaced by Gemini 3.1 Flash Live (audio-to-audio, one model handles everything).

## Directory Structure
```
forge/
├── api/
│   └── main.py              ← All HTTP + WebSocket endpoints
├── pipeline/
│   ├── persona_bot.py       ← Pipecat + Gemini Live pipeline (Daily + Twilio transport)
│   └── attacker_bot.py      ← Attacker Pipecat pipeline for Vanguard sessions
├── vanguard/
│   └── orchestrator.py      ← Concurrent attack sessions, Cekura scoring, S3 persist
├── cekura/
│   └── evaluator.py         ← Cekura first; NVIDIA NIM fallback (3 parallel rubric calls)
├── autoloop/
│   └── loop_controller.py   ← Failure annotation → fine-tune → regression gate → harder variants
├── ingestion/
│   ├── pipeline.py          ← ingest_file() entry point; routes by file type
│   ├── transcript_scorer.py ← [NEW] LLM quality scoring of transcript segments (5 dimensions)
│   ├── transcribe.py        ← faster-whisper audio → text with word timestamps
│   ├── diarize.py           ← pyannote speaker diarization (graceful fallback)
│   └── text_cleaner.py      ← Normalize encoding, strip metadata
├── personality/
│   └── extractor.py         ← extract_personality() → personality_spec.json via NVIDIA NIM
├── rag/
│   └── retriever.py         ← ChromaDB (USE_LOCAL_RAG=true) / pgvector (false)
├── finetune/
│   └── persona_finetune.py  ← generate_synthetic_conversations() + submit_finetune()
├── voice/
│   └── clone.py             ← Legacy ElevenLabs clone (unused with Gemini Live; kept for reference)
├── frontend/
│   └── app/page.tsx         ← Dashboard: Build / Agent / Vanguard / Improvement
├── storage.py               ← S3 shim: USE_LOCAL_STORAGE=true → ./local_data/
└── prompts.py               ← ALL prompts: persona_system, transcript_quality_score,
                                ATTACKER_PERSONAS (10), eval rubrics, finetune formatters
```

## Agent Capability Routing
Use the strongest available local agent/model tier that matches the risk of the task. These names are Claude Code defaults, but other tools should map them to their nearest equivalent instead of treating the names literally.

| Task Type | Claude Code tier | Generic equivalent |
|-----------|------------------|--------------------|
| Isolated edits, boilerplate, narrow transforms (1-2 files) | Haiku | small/fast coding model |
| Feature implementation, multi-file integration, refactors | Sonnet | standard coding/reasoning model |
| Architecture decisions, root-cause analysis, security review | Opus | strongest available reasoning model |

Escalate only when the current tier shows a clear reasoning gap, the blast radius grows, or the task crosses a high-risk boundary such as auth, security, data loss, deployment, or external billing.

## Key Entry Points
| What | Where |
|------|-------|
| FastAPI app | `forge/api/main.py:app` |
| Pipecat voice pipeline (Daily) | `forge/pipeline/persona_bot.py:run_persona_bot()` |
| Twilio inbound webhook | `forge/api/main.py:POST /users/{user_id}/webhook/twilio/inbound` (`/webhook/twilio/inbound` remains demo-only) |
| Twilio media stream (Gemini Live) | `forge/api/main.py:WS /media-stream` |
| Daily room call | `forge/api/main.py:POST /users/{user_id}/call` |
| Build pipeline | `forge/api/main.py:POST /users/{user_id}/build` -> `_run_build()` |
| Transcript scoring | `forge/ingestion/transcript_scorer.py:score_transcripts()` |
| Vanguard attack | `forge/api/main.py:POST /users/{user_id}/vanguard/run` |
| Improvement cycle | `forge/api/main.py:POST /users/{user_id}/vanguard/improve` |
| All prompts | `forge/prompts.py` - edit here only, never inline |
| Storage shim | `forge/storage.py:s3_client(), bucket_name()` |
| RAG | `forge/rag/retriever.py:retrieve(), build_knowledge_base()` |
| Fine-tune | `forge/finetune/persona_finetune.py:submit_finetune()` |
| Dashboard data | `forge/api/main.py:GET /users/{user_id}/dashboard` |

## Database Schema

All paths in this section are repo-root relative unless they explicitly start with `./local_data`.

**ChromaDB collection:** `user_{user_id}`
- Each document: transcript segment or knowledge chunk
- Metadata: `source`, `turn_index`, `quality_score`, `persona_dimension`
- Queried via: `forge/rag/retriever.py:retrieve(user_id, query, top_k=5)`

**Fine-tune training data:** `./local_data/{user_id}/finetune/examples.jsonl`
```jsonl
{"messages": [{"role": "user", "content": "CALLER: ..."}, {"role": "assistant", "content": "AGENT: ..."}]}
```

**Personality spec:** `./local_data/{user_id}/personality/personality_spec.json`
Keys: `communication_style`, `knowledge_domains`, `core_values`, `boundaries`

**Transcript scores:** `./local_data/{user_id}/transcript_scores/{filename}.json`
Keys: `turns[]`, `top_k_turns[]` (selected), `aggregate_score`, `dimension_scores`

**Vanguard run:** `./local_data/{user_id}/vanguard_runs/{run_id}.json`
Keys: `run_id`, `total`, `passed`, `failed`, `pass_rate`, `duration_seconds`, `sessions[]`

**Attack suite:** `./local_data/{user_id}/attack_suite.json`
Array of attack definitions. Stored `session_id` values are definition IDs only; `run_vanguard()` creates fresh per-run session IDs.

## Security Non-Negotiables
1. No API keys in code — env vars only; every key documented in `.env.example`
2. `user_id` path param is untrusted — API routes validate a restricted ID format and `storage.py` blocks path traversal
3. Twilio webhook must validate `X-Twilio-Signature` before production traffic
4. Transcript data is PII — `local_data/` is gitignored; never commit audio or transcript content
5. No unguarded endpoints — all `/users/{user_id}/*` routes must validate user context before prod

## Testing Standard
- Regression test every modified domain (ingestion, scoring, pipeline, vanguard)
- Integration tests hit real ChromaDB, not mocks
- External API calls (NVIDIA NIM, Gemini, Cekura, Twilio, Daily) mocked at HTTP boundary via `httpx`
- Transcript scorer tested with fixtures: empty turns, very short calls, non-English, no AGENT turns
- Never trust the implementer's report — read the actual code and verify

## Agent-Driven Development Workflow
Every non-trivial task:
1. Decompose into 15-minute units (single dominant risk, verifiable done condition)
2. Dispatch to fresh implementer subagent with full task text + file context
3. Spec review: read the code, verify against requirements (not the report)
4. Quality review: clean, tested, no regressions
5. Commit per task, not per feature

Parallel dispatch: independent tasks (different files, no shared state) only.
Sequential: shared state (`prompts.py`, `storage.py`, RAG) or ordering dependencies.

## Common Task Patterns

### Adding a new API endpoint
1. Add route to `forge/api/main.py`
2. Wrap long-running work in `BackgroundTasks`
3. Persist result via `_s3_client().put_object(...)` with status polling key
4. Add status endpoint if async
5. Wire into `forge/frontend/app/page.tsx` - fetch + state

### Extending the transcript pipeline
1. Add step to `forge/ingestion/pipeline.py:ingest_file()`
2. Add any new prompts to `forge/prompts.py` only - never inline
3. Update `forge/api/main.py:_run_build()` stage name for status reporting
4. Update `BUILD_STEPS` in `forge/frontend/app/page.tsx`

### Adding a new attacker persona
1. Add key + prompt string to `forge/prompts.py:ATTACKER_PERSONAS`
2. `forge/vanguard/orchestrator.py:build_default_attack_suite()` picks it up automatically

### Modifying the Gemini Live system prompt
1. Edit `forge/prompts.py:persona_system()`
2. `_TwilioDynamicUpdater` in `forge/api/main.py` re-injects on every LLM context frame - no restart needed

### Running a fine-tune job
1. Score transcripts -> `forge/ingestion/transcript_scorer.py:score_transcripts()`
2. Format top-K -> `forge/finetune/persona_finetune.py:generate_synthetic_conversations()`
3. Submit -> `submit_finetune(user_id, examples, label)` -> NVIDIA Customization API
4. Adapter ID saved to `./local_data/{user_id}/adapter_id.txt`

### Testing Vanguard locally
```bash
curl -X POST http://localhost:8000/users/demo/vanguard/run
# Returns run_id. Poll:
curl http://localhost:8000/users/demo/vanguard/runs/<run_id>/live
```

## gstack + Superpowers Workflow
Treat this as a workflow map. Use slash commands only in tools that support them; otherwise use the equivalent local skill, review process, or manual checklist.

| Phase | Claude Code commands | Generic equivalent |
|-------|----------------------|--------------------|
| 1 IDEATION | `/office-hours` | office-hours critique |
| 2 PLANNING | `/autoplan` -> writing-plans -> blueprint | plan, decompose, define checks |
| 3 IMPLEMENT | subagent-driven-development + using-git-worktrees | bounded implementation with clear file ownership |
| 4 REVIEW | `/review` -> `/qa` -> `/cso` -> `/health` | code review, QA, security review, health checks |
| 5 RELEASE | `/ship` -> `/land-and-deploy` -> `/canary` | release workflow, deploy, monitor |
| 6 REFLECT | `/retro` -> `/learn` -> context-save | retro, durable learning, handoff |

## Environment Setup
| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | ✅ | Gemini 3.1 Flash Live — voice pipeline (STT + LLM + TTS) |
| `NVIDIA_API_KEY` | ✅ | Fine-tuning, RAG embeddings, transcript scoring |
| `NVIDIA_BASE_URL` | ✅ | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_BASE_MODEL` | ✅ | `meta/llama-4-maverick-17b-128e-instruct` |
| `NVIDIA_EMBEDDING_MODEL` | ✅ | `nvidia/llama-nemotron-embed-1b-v2` |
| `NVIDIA_EMBEDDING_DIMENSIONS` | optional | Embedding vector size requested from NVIDIA (default: `1024`) |
| `DAILY_API_KEY` | ✅ | Daily room creation (Vanguard + browser calls) |
| `TWILIO_ACCOUNT_SID` | ✅ | Twilio telephony |
| `TWILIO_AUTH_TOKEN` | ✅ | Twilio auth |
| `TWILIO_PHONE_NUMBER` | ✅ | Inbound phone number |
| `CEKURA_API_KEY` | optional | Cekura evaluation; NVIDIA NIM fallback when unset |
| `CEKURA_BASE_URL` | optional | `https://api.cekura.ai` |
| `ALLOWED_ORIGINS` | optional | Comma-separated CORS allowlist (default: `http://localhost:3000`) |
| `USE_LOCAL_STORAGE` | optional | `true` (default) → `./local_data/`; `false` → AWS S3 |
| `USE_LOCAL_RAG` | optional | `true` (default) → ChromaDB; `false` → pgvector/RDS |
| `TRANSCRIPT_SCORE_TOP_K` | optional | Top segments per scoring dimension (default: `50`) |
| `FINETUNE_MAX_WAIT_SECONDS` | optional | Max customization polling time before fallback (default: `3600`) |
| `AWS_S3_BUCKET` | optional | Required when `USE_LOCAL_STORAGE=false` |
| `AWS_ACCESS_KEY_ID` | optional | Required when `USE_LOCAL_STORAGE=false` |
| `AWS_SECRET_ACCESS_KEY` | optional | Required when `USE_LOCAL_STORAGE=false` |
| `AWS_REGION` | optional | Required when `USE_LOCAL_STORAGE=false` |
| `NVIDIA_CUSTOMIZATION_BASE_URL` | optional | LoRA fine-tune job submission endpoint |
| `NVIDIA_PERSONA_MODEL` | optional | Adapter ID after fine-tune completes; Gemini Live does not load it |
| `PERSONA_AGENT_URL` | optional | `http://localhost:8000` local / `http://backend:8000` docker |
| `HUGGINGFACE_TOKEN` | optional | Better pyannote diarization (fallback works without it) |

## Agent Tool Routing

Use the equivalent workflow mechanism in the current tool. Claude Code can use slash commands and Claude skills; Codex should use Codex skills, tools, or explicit subagents; Cursor/Windsurf should follow their native rule system. Do not copy Claude-only mechanics into other adapters.

Key routing rules:
- Product ideas/brainstorming -> office-hours style critique
- Strategy/scope -> plan review before implementation
- Architecture -> engineering plan review
- Design system/plan review -> design critique before coding
- Full review pipeline -> plan, implement, review, verify
- Bugs/errors -> systematic investigation before fixes
- QA/testing site behavior -> browser or integration QA
- Code review/diff check -> bug-risk-first code review
- Visual polish -> design review with screenshots when possible
- Ship/deploy/PR -> release workflow with checks and rollback awareness
- Save progress -> context-save handoff
- Resume context -> context-restore handoff
- Author a backlog-ready spec/issue -> concise spec with acceptance criteria

Agent-specific adapter files should stay thin and point back here instead of duplicating this policy.
