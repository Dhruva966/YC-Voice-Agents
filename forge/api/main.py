"""Forge FastAPI backend."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import re
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import openai
import httpx
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from fastapi import WebSocket
from fastapi.responses import Response
from fastapi.websockets import WebSocketDisconnect
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMContextFrame, LLMUpdateSettingsFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.services.llm_service import LLMSettings
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)
from twilio.request_validator import RequestValidator as _TwilioRequestValidator
from twilio.twiml.voice_response import VoiceResponse

from pipeline.persona_bot import (
    DynamicPersonaContext,
    build_dynamic_system_prompt,
    rewrite_rag_query,
    run_persona_bot,
)
from pipeline.persona_bot_nvidia import run_persona_bot_nvidia_daily, run_persona_bot_nvidia_twilio
from storage import s3_client as _s3_client, bucket_name as _bucket
from autoloop.loop_controller import run_improvement_cycle
from finetune.persona_finetune import generate_synthetic_conversations, submit_finetune
from ingestion.pipeline import (
    get_user_corpus,
    get_user_knowledge_base_texts,
    get_user_transcripts,
    ingest_file,
)
from ingestion.transcript_scorer import score_transcripts
from personality.extractor import extract_personality, load_personality_spec, save_personality_spec
from prompts import persona_system
from rag.retriever import build_knowledge_base, init_db, retrieve
from vanguard.orchestrator import load_attack_suite, run_vanguard
from voice.clone import create_voice_clone

LOGGER = logging.getLogger(__name__)
DEFAULT_NVIDIA_BASE_MODEL = "meta/llama-4-maverick-17b-128e-instruct"
_vanguard_live: dict[str, list[dict[str, Any]]] = {}
_vanguard_live_totals: dict[str, int] = {}

_USER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _validate_user_id(user_id: str) -> None:
    if not _USER_ID_RE.match(user_id):
        raise HTTPException(status_code=400, detail="Invalid user_id: must be 1-64 alphanumeric/underscore/hyphen characters")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(init_db)
    try:
        await asyncio.to_thread(SileroVADAnalyzer)
        LOGGER.info("silero_vad_warmed_up")
    except Exception:
        LOGGER.warning("silero_vad_warmup_failed")
    yield


app = FastAPI(title="Forge", version="0.1.0", lifespan=lifespan)
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/nim")
async def nim_health():
    base_url = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
    is_self_hosted = not base_url.startswith("https://integrate.api.nvidia.com")
    return {
        "nim_mode": "self_hosted" if is_self_hosted else "cloud",
        "nim_url": base_url,
        "base_model": os.getenv("NVIDIA_BASE_MODEL", "meta/llama-4-maverick-17b-128e-instruct"),
        "embedding_model": os.getenv("NVIDIA_EMBEDDING_MODEL", "nvidia/llama-3.2-nv-embedqa-1b-v2"),
        "persona_model": os.getenv("NVIDIA_PERSONA_MODEL") or None,
        "customization_url": os.getenv("NVIDIA_CUSTOMIZATION_BASE_URL") or None,
    }


class QueuedResponse(BaseModel):
    job_id: str | None = None
    run_id: str | None = None
    cycle_number: int | None = None
    status: str


class CallResponse(BaseModel):
    room_url: str
    phone_number: str = ""


class JoinRoomRequest(BaseModel):
    user_id: str
    room_url: str
    daily_token: str
    user_name: str = "demo"


def _base_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or DEFAULT_NVIDIA_BASE_MODEL


def _put_status(user_id: str, job_id: str, payload: dict[str, Any]) -> None:
    _s3_client().put_object(
        Bucket=_bucket(),
        Key=f"{user_id}/build_status/{job_id}.json",
        Body=json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    _s3_client().put_object(
        Bucket=_bucket(),
        Key=f"{user_id}/build_status/latest.json",
        Body=json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8"),
        ContentType="application/json",
    )


def _get_json_key(key: str) -> dict[str, Any]:
    body = _s3_client().get_object(Bucket=_bucket(), Key=key)["Body"].read()
    return json.loads(body.decode("utf-8"))


def _list_keys(prefix: str) -> list[str]:
    s3 = _s3_client()
    paginator = s3.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=_bucket(), Prefix=prefix):
        keys.extend(item["Key"] for item in page.get("Contents", []))
    return keys


def _timestamp_value(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            try:
                return dt.datetime.fromisoformat(value).timestamp()
            except ValueError:
                return 0.0
    return 0.0


def _vanguard_run_sort_key(item: dict[str, Any]) -> tuple[float, str]:
    return (_timestamp_value(item.get("timestamp")), item.get("run_id") or "")


async def _create_daily_room(name: str | None = None) -> dict[str, str]:
    api_key = os.getenv("DAILY_API_KEY")
    if not api_key:
        raise RuntimeError("DAILY_API_KEY is required")
    async with httpx.AsyncClient(timeout=30) as client:
        room_response = await client.post(
            "https://api.daily.co/v1/rooms",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"name": name or str(uuid.uuid4()), "properties": {"exp": int(time.time()) + 3600}},
        )
        room_response.raise_for_status()
        room = room_response.json()
        token_response = await client.post(
            "https://api.daily.co/v1/meeting-tokens",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"properties": {"room_name": room["name"], "is_owner": True}},
        )
        token_response.raise_for_status()
        return {"room_url": room["url"], "token": token_response.json()["token"]}


@app.post("/users/{user_id}/ingest")
async def ingest(user_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    _validate_user_id(user_id)
    suffix = Path(file.filename or "upload.bin").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
        path = Path(handle.name)
        handle.write(await file.read())
    try:
        return await ingest_file(user_id, str(path), file.filename)
    finally:
        path.unlink(missing_ok=True)


def _run_build(user_id: str, job_id: str) -> None:
    s3 = _s3_client()
    bucket = _bucket()
    try:
        _put_status(user_id, job_id, {"job_id": job_id, "stage": "extracting_personality", "status": "running"})
        corpus_texts = get_user_corpus(user_id)
        transcripts = get_user_transcripts(user_id)
        transcript_texts = [json.dumps(item, ensure_ascii=True) for item in transcripts]
        corpus = "\n\n".join(corpus_texts + transcript_texts)
        spec = extract_personality(corpus)
        save_personality_spec(user_id, spec, s3, bucket)

        _put_status(user_id, job_id, {"job_id": job_id, "stage": "cloning_voice", "status": "running"})
        isolated_keys = [key for key in _list_keys(f"{user_id}/isolated_audio/") if key.endswith(".wav")]
        if isolated_keys and os.getenv("ELEVENLABS_API_KEY"):
            try:
                create_voice_clone(user_id, user_id, isolated_keys)
            except Exception:
                LOGGER.exception("legacy_voice_clone_failed_continuing_with_gemini_voice")
        elif isolated_keys:
            LOGGER.info("legacy_voice_clone_skipped_no_elevenlabs_key user_id=%s", user_id)

        _put_status(user_id, job_id, {"job_id": job_id, "stage": "scoring_transcripts", "status": "running"})
        scored = score_transcripts(user_id, transcripts)
        if scored.top_k_turns:
            training_transcripts = [
                {"turns": [
                    {"role": "user", "text": st.caller},
                    {"role": "assistant", "text": st.agent},
                ]}
                for st in scored.top_k_turns
            ]
        else:
            training_transcripts = transcripts

        _put_status(user_id, job_id, {"job_id": job_id, "stage": "building_rag", "status": "running"})
        kb_texts = get_user_knowledge_base_texts(user_id) + corpus_texts
        build_knowledge_base(user_id, kb_texts, "build_pipeline")

        _put_status(user_id, job_id, {"job_id": job_id, "stage": "fine_tuning", "status": "running"})
        examples = generate_synthetic_conversations(spec, training_transcripts, n=20)
        fine_tune_job_id = None
        fine_tune_error = None
        try:
            fine_tune_job_id = submit_finetune(user_id, examples, "initial")
        except Exception as exc:
            LOGGER.exception("initial_fine_tune_failed_using_base_model")
            fine_tune_error = str(exc)
        _put_status(
            user_id,
            job_id,
            {
                "job_id": job_id,
                "stage": "submitted",
                "status": "completed",
                "fine_tune_job_id": fine_tune_job_id,
                "fallback_model_id": _base_model() if fine_tune_error else None,
                "fine_tune_error": fine_tune_error,
            },
        )
    except Exception as exc:
        _put_status(user_id, job_id, {"job_id": job_id, "stage": "failed", "status": "failed", "error": str(exc)})


@app.post("/users/{user_id}/build", response_model=QueuedResponse)
async def build(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    _validate_user_id(user_id)
    job_id = str(uuid.uuid4())
    _put_status(user_id, job_id, {"job_id": job_id, "stage": "queued", "status": "queued"})
    background_tasks.add_task(_run_build, user_id, job_id)
    return QueuedResponse(job_id=job_id, status="queued")


@app.get("/users/{user_id}/build/status")
async def build_status(user_id: str) -> dict[str, Any]:
    try:
        return _get_json_key(f"{user_id}/build_status/latest.json")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchKey":
            return {"status": "none", "stage": "none"}
        raise


@app.post("/join_room")
async def join_room(request: JoinRoomRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    background_tasks.add_task(
        run_persona_bot,
        request.user_id,
        request.user_name,
        request.room_url,
        request.daily_token,
    )
    return {"status": "joining"}


@app.post("/users/{user_id}/call", response_model=CallResponse)
async def call_agent(user_id: str, background_tasks: BackgroundTasks) -> CallResponse:
    _validate_user_id(user_id)
    daily = await _create_daily_room()
    background_tasks.add_task(run_persona_bot, user_id, user_id, daily["room_url"], daily["token"])
    return CallResponse(room_url=daily["room_url"], phone_number=os.getenv("TWILIO_PHONE_NUMBER", ""))


async def _twilio_inbound_response(request: Request, user_id: str) -> Response:
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    if auth_token:
        validator = _TwilioRequestValidator(auth_token)
        signature = request.headers.get("X-Twilio-Signature", "")
        url = str(request.url)
        form_data = dict(await request.form())
        if not validator.validate(url, form_data, signature):
            LOGGER.warning("twilio_signature_validation_failed url=%s", url)
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")
    twiml = VoiceResponse()
    connect = twiml.connect()
    connect.stream(url=_twilio_stream_url(request, user_id))
    return Response(content=str(twiml), media_type="application/xml")


@app.post("/webhook/twilio/inbound")
async def twilio_inbound(request: Request) -> Response:
    return await _twilio_inbound_response(request, "demo")


@app.post("/users/{user_id}/webhook/twilio/inbound")
async def twilio_inbound_for_user(user_id: str, request: Request) -> Response:
    _validate_user_id(user_id)
    _require_built_user(user_id)
    return await _twilio_inbound_response(request, user_id)


class NvidiaCallResponse(BaseModel):
    room_url: str


@app.post("/users/{user_id}/call/nvidia", response_model=NvidiaCallResponse)
async def call_agent_nvidia(user_id: str, background_tasks: BackgroundTasks) -> NvidiaCallResponse:
    _validate_user_id(user_id)
    _require_built_user(user_id)
    daily = await _create_daily_room()
    background_tasks.add_task(
        run_persona_bot_nvidia_daily,
        user_id, user_id, daily["room_url"], daily["token"],
    )
    return NvidiaCallResponse(room_url=daily["room_url"])


async def _twilio_nvidia_inbound_response(request: Request, user_id: str) -> Response:
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    if auth_token:
        validator = _TwilioRequestValidator(auth_token)
        signature = request.headers.get("X-Twilio-Signature", "")
        url = str(request.url)
        form_data = dict(await request.form())
        if not validator.validate(url, form_data, signature):
            LOGGER.warning("twilio_nvidia_signature_validation_failed url=%s", url)
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")
    twiml = VoiceResponse()
    connect = twiml.connect()
    connect.stream(url=_twilio_nvidia_stream_url(request, user_id))
    return Response(content=str(twiml), media_type="application/xml")


@app.post("/webhook/twilio/nvidia")
async def twilio_nvidia_inbound(request: Request) -> Response:
    return await _twilio_nvidia_inbound_response(request, "demo")


@app.post("/users/{user_id}/webhook/twilio/nvidia")
async def twilio_nvidia_inbound_for_user(user_id: str, request: Request) -> Response:
    _validate_user_id(user_id)
    _require_built_user(user_id)
    return await _twilio_nvidia_inbound_response(request, user_id)

@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        user_id = _validate_user_id(websocket.query_params.get("user_id", "demo"))
    except HTTPException:
        await websocket.close(code=1008)
        return
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
        data = json.loads(raw)
        attempts = 0
        while data.get("event") != "start":
            attempts += 1
            if attempts > 50:
                LOGGER.warning("media_stream_no_start_event")
                await websocket.close(code=1002)
                return
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
            data = json.loads(raw)
        stream_sid = data["start"]["streamSid"]
        serializer = TwilioFrameSerializer(stream_sid=stream_sid)
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                serializer=serializer,
                audio_in_enabled=True,
                audio_out_enabled=True,
                vad_analyzer=SileroVADAnalyzer(),
            ),
        )

        spec = load_personality_spec(user_id, _s3_client(), _bucket())
        initial_system_prompt = persona_system(user_id, spec, [])

        llm = GeminiLiveLLMService(
            api_key=os.getenv("GEMINI_API_KEY"),
            settings=GeminiLiveLLMService.Settings(
                model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"),
                voice=os.getenv("GEMINI_VOICE", "Puck"),
                system_instruction=initial_system_prompt,
            ),
        )

        context = DynamicPersonaContext(initial_system_prompt)

        class _TwilioDynamicUpdater(FrameProcessor):
            def __init__(self, personality_spec):
                super().__init__()
                self._personality_spec = personality_spec

            async def process_frame(self, frame, direction: FrameDirection):
                await super().process_frame(frame, direction)
                if not isinstance(frame, LLMContextFrame):
                    await self.push_frame(frame, direction)
                    return
                messages = [
                    {"role": m.get("role", ""), "content": m.get("content", "")}
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
                    prompt = persona_system(user_id, self._personality_spec, chunks)
                except Exception:
                    prompt = initial_system_prompt
                await self.push_frame(
                    LLMUpdateSettingsFrame(
                        delta=LLMSettings(system_instruction=prompt),
                        service=llm,
                    ),
                    direction,
                )
                await self.push_frame(frame, direction)

        pipeline = Pipeline([
            transport.input(),
            context.user(),
            _TwilioDynamicUpdater(spec),
            llm,
            transport.output(),
            context.assistant(),
        ])
        task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            await task.cancel()

        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)
    except WebSocketDisconnect:
        LOGGER.info("media_stream_client_disconnected")
    except Exception:
        LOGGER.exception("media_stream_error")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


@app.websocket("/media-stream-nvidia")
async def media_stream_nvidia(websocket: WebSocket):
    await websocket.accept()
    # user_id is embedded in the WebSocket URL by _twilio_nvidia_stream_url; read it here
    # before the Twilio framing starts so we know whose persona to load.
    try:
        user_id = websocket.query_params.get("user_id", "demo")
        _validate_user_id(user_id)
    except HTTPException:
        await websocket.close(code=1008)
        return
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
        data = json.loads(raw)
        attempts = 0
        while data.get("event") != "start":
            attempts += 1
            if attempts > 50:
                LOGGER.warning("media_stream_nvidia_no_start_event")
                await websocket.close(code=1002)
                return
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
            data = json.loads(raw)
        stream_sid = data["start"]["streamSid"]
        serializer = TwilioFrameSerializer(stream_sid=stream_sid)
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                serializer=serializer,
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
        )
        await run_persona_bot_nvidia_twilio(transport, user_id, user_id, stream_sid)
    except WebSocketDisconnect:
        LOGGER.info("media_stream_nvidia_disconnected")
    except Exception:
        LOGGER.exception("media_stream_nvidia_error")


def _run_vanguard_background(user_id: str, run_id: str) -> None:
    import threading
    suite = load_attack_suite(user_id)
    live_key = f"{user_id}:{run_id}"
    _vanguard_live[live_key] = []
    _vanguard_live_totals[live_key] = len(suite)
    persona_agent_url = os.getenv("PERSONA_AGENT_URL", "http://localhost:8000")
    asyncio.run(run_vanguard(user_id, run_id, persona_agent_url, suite, live_results=_vanguard_live, live_key=live_key))
    def _cleanup() -> None:
        time.sleep(300)
        _vanguard_live.pop(live_key, None)
        _vanguard_live_totals.pop(live_key, None)
    threading.Thread(target=_cleanup, daemon=True).start()


@app.post("/users/{user_id}/vanguard/run", response_model=QueuedResponse)
async def vanguard_run(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    _validate_user_id(user_id)
    run_id = str(uuid.uuid4())
    background_tasks.add_task(_run_vanguard_background, user_id, run_id)
    return QueuedResponse(run_id=run_id, status="queued")


@app.get("/users/{user_id}/vanguard/runs")
async def vanguard_runs(user_id: str) -> list[dict[str, Any]]:
    runs = []
    for key in _list_keys(f"{user_id}/vanguard_runs/"):
        if key.endswith(".json"):
            data = _get_json_key(key)
            runs.append(
                {
                    "run_id": data.get("run_id"),
                    "total": data.get("total"),
                    "passed": data.get("passed"),
                    "failed": data.get("failed"),
                    "pass_rate": data.get("pass_rate"),
                    "duration_seconds": data.get("duration_seconds"),
                    "timestamp": data.get("timestamp"),
                }
            )
    return sorted(runs, key=_vanguard_run_sort_key)


@app.get("/users/{user_id}/vanguard/runs/{run_id}")
async def vanguard_run_result(user_id: str, run_id: str) -> dict[str, Any]:
    return _get_json_key(f"{user_id}/vanguard_runs/{run_id}.json")


@app.get("/users/{user_id}/vanguard/runs/{run_id}/live")
async def vanguard_run_live(user_id: str, run_id: str) -> dict[str, Any]:
    live_key = f"{user_id}:{run_id}"
    sessions = list(_vanguard_live.get(live_key, []))
    expected = _vanguard_live_totals.get(live_key)
    complete = expected is not None and len(sessions) >= expected
    return {"sessions": sessions, "complete": complete, "total": len(sessions), "expected_total": expected or 0}


@app.get("/users/{user_id}/attack_suite")
async def get_attack_suite(user_id: str) -> list[dict[str, Any]]:
    return load_attack_suite(user_id)


@app.post("/users/{user_id}/vanguard/improve", response_model=QueuedResponse)
async def vanguard_improve(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    _validate_user_id(user_id)
    runs = await vanguard_runs(user_id)
    if not runs:
        raise HTTPException(status_code=400, detail="No Vanguard runs found")
    latest = runs[-1]
    full_run = await vanguard_run_result(user_id, latest["run_id"])
    cycle_number = len(_list_keys(f"{user_id}/improvement_cycles/")) + 1
    try:
        personality_spec = load_personality_spec(user_id, _s3_client(), _bucket())
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchKey":
            raise HTTPException(
                status_code=400,
                detail="build pipeline must complete before improvement cycle.",
            ) from exc
        raise
    persona_prompt = persona_system(user_id, personality_spec, [])
    background_tasks.add_task(run_improvement_cycle, user_id, full_run, persona_prompt, cycle_number)
    return QueuedResponse(cycle_number=cycle_number, status="queued")


def _aggregate_pass_rate_by_persona(user_id: str) -> dict[str, dict[str, Any]]:
    """Aggregate pass/fail counts per attack_persona across all vanguard runs."""
    persona_stats: dict[str, dict[str, int]] = {}
    for key in _list_keys(f"{user_id}/vanguard_runs/"):
        if not key.endswith(".json"):
            continue
        try:
            data = _get_json_key(key)
            for session in data.get("sessions", []):
                persona = session.get("attack_persona", "unknown")
                if persona not in persona_stats:
                    persona_stats[persona] = {"runs": 0, "passed": 0}
                persona_stats[persona]["runs"] += 1
                if session.get("status") == "passed":
                    persona_stats[persona]["passed"] += 1
        except Exception:
            continue
    result: dict[str, dict[str, Any]] = {}
    for persona, stats in persona_stats.items():
        result[persona] = {
            "runs": stats["runs"],
            "passed": stats["passed"],
            "pass_rate": round(stats["passed"] / stats["runs"], 2) if stats["runs"] > 0 else 0.0,
        }
    return result


@app.get("/users/{user_id}/dashboard")
async def dashboard(user_id: str) -> dict[str, Any]:
    s3 = _s3_client()
    bucket = _bucket()
    try:
        personality_spec = _get_json_key(f"{user_id}/personality/personality_spec.json")
    except Exception:
        personality_spec = None
    try:
        voice_id_path = f"{user_id}/voice_id.txt"
        voice_id = _s3_client().get_object(Bucket=_bucket(), Key=voice_id_path)["Body"].read().decode("utf-8").strip()
    except Exception:
        voice_id = None
    try:
        adapter_id = s3.get_object(Bucket=bucket, Key=f"{user_id}/adapter_id.txt")["Body"].read().decode("utf-8").strip()
    except Exception:
        adapter_id = None
    runs = await vanguard_runs(user_id)
    latest = runs[-1] if runs else None
    cycles = []
    for key in _list_keys(f"{user_id}/improvement_cycles/"):
        if key.endswith(".json"):
            cycles.append(_get_json_key(key))
    cycles = sorted(cycles, key=lambda item: item.get("cycle_number", 0))
    suite_size = len(load_attack_suite(user_id))
    pass_rate_by_persona = _aggregate_pass_rate_by_persona(user_id)
    return {
        "personality_spec": personality_spec,
        "voice_id": voice_id,
        "gemini_voice": os.getenv("GEMINI_VOICE", "Puck"),
        "attacker_gemini_voice": os.getenv("ATTACKER_GEMINI_VOICE", "Charon"),
        "adapter_id": adapter_id,
        "latest_vanguard_run_summary": latest,
        "pass_rate_history": [
            {
                "cycle": item["cycle_number"],
                "pass_rate": item["pass_rate_after"],
                "regression_passed": not item.get("regression_failed", False),
            }
            for item in cycles
        ],
        "attack_suite_size": suite_size,
        "attack_suite_history": [
            {"cycle": item["cycle_number"], "size": item["attack_suite_size_after"]}
            for item in cycles
        ],
        "pass_rate_by_persona": pass_rate_by_persona,
    }


@app.get("/users/{user_id}/status")
async def get_user_status(user_id: str):
    """Returns real-time readiness status for a user."""
    s3 = _s3_client()
    bucket = _bucket()

    def _key_exists(key: str) -> bool:
        try:
            s3.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError:
            return False

    personality_spec_ready = _key_exists(f"{user_id}/personality/personality_spec.json")
    voice_clone_ready = _key_exists(f"{user_id}/voice_id.txt") or bool(os.getenv("GEMINI_API_KEY"))

    # RAG lives in ChromaDB locally or pgvector on AWS — check via the retriever
    rag_ready = False
    try:
        from rag.retriever import _use_local, _get_chroma
        if _use_local():
            chroma_names = [c.name for c in _get_chroma().list_collections()]
            rag_ready = f"user_{user_id}" in chroma_names
        else:
            from rag.retriever import _get_pool
            from contextlib import contextmanager
            pool = _get_pool()
            conn = pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT 1 FROM knowledge_chunks WHERE user_id = %s LIMIT 1",
                        (user_id,),
                    )
                    rag_ready = cur.fetchone() is not None
                conn.commit()
            finally:
                pool.putconn(conn)
    except Exception:
        pass

    vanguard_keys = _list_keys(f"{user_id}/vanguard_runs/")
    vanguard_runs = sum(1 for k in vanguard_keys if k.endswith(".json"))

    cycle_keys = _list_keys(f"{user_id}/improvement_cycles/")
    improvement_cycles = sum(1 for k in cycle_keys if k.endswith(".json"))

    attack_suite_size = 0
    try:
        body = s3.get_object(Bucket=bucket, Key=f"{user_id}/attack_suite.json")["Body"].read()
        attack_suite_size = len(json.loads(body.decode("utf-8")))
    except Exception:
        pass

    return {
        "personality_spec_ready": personality_spec_ready,
        "voice_clone_ready": voice_clone_ready,
        "rag_ready": rag_ready,
        "vanguard_runs": vanguard_runs,
        "improvement_cycles": improvement_cycles,
        "attack_suite_size": attack_suite_size,
    }


class ChatRequest(BaseModel):
    message: str
    user_id: str = "demo"


@app.get("/users/{user_id}/transcript_scores")
async def transcript_scores(user_id: str) -> dict[str, Any]:
    try:
        return _get_json_key(f"{user_id}/transcript_scores/overall.json")
    except Exception:
        raise HTTPException(status_code=404, detail="No transcript scores found. Run build first.")


@app.post("/chat")
async def chat(req: ChatRequest):
    start = time.time()
    system_prompt = await asyncio.to_thread(build_dynamic_system_prompt, req.user_id, req.user_id, [], req.message)
    client = openai.AsyncOpenAI(
        api_key=os.getenv("NVIDIA_API_KEY"),
        base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
        timeout=20.0,
    )
    response = await client.chat.completions.create(
        model=os.getenv("NVIDIA_BASE_MODEL", "meta/llama-4-maverick-17b-128e-instruct"),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.message},
        ],
    )
    latency_ms = int((time.time() - start) * 1000)
    return {"response": response.choices[0].message.content, "latency_ms": latency_ms}
