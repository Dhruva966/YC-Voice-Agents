# Forge — HANDOFF.md

Contracts between subsystems. Read this when touching an interface boundary.

## Subsystem Map

```
[Browser / Twilio caller]
        │
        ▼
[forge/api/main.py] ─── background thread ──► [forge/pipeline/persona_bot.py]
        │                                         │
        │                               [Gemini 3.1 Flash Live]
        │                               [forge/rag/retriever.py]
        │
        ├── _run_build() ──────────────► [forge/ingestion/pipeline.py]
        │                                    └── [forge/ingestion/transcript_scorer.py]
        │                                    └── [forge/personality/extractor.py]
        │                                    └── [forge/rag/retriever.py]
        │                                    └── [forge/finetune/persona_finetune.py]
        │
        └── _run_vanguard_background() ► [forge/vanguard/orchestrator.py]
                                              └── [forge/pipeline/attacker_bot.py]
                                              └── [forge/cekura/evaluator.py]
                                              └── [forge/autoloop/loop_controller.py]
```

---

## Data Contracts

### `ingest_file()` → build pipeline
**Producer:** `forge/ingestion/pipeline.py:ingest_file()`
**Consumer:** `forge/api/main.py:_run_build()` via `get_user_corpus()`, `get_user_transcripts()`, `get_user_knowledge_base_texts()`

```python
# ingest_file returns:
{
    "job_id": str,
    "user_id": str,
    "input_type": "audio" | "text" | "pdf" | "docx",
    "s3_original_path": str,
    "s3_transcript_path": str | None,
    "s3_isolated_audio_path": str | None,
    "s3_corpus_path": str | None,
    "s3_knowledge_base_path": str | None,
    "speakers": list,
    "quality": dict,
    "status": "completed" | "failed",
    "errors": list[str],
}
```

### `score_transcripts()` → fine-tune pipeline
**Producer:** `forge/ingestion/transcript_scorer.py:score_transcripts()`
**Consumer:** `forge/finetune/persona_finetune.py:generate_synthetic_conversations()`

```python
# ScoredTranscriptResult shape:
{
    "turns": [                          # all scored turns
        {
            "caller": str,
            "agent": str,
            "source_file": str,
            "turn_index": int,
            "scores": {
                "empathy": float,       # 0–10
                "objection_handling": float,
                "naturalness": float,
                "conversational_flow": float,
                "closing_technique": float,
                "aggregate": float,
            }
        }
    ],
    "top_k_turns": [...],               # subset of turns, sorted by aggregate score desc
    "aggregate_score": float,           # mean across all turns
    "dimension_scores": {               # mean per dimension
        "empathy": float, ...
    }
}
```

### `extract_personality()` → persona pipeline
**Producer:** `forge/personality/extractor.py:extract_personality()`
**Consumer:** `forge/pipeline/persona_bot.py:build_initial_system_prompt()`, `forge/prompts.py:persona_system()`

```python
# personality_spec.json shape:
{
    "communication_style": {
        "formality": str,           # e.g. "professional-casual"
        "hedging_frequency": str,   # "low" | "medium" | "high"
        "humor_style": str,
        "pacing": str,
    },
    "knowledge_domains": [
        {"domain": str, "depth": str}
    ],
    "core_values": [str],
    "boundaries": [str],            # what the agent won't do
    "signature_phrases": [str],     # verbatim phrases from transcripts
    "objection_responses": [str],   # best objection handling lines
}
```

### `run_vanguard()` → improvement loop
**Producer:** `forge/vanguard/orchestrator.py:run_vanguard()`
**Consumer:** `forge/autoloop/loop_controller.py:run_improvement_cycle()`

```python
# Vanguard run result (stored at {user_id}/vanguard_runs/{run_id}.json):
{
    "run_id": str,
    "user_id": str,
    "timestamp": float,
    "total": int,
    "passed": int,
    "failed": int,
    "pass_rate": float,             # 0.0–1.0
    "duration_seconds": float,
    "sessions": [
        {
            "session_id": str,
            "attack_definition_id": str, # original attack_suite item id, if present
            "attack_persona": str,  # key from ATTACKER_PERSONAS
            "status": "running" | "passed" | "failed",
            "overall_score": float, # 0–100
            "duration_seconds": float,
            "transcript": {
                "turns": [{"role": str, "text": str}]
            },
            "evaluation": {
                "overall_pass": bool,
                "overall_score": float,
                "dimension_scores": {
                    "character_consistency": float,
                    "jailbreak_resistance": float,
                    "factual_accuracy": float,
                    "graceful_degradation": float,
                },
                "failure_annotations": [...],
                "provider": "nvidia_nim",
                "cekura_call_log_id": str, # optional, when Cekura observe succeeds
                "cekura_url": str,         # optional, when Cekura observe succeeds
            }
        }
    ]
}
```

