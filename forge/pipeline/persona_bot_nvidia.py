"""Runtime persona bot — NVIDIA Parakeet STT + Nemotron LLM + Gradium TTS."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.workers.runner import WorkerRunner
from pipecat.frames.frames import LLMContextFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.turns.user_turn_strategies import FilterIncompleteUserTurnStrategies
from pipecat.services.gradium.tts import GradiumTTSService

from services.nvidia_stt import NVidiaWebSocketSTTService
from services.nemotron_llm import VLLMOpenAILLMService
from pipeline.persona_bot import rewrite_rag_query, _message_text
from personality.extractor import load_personality_spec
from prompts import persona_system
from rag.retriever import retrieve
from storage import s3_client as _s3_client, bucket_name as _bucket

LOGGER = logging.getLogger(__name__)


class _NvidiaPersonaUpdater(FrameProcessor):
    """Updates context with RAG chunks before LLM is invoked."""

    def __init__(self, spec: dict[str, Any], user_id: str, user_name: str) -> None:
        super().__init__()
        self._spec = spec
        self._user_id = user_id
        self._user_name = user_name

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
            chunks = await asyncio.to_thread(retrieve, self._user_id, query, 5)
            new_system = persona_system(self._user_name, self._spec, chunks)
        except Exception:
            LOGGER.exception("nvidia_dynamic_persona_failed")
            new_system = persona_system(self._user_name, self._spec, [])

        all_msgs = frame.context.get_messages()
        if all_msgs and isinstance(all_msgs[0], dict) and all_msgs[0].get("role") == "system":
            all_msgs[0]["content"] = new_system
            frame.context.set_messages(all_msgs)

        await self.push_frame(frame, direction)


async def _build_nvidia_pipeline(
    transport: Any,
    user_id: str,
    user_name: str,
    audio_in_sample_rate: int,
    audio_out_sample_rate: int,
) -> None:
    """Builds and starts the NVIDIA + Gradium voice pipeline."""
    spec = load_personality_spec(user_id, _s3_client(), _bucket())
    initial_system_prompt = persona_system(user_name, spec, [])

    stt = NVidiaWebSocketSTTService(
        url=os.environ["NVIDIA_ASR_URL"],
        strip_interim_prefix=True,
    )
    llm = VLLMOpenAILLMService(
        api_key=os.getenv("NEMOTRON_LLM_API_KEY", "EMPTY"),
        base_url=os.environ["NEMOTRON_LLM_URL"],
        settings=VLLMOpenAILLMService.Settings(
            model=os.getenv("NEMOTRON_LLM_MODEL", "nvidia/nemotron-3-super"),
            system_instruction=initial_system_prompt,
        ),
    )
    tts = GradiumTTSService(
        api_key=os.environ["GRADIUM_API_KEY"],
        settings=GradiumTTSService.Settings(
            voice=os.getenv("GRADIUM_VOICE_ID", "Eu9iL_CYe8N-Gkx_"),
        ),
    )

    context = LLMContext()
    context.add_message({"role": "system", "content": initial_system_prompt})

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
            user_turn_strategies=FilterIncompleteUserTurnStrategies(),
        ),
    )

    pipeline = Pipeline([
        transport.input(),
        stt,
        user_aggregator,
        _NvidiaPersonaUpdater(spec, user_id, user_name),
        llm,
        tts,
        transport.output(),
        assistant_aggregator,
    ])

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            audio_in_sample_rate=audio_in_sample_rate,
            audio_out_sample_rate=audio_out_sample_rate,
        ),
    )

    @transport.event_handler("on_client_connected")  # Twilio/WebSocket path
    async def on_client_connected(transport, client):
        from pipecat.frames.frames import LLMRunFrame
        LOGGER.info("nvidia_client_connected")
        context.add_message({
            "role": "user",
            "content": "[Call connected. Greet the caller warmly and introduce yourself as their voice agent.]"
        })
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_first_participant_joined")  # Daily path
    async def on_first_participant_joined(transport, participant):
        from pipecat.frames.frames import LLMRunFrame
        LOGGER.info("nvidia_first_participant_joined")
        context.add_message({
            "role": "user",
            "content": "[Call connected. Greet the caller warmly and introduce yourself as their voice agent.]"
        })
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        LOGGER.info("nvidia_participant_left reason=%s", reason)
        await worker.cancel()

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        LOGGER.info("nvidia_client_disconnected")
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await runner.run()


async def run_persona_bot_nvidia_twilio(
    transport: Any,
    user_id: str,
    user_name: str,
    stream_sid: str,
) -> None:
    """Entrypoint for Twilio connection (8kHz audio sample rate)."""
    await _build_nvidia_pipeline(transport, user_id, user_name, 8000, 8000)


def run_persona_bot_nvidia_daily(
    user_id: str,
    user_name: str,
    daily_room_url: str,
    daily_token: str,
) -> None:
    """Entrypoint for Daily connection (background task, 16kHz/24kHz sample rate)."""
    from pipecat.transports.daily.transport import DailyTransport, DailyParams

    transport = DailyTransport(
        daily_room_url,
        daily_token,
        "Forge Persona NVIDIA",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            transcription_enabled=False,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    async def _run() -> None:
        await _build_nvidia_pipeline(transport, user_id, user_name, 16000, 24000)

    asyncio.run(_run())
