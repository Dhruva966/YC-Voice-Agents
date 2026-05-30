# forge/api — CLAUDE.md

**Purpose:** All HTTP and WebSocket endpoints for Forge. The only file here is `main.py` — it owns every route, background task dispatch, and the Twilio media-stream WebSocket pipeline.

→ Root: [CLAUDE.md](../../CLAUDE.md)

## Key Files
| What | Where |
|------|-------|
| FastAPI app + all routes | `main.py:app` |
| Twilio media-stream pipeline | `main.py:media_stream()` WebSocket |
| Build pipeline dispatcher | `main.py:_run_build()` (runs in background thread) |
| Vanguard dispatcher | `main.py:_run_vanguard_background()` |
| Live Vanguard results cache | `main.py:_vanguard_live` dict |
| Dashboard aggregation | `main.py:dashboard()` |
| System status | `main.py:get_user_status()` |
| Chat endpoint | `main.py:chat()` |

## Allowed Patterns

✅ **All long-running work goes in BackgroundTasks or a background thread:**
```python
@app.post("/users/{user_id}/build")
async def build(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    job_id = str(uuid.uuid4())
    background_tasks.add_task(_run_build, user_id, job_id)
    return QueuedResponse(job_id=job_id, status="queued")
```

✅ **All storage via shim — never raw boto3:**
```python
from storage import s3_client as _s3_client, bucket_name as _bucket

_s3_client().put_object(Bucket=_bucket(), Key=key, Body=data)
```

✅ **Status updates during long jobs use two keys (job-specific + latest):**
```python
def _put_status(user_id: str, job_id: str, payload: dict) -> None:
    _s3_client().put_object(Bucket=_bucket(), Key=f"{user_id}/build_status/{job_id}.json", ...)
    _s3_client().put_object(Bucket=_bucket(), Key=f"{user_id}/build_status/latest.json", ...)
```

✅ **Gemini Live pipeline in `/media-stream` — audio-to-audio, no separate STT/TTS:**
```python
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService

llm = GeminiLiveLLMService(
    api_key=os.getenv("GEMINI_API_KEY"),
    settings=GeminiLiveLLMService.Settings(
        model=os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview"),
        system_instruction=initial_system_prompt,
        voice=os.getenv("GEMINI_VOICE", "Puck"),
    ),
)
```

✅ **Daily room creation is async (httpx), always with expiry:**
```python
async with httpx.AsyncClient(timeout=30) as client:
    room_response = await client.post(
        "https://api.daily.co/v1/rooms",
        json={"properties": {"exp": int(time.time()) + 3600}},
    )
```

## Forbidden Patterns

❌ **Never import boto3 directly:**
```python
# WRONG
import boto3
s3 = boto3.client("s3")

# RIGHT
from storage import s3_client as _s3_client
s3 = _s3_client()
```

❌ **Never block the event loop in an async route:**
```python
# WRONG — blocks uvicorn's event loop
@app.post("/users/{user_id}/build")
async def build(user_id: str):
    result = extract_personality(corpus)  # CPU-bound, blocks

# RIGHT
result = await asyncio.to_thread(extract_personality, corpus)
```

❌ **Never put prompts inline — all prompts live in prompts.py:**
```python
# WRONG
system_prompt = f"You are a helpful assistant named {name}..."

# RIGHT
from prompts import persona_system
system_prompt = persona_system(user_id, spec, chunks)
```

❌ **Never hardcode user_id = "demo" in production routes:**
```python
# WRONG (demo shortcut, not for reuse)
spec = load_personality_spec("demo", ...)

# RIGHT — use the path parameter
spec = load_personality_spec(user_id, ...)
```

## What NOT to Do

1. **Don't add new routes without a status/polling endpoint** if the work takes >5 seconds. The frontend needs something to poll.

2. **Don't handle Twilio WebSocket errors by silently passing.** Log them, close with a non-1000 code, and let the caller retry.

3. **Don't run `asyncio.run()` inside an async route.** It creates a new event loop and will crash under uvicorn. Use `asyncio.to_thread()` for sync-in-async or `background_tasks.add_task()`.

4. **Don't grow `_vanguard_live` unboundedly.** It's an in-process dict. If you add routes, add cleanup when a run completes.

5. **Don't trust the `user_id` path parameter.** It goes directly into storage keys. The shim sanitizes it, but don't use it in subprocess calls, shell commands, or log injection contexts.
