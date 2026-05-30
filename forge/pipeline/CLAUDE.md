# forge/pipeline — CLAUDE.md

**Purpose:** Pipecat pipelines for both the persona agent (voice calls) and the attacker agent (Vanguard sessions). Both runtime voice paths use Gemini 3.1 Flash Live — one audio-to-audio model replaces the old Deepgram STT + NVIDIA NIM LLM + ElevenLabs TTS triple stack.

→ Root: [CLAUDE.md](../../CLAUDE.md)

## Key Files
| What | Where |
|------|-------|
| Persona bot entry point | `persona_bot.py:run_persona_bot()` |
| Dynamic RAG context | `persona_bot.py:DynamicPersonaContext` |
| RAG query rewriter | `persona_bot.py:rewrite_rag_query()` |
| Dynamic prompt updater | `persona_bot.py:_DynamicPersonaUpdater` (FrameProcessor) |
| Initial system prompt builder | `persona_bot.py:build_initial_system_prompt()` |
| Attacker bot entry point | `attacker_bot.py:run_attacker_bot()` |

## Allowed Patterns

✅ **Gemini 3.1 Flash Live as the single voice service (STT + LLM + TTS):**
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

✅ **DailyTransport for Daily room calls (Vanguard + browser):**
```python
from pipecat.transports.services.daily import DailyTransport, DailyParams

transport = DailyTransport(
    room_url, token, "Persona", DailyParams(audio_in_enabled=True, audio_out_enabled=True)
)
```

✅ **FastAPIWebsocketTransport for Twilio inbound calls:**
```python
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.serializers.twilio import TwilioFrameSerializer

transport = FastAPIWebsocketTransport(
    websocket=websocket,
    params=FastAPIWebsocketParams(serializer=TwilioFrameSerializer(stream_sid=stream_sid), ...)
)
```

✅ **Dynamic RAG injection via FrameProcessor on each LLMContextFrame:**
```python
class _DynamicPersonaUpdater(FrameProcessor):
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if not isinstance(frame, LLMContextFrame):
            await self.push_frame(frame, direction)
            return
        # rewrite query, retrieve, rebuild prompt, push LLMUpdateSettingsFrame
```

✅ **Pipeline order (Gemini Live — no separate STT/TTS):**
```python
pipeline = Pipeline([
    transport.input(),
    context.user(),
    _DynamicPersonaUpdater(spec),
    llm,           # GeminiLiveLLMService handles audio in → audio out
    transport.output(),
    context.assistant(),
])
```

## Forbidden Patterns

❌ **Don't use DeepgramSTTService or ElevenLabsTTSService — both dropped:**
```python
# WRONG — old stack
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

# RIGHT — Gemini Live handles both
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
```

❌ **Don't use OpenAILLMService with NVIDIA NIM for live calls:**
```python
# WRONG — use for scoring/fine-tune only, not live voice
from pipecat.services.openai.llm import OpenAILLMService
llm = OpenAILLMService(api_key=NVIDIA_API_KEY, base_url=NVIDIA_BASE_URL)

# RIGHT for live calls
llm = GeminiLiveLLMService(
    api_key=GEMINI_API_KEY,
    settings=GeminiLiveLLMService.Settings(model="gemini-3.1-flash-live-preview"),
)
```

❌ **Don't block the pipeline with sync I/O — use asyncio.to_thread():**
```python
# WRONG — blocks Pipecat's event loop
query = rewrite_rag_query(history, utterance)

# RIGHT
query = await asyncio.to_thread(rewrite_rag_query, history, utterance)
```

❌ **Don't put system prompts inline in the pipeline file:**
```python
# WRONG
system = f"You are {name}, a friendly sales agent who..."

# RIGHT
from prompts import persona_system
system = persona_system(user_id, spec, chunks)
```

## What NOT to Do

1. **Don't add new Pipecat services without checking Gemini Live compatibility.** Gemini 3.1 Flash Live is audio-to-audio — injecting a separate TTS after it will double-encode audio and produce garbage output.

2. **Don't catch and swallow pipeline exceptions.** If Gemini Live fails, the pipeline should close cleanly. The `on_client_disconnected` handler cancels the task — that's the right pattern.

3. **Don't run two persona bots in the same Daily room.** Each bot joins as a participant. Two bots = audio feedback loop. Vanguard creates fresh rooms per session.

4. **Don't change the pipeline frame ordering.** `context.user()` must come before the updater, and `context.assistant()` must be last. The LLMContext accumulates history — wrong order corrupts conversation state.

5. **Don't hardcode Gemini model or voices.** Use `GEMINI_MODEL`, `GEMINI_VOICE`, and `ATTACKER_GEMINI_VOICE` so demo behavior can be adjusted without a deploy.
