"""Runtime attacker bot."""

from __future__ import annotations

import asyncio
import datetime as dt
import os
import time
from typing import Any, Callable

from prompts import ATTACKER_PERSONAS


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _base_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or "meta/llama-4-maverick-17b-128e-instruct"


def run_attacker_bot(
    session_id: str,
    attack_persona: str,
    daily_room_url: str,
    daily_token: str,
    max_turns: int = 15,
    transcript_callback: Callable[[str, dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    try:
        from pipecat.audio.vad.silero import SileroVADAnalyzer
        from pipecat.frames.frames import LLMRunFrame
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.runner import PipelineRunner
        from pipecat.pipeline.task import PipelineParams, PipelineTask
        from pipecat.processors.aggregators.llm_context import LLMContext
        from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
        from pipecat.services.deepgram.stt import DeepgramSTTService
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
        from pipecat.services.openai.llm import OpenAILLMService
        from pipecat.transports.daily.transport import DailyParams, DailyTransport
    except Exception as exc:
        raise RuntimeError("Pipecat attacker runtime is not installed") from exc

    if attack_persona not in ATTACKER_PERSONAS:
        raise KeyError(f"Unknown attack persona: {attack_persona}")

    transcript: dict[str, Any] = {
        "session_id": session_id,
        "attack_persona": attack_persona,
        "turns": [],
        "start_time": _utc_now(),
        "end_time": None,
        "duration_seconds": None,
    }
    started = time.perf_counter()

    transport = DailyTransport(
        daily_room_url,
        daily_token,
        f"Forge Attacker {attack_persona}",
        DailyParams(audio_in_enabled=True, audio_out_enabled=True, transcription_enabled=False, vad_analyzer=SileroVADAnalyzer()),
    )
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        settings=DeepgramSTTService.Settings(model="nova-3-general"),
    )
    llm = OpenAILLMService(
        api_key=os.getenv("NVIDIA_API_KEY"),
        base_url=os.getenv("NVIDIA_BASE_URL"),
        settings=OpenAILLMService.Settings(
            model=_base_model(),
            system_instruction=ATTACKER_PERSONAS[attack_persona],
        ),
    )
    context = LLMContext()
    context_aggregator = LLMContextAggregatorPair(context)
    user_aggregator = context_aggregator.user()
    assistant_aggregator = context_aggregator.assistant()
    voice_id = os.getenv("ATTACKER_VOICE_ID") or "21m00Tcm4TlvDq8ikWAM"
    tts = ElevenLabsTTSService(api_key=os.getenv("ELEVENLABS_API_KEY"), settings=ElevenLabsTTSService.Settings(voice=voice_id))
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True, enable_metrics=True))

    async def append_turn(role: str, text: str, timestamp: str | None) -> None:
        if not text:
            return
        transcript["turns"].append({"role": role, "text": text, "timestamp": timestamp or _utc_now()})
        if len(transcript["turns"]) >= max_turns * 2:
            await task.cancel()

    @user_aggregator.event_handler("on_user_turn_stopped")
    async def on_user_turn_stopped(aggregator, strategy, message):
        await append_turn("caller", message.content, getattr(message, 'timestamp', None))

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn_stopped(aggregator, message):
        await append_turn("agent", message.content, getattr(message, "timestamp", None))

    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        context.add_message(
            {
                "role": "user",
                "content": "Begin the call now. Open in character with the first caller utterance.",
            }
        )
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        await task.cancel()

    async def run_pipeline() -> None:
        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)

    asyncio.run(run_pipeline())
    transcript["end_time"] = _utc_now()
    transcript["duration_seconds"] = round(time.perf_counter() - started, 3)

    if transcript_callback:
        transcript_callback(session_id, transcript)
    return transcript
