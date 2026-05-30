"""Runtime persona bot — Gemini 3.1 Flash Live (audio-to-audio)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

from openai import OpenAI

from personality.extractor import load_personality_spec
from prompts import persona_system, rag_query_rewriter
from rag.retriever import retrieve
from storage import s3_client as _s3_client, bucket_name as _bucket

LOGGER = logging.getLogger(__name__)


def _nim_client() -> OpenAI:
    return OpenAI(
        api_key=os.getenv("NVIDIA_API_KEY"),
        base_url=os.getenv("NVIDIA_BASE_URL"),
    )


def _nim_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or "meta/llama-4-maverick-17b-128e-instruct"


def rewrite_rag_query(conversation_history: list[dict[str, str]], caller_utterance: str) -> str:
    prompt = rag_query_rewriter(conversation_history, caller_utterance)
    response = _nim_client().chat.completions.create(
        model=_nim_model(),
        messages=[
            {"role": "system", "content": prompt["system"]},
            {"role": "user", "content": prompt["user"]},
        ],
        temperature=0,
        max_tokens=32,
    )
    return (response.choices[0].message.content or caller_utterance).strip().strip('"')


def build_dynamic_system_prompt(
    user_id: str,
    user_name: str,
    conversation_history: list[dict[str, str]],
    latest_utterance: str,
) -> str:
    spec = load_personality_spec(user_id, _s3_client(), _bucket())
    query = rewrite_rag_query(conversation_history, latest_utterance)
    chunks = retrieve(user_id, query, top_k=5)
    return persona_system(user_name, spec, chunks)


def build_initial_system_prompt(user_id: str, user_name: str) -> str:
    spec = load_personality_spec(user_id, _s3_client(), _bucket())
    return persona_system(user_name, spec, [])


class DynamicPersonaContext:
    """Wraps LLMContext + aggregator pair for Pipecat pipelines."""

    def __init__(self, initial_system_prompt: str):
        from pipecat.processors.aggregators.llm_context import LLMContext
        from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair

        self._context = LLMContext()
        self._aggregator = LLMContextAggregatorPair(self._context)
        self._context.add_message({"role": "system", "content": initial_system_prompt})

    def user(self):
        return self._aggregator.user()

    def assistant(self):
        return self._aggregator.assistant()


def _log_latency(stage: str, started_at: float) -> None:
    LOGGER.info("latency.%s_ms=%s", stage, round((time.perf_counter() - started_at) * 1000, 2))


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=True)


def run_persona_bot(
    user_id: str,
    user_name: str,
    daily_room_url: str,
    daily_token: str,
    voice_id: str | None = None,  # unused with Gemini Live; kept for API compat
    adapter_model_id: str | None = None,  # unused with Gemini Live public API
) -> None:
    """Run persona bot in a Daily room using Gemini 3.1 Flash Live (audio-to-audio).

    Gemini Live handles STT + LLM + TTS in one model — no separate Deepgram or ElevenLabs.
    System prompt is rebuilt with RAG context on each user turn via _DynamicPersonaUpdater.
    """
    try:
        from pipecat.audio.vad.silero import SileroVADAnalyzer
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.runner import PipelineRunner
        from pipecat.pipeline.task import PipelineParams, PipelineTask
        from pipecat.frames.frames import LLMContextFrame, LLMUpdateSettingsFrame
        from pipecat.processors.aggregators.llm_context import LLMContext
        from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
        from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
        from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
        from pipecat.services.settings import LLMSettings
        from pipecat.transports.daily.transport import DailyParams, DailyTransport
    except ImportError as exc:
        raise RuntimeError("Pipecat with Google Gemini Live is not installed. Run: pip install pipecat-ai[google,daily]") from exc

    gemini_voice = os.getenv("GEMINI_VOICE", "Puck")
    spec = load_personality_spec(user_id, _s3_client(), _bucket())
    initial_system_prompt = persona_system(user_name, spec, [])

    transport = DailyTransport(
        daily_room_url,
        daily_token,
        "Forge Persona",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            transcription_enabled=False,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    llm = GeminiLiveLLMService(
        api_key=os.getenv("GEMINI_API_KEY"),
        settings=GeminiLiveLLMService.Settings(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"),
            voice=gemini_voice,
            system_instruction=initial_system_prompt,
        ),
    )

    context = LLMContext()
    context_aggregator = LLMContextAggregatorPair(context)

    class _DynamicPersonaUpdater(FrameProcessor):
        """Re-injects RAG context into the system prompt on each user turn."""

        def __init__(self, personality_spec: dict[str, Any]) -> None:
            super().__init__()
            self._personality_spec = personality_spec

        async def process_frame(self, frame: Any, direction: FrameDirection) -> None:
            await super().process_frame(frame, direction)
            if not isinstance(frame, LLMContextFrame):
                await self.push_frame(frame, direction)
                return

            messages = [
                {"role": m.get("role", ""), "content": _message_text(m)}
                for m in frame.context.get_messages()
                if isinstance(m, dict) and m.get("role") in {"user", "assistant"}
            ]
            latest_idx = next(
                (i for i in range(len(messages) - 1, -1, -1) if messages[i]["role"] == "user"),
                None,
            )
            utterance = messages[latest_idx]["content"] if latest_idx is not None else ""
            history = messages[:latest_idx] if latest_idx is not None else messages

            try:
                query = await asyncio.to_thread(rewrite_rag_query, history, utterance)
                chunks = await asyncio.to_thread(retrieve, user_id, query, 5)
                system_prompt = persona_system(user_name, self._personality_spec, chunks)
            except Exception:
                LOGGER.exception("dynamic_persona_prompt_failed")
                system_prompt = persona_system(user_name, self._personality_spec, [])

            await self.push_frame(
                LLMUpdateSettingsFrame(
                    delta=LLMSettings(system_instruction=system_prompt),
                    service=llm,
                ),
                direction,
            )
            await self.push_frame(frame, direction)

    pipeline = Pipeline([
        transport.input(),
        context_aggregator.user(),
        _DynamicPersonaUpdater(spec),
        llm,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True, enable_metrics=True),
    )

    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        LOGGER.info("first_participant_joined=%s", json.dumps(participant, default=str))

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        LOGGER.info("participant_left=%s reason=%s", json.dumps(participant, default=str), reason)
        await task.cancel()

    started = time.perf_counter()

    async def _run() -> None:
        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)

    asyncio.run(_run())
    _log_latency("end_to_end", started)
