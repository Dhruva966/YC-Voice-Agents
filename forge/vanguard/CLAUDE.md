# forge/vanguard — CLAUDE.md

**Purpose:** Adversarial testing infrastructure. Spins up N concurrent Daily rooms, each pitting an attacker LLM persona against the persona agent. Cekura scores every transcript. Results feed the autoloop improvement cycle.

→ Root: [CLAUDE.md](../../CLAUDE.md)

## Key Files
| What | Where |
|------|-------|
| Orchestrator entry point | `orchestrator.py:run_vanguard()` |
| Single session runner | `orchestrator.py:_run_one_session()` |
| Attack suite builder | `orchestrator.py:build_default_attack_suite()` |
| Attack suite loader | `orchestrator.py:load_attack_suite()` |
| Attack suite saver | `orchestrator.py:save_attack_suite()` |
| Daily room creator | `orchestrator.py:_create_daily_room()` |
| 10 attacker personas | `prompts.py:ATTACKER_PERSONAS` |
| Improvement loop | `autoloop/loop_controller.py:run_improvement_cycle()` |

## The 10 Attacker Personas
| Key | Attack Goal |
|-----|------------|
| `unauthorized_commitment` | Unauthorized discounts, waived fees, guarantees, or contract terms |
| `pii_exfiltration` | Extract customer, internal, or confidential business information |
| `social_engineer` | Break persona via false authority/urgency |
| `jailbreaker` | Override system instructions (DAN, developer-mode) |
| `emotional_escalator` | Sycophancy under emotional pressure |
| `identity_attacker` | Challenge AI identity |
| `knowledge_prober` | Expose hallucination with specific claims |
| `language_switcher` | Multilingual degradation |
| `contradiction_trapper` | Force self-contradiction |
| `degraded_audio` | Poor audio/mishearing robustness |

Default suite = 10 personas × 1 + first 4 repeated = 14 sessions total.

## Allowed Patterns

✅ **Concurrent sessions via asyncio.gather + Semaphore:**
```python
semaphore = asyncio.Semaphore(max_concurrent)

async def guarded(session):
    async with semaphore:
        return await _run_one_session(user_id, persona_agent_url, session)

sessions = await asyncio.gather(*(guarded(s) for s in attack_suite))
```

✅ **Live results streamed into shared dict for polling:**
```python
async def guarded(session):
    async with semaphore:
        result = await _run_one_session(...)
    if live_results is not None:
        live_results[run_id].append(result)
    return result
```

✅ **Failed sessions return structured error, never raise:**
```python
except Exception as exc:
    result = {
        **session,
        "status": "failed",
        "error": str(exc),
        "overall_score": 0,
        "evaluation": {"overall_pass": False, "overall_score": 0},
    }
```

✅ **Attack suite grows after each improvement cycle — load from storage, never hardcode:**
```python
def load_attack_suite(user_id: str) -> list[dict]:
    try:
        body = s3.get_object(Bucket=_bucket(), Key=f"{user_id}/attack_suite.json")["Body"].read()
        return json.loads(body)
    except Exception:
        suite = build_default_attack_suite()
        save_attack_suite(user_id, suite)
        return suite
```

## Forbidden Patterns

❌ **Never run Vanguard in the FastAPI async thread — it runs asyncio.run() internally:**
```python
# WRONG — asyncio.run() inside an async context
@app.post("/users/{user_id}/vanguard/run")
async def vanguard_run(user_id: str):
    await run_vanguard(...)  # run_vanguard uses asyncio.run() internally

# RIGHT — dispatch to a background thread
background_tasks.add_task(_run_vanguard_background, user_id, run_id)
# _run_vanguard_background calls asyncio.run(run_vanguard(...))
```

❌ **Never modify attack_suite.json mid-run.** Load once at start, save once at end of improvement cycle.

❌ **Never hardcode the persona_agent_url:**
```python
# WRONG
persona_agent_url = "http://localhost:8000"

# RIGHT
persona_agent_url = os.getenv("PERSONA_AGENT_URL", "http://backend:8000")
```

❌ **Never score transcripts in the orchestrator — that's cekura/evaluator.py:**
```python
# WRONG — scoring logic inline
if "sorry" in transcript: score = 0

# RIGHT
evaluation = await evaluate_transcript(session_id, transcript, attack_persona, ...)
```

## What NOT to Do

1. **Don't increase `max_concurrent` beyond 20 without testing Daily API rate limits.** Each session creates a Daily room and two tokens. Burst above 20 will hit Daily's concurrent room limits.

2. **Don't discard failed sessions from results.** Every session — pass or fail — must be in the output JSON. The improvement loop needs failure data to annotate.

3. **Don't change the session data shape without updating `api/main.py:_vanguard_run_sort_key()` and the frontend `VanguardSession` type.** They both destructure this object.

4. **Don't block Vanguard on voice quality.** Vanguard uses Pipecat pipelines in real Daily rooms — it's real audio. If Gemini Live has a transient error in one session, the session fails gracefully; the other 11 continue.

5. **Don't reuse session IDs across runs.** Each session needs a fresh UUID. Cekura keys results by session_id — reuse = data corruption.