### `evaluate_transcript()` → vanguard sessions
**Producer:** `forge/cekura/evaluator.py:evaluate_transcript()`
**Consumer:** `forge/vanguard/orchestrator.py:_run_one_session()`

```python
# Evaluation result:
{
    "overall_pass": bool,
    "overall_score": float,         # 0–100
    "dimension_scores": {
        "character_consistency": float,
        "jailbreak_resistance": float,
        "factual_accuracy": float,
        "graceful_degradation": float,
    },
    "failure_annotations": [
        {
            "failure_turn": int,
            "correct_response": str,
        }
    ],
    "provider": "nvidia_nim",
    "cekura_call_log_id": str, # optional, when Cekura observe succeeds
    "cekura_url": str,         # optional, when Cekura observe succeeds
}
```

---

## Integration Checklist

When modifying an interface, verify all consumers:

| Interface | Producers | Consumers |
|-----------|-----------|-----------|
| `ingest_file()` return shape | `forge/ingestion/pipeline.py` | `forge/api/main.py:_run_build()` |
| `ScoredTranscriptResult` | `forge/ingestion/transcript_scorer.py` | `forge/finetune/persona_finetune.py`, frontend score cards |
| `personality_spec.json` | `forge/personality/extractor.py` | `forge/prompts.py:persona_system()`, `forge/pipeline/persona_bot.py` |
| Vanguard run JSON | `forge/vanguard/orchestrator.py` | `forge/api/main.py:vanguard_runs()`, `forge/autoloop/loop_controller.py`, frontend |
| Evaluation result | `forge/cekura/evaluator.py` | `forge/vanguard/orchestrator.py:_run_one_session()` |
| Attack suite JSON | `forge/vanguard/orchestrator.py` | `forge/api/main.py:load_attack_suite()`, `forge/autoloop/loop_controller.py` |

Note: `attack_suite.json` stores reusable attack definitions. `run_vanguard()` must create fresh `session_id` values per run because Daily rooms and external evaluators key by session.

---

## Storage Key Conventions

All keys follow `{user_id}/{category}/{filename}`. Never omit the user_id prefix.

```
{user_id}/uploads/{filename}
{user_id}/audio/{filename}.wav
{user_id}/transcripts/{filename}.json
{user_id}/isolated_audio/{filename}.wav
{user_id}/transcript_scores/{filename}.json   ← new
{user_id}/personality/personality_spec.json
{user_id}/voice_id.txt
{user_id}/adapter_id.txt
{user_id}/attack_suite.json
{user_id}/vanguard_runs/{run_id}.json
{user_id}/improvement_cycles/{N}.json
{user_id}/build_status/latest.json
{user_id}/build_status/{job_id}.json
{user_id}/finetune/examples.jsonl
```

---

## Endpoints Needed by Each Subsystem

| Subsystem | Needs | Endpoint |
|-----------|-------|---------|
| Vanguard orchestrator | Persona bot to join a room | `POST /join_room` |
| Frontend | Build progress | `GET /users/{id}/build/status` |
| Frontend | Live Vanguard results | `GET /users/{id}/vanguard/runs/{run_id}/live` |
| Frontend | System readiness | `GET /users/{id}/status` |
| Frontend | Dashboard aggregation | `GET /users/{id}/dashboard` |
| Frontend | Per-transcript scores | `GET /users/{id}/transcript_scores` ← add this |
| Twilio | User-scoped inbound webhook | `POST /users/{id}/webhook/twilio/inbound` |

---

## Events / Async Actions Requiring Coordination

| Event | Who fires | Who listens |
|-------|-----------|------------|
| Build job starts | `api/main.py:build()` | Frontend polls `/build/status` |
| Build stage changes | `api/main.py:_put_status()` | Frontend polls `/build/status` |
| Vanguard session completes | `orchestrator.py:guarded()` | `_vanguard_live[run_id]` dict → Frontend polls `/live` |
| Vanguard run completes | `orchestrator.py:run_vanguard()` | Stored to S3; frontend stops polling |
| Improvement cycle completes | `loop_controller.py` | Dashboard refreshes pass_rate_history |
