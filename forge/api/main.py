"""Forge FastAPI backend."""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import hmac
import json
import logging
import os
import re
import tempfile
import time
import urllib.parse
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock, Thread
from typing import Any

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_CYCLE_RUN_RE = re.compile(r"^cycle_[A-Za-z0-9_-]{1,80}$")

import openai
import httpx
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from twilio.request_validator import RequestValidator as _TwilioRequestValidator
from twilio.twiml.voice_response import VoiceResponse

load_dotenv()

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)
from pipeline.persona_bot import (
    DynamicPersonaContext,
    build_dynamic_system_prompt,
    rewrite_rag_query,
)
from rag.retriever import retrieve

from pipecat.frames.frames import LLMContextFrame, LLMUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.settings import LLMSettings

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
from pipeline.persona_bot import run_persona_bot
from prompts import persona_system
from rag.retriever import build_knowledge_base, has_knowledge_base, init_db
from vanguard.orchestrator import load_attack_suite, run_vanguard
from voice.clone import create_voice_clone

LOGGER = logging.getLogger(__name__)
DEFAULT_NVIDIA_BASE_MODEL = "meta/llama-4-maverick-17b-128e-instruct"
_vanguard_live: dict[str, list[dict[str, Any]]] = {}
_vanguard_live_totals: dict[str, int] = {}
_USER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

# Rate limiting: sliding window per (bucket, key)
_rate_lock = Lock()
_rate_buckets: dict[str, list[float]] = defaultdict(list)
# (max_calls, window_seconds)
_RATE_LIMITS: dict[str, tuple[int, int]] = {
    "build": (3, 60),
    "vanguard": (3, 60),
    "chat": (10, 60),
}


def _rate_limit(bucket: str, key: str) -> None:
    max_calls, window = _RATE_LIMITS[bucket]
    full_key = f"{bucket}:{key}"
    now = time.time()
    with _rate_lock:
        _rate_buckets[full_key] = [t for t in _rate_buckets[full_key] if t > now - window]
        if len(_rate_buckets[full_key]) >= max_calls:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit: max {max_calls} requests per {window}s",
            )
        _rate_buckets[full_key].append(now)


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
_allowed_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:3001,http://localhost:3100,http://localhost:3101",
    ).split(",")
    if o.strip()
]
if "*" in _allowed_origins:
    raise RuntimeError("ALLOWED_ORIGINS cannot be '*' when allow_credentials=True — set explicit origins")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "X-Twilio-Signature", "Authorization"],
)

_API_KEY_EXEMPT = frozenset({"/health", "/docs", "/redoc", "/openapi.json", "/media-stream"})


@app.middleware("http")
async def _api_key_middleware(request: Request, call_next):
    forge_key = os.getenv("FORGE_API_KEY")
    if forge_key and request.method != "OPTIONS":
        path = request.url.path
        exempt = path in _API_KEY_EXEMPT or path.endswith("/webhook/twilio/inbound")
        if not exempt:
            provided = request.headers.get("X-API-Key", "")
            if not hmac.compare_digest(provided.encode("utf-8"), forge_key.encode("utf-8")):
                return JSONResponse(status_code=401, content={"detail": "Invalid API key"})
    return await call_next(request)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class QueuedResponse(BaseModel):
    job_id: str | None = None
    run_id: str | None = None
    cycle_number: int | None = None
    status: str


class CallResponse(BaseModel):
    room_url: str
    phone_number: str


class JoinRoomRequest(BaseModel):
    user_id: str
    room_url: str
    daily_token: str
    user_name: str = "demo"
    mode: str = "robust"



def _base_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or DEFAULT_NVIDIA_BASE_MODEL


def _validate_user_id(user_id: str) -> str:
    if not _USER_ID_RE.fullmatch(user_id or ""):
        raise HTTPException(status_code=400, detail="Invalid user_id")
    return user_id


def _require_built_user(user_id: str) -> None:
    try:
        _s3_client().head_object(Bucket=_bucket(), Key=f"{user_id}/personality/personality_spec.json")
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchKey":
            raise HTTPException(status_code=400, detail="Build pipeline must complete before starting agent workflows.") from exc
        raise


def _twilio_stream_url(request: Request, user_id: str) -> str:
    configured = os.getenv("TWILIO_STREAM_URL") or os.getenv("WSS_BASE_URL")
    ts = str(int(time.time()))
    params = {"user_id": user_id}
    if secret := _media_stream_secret():
        params["ts"] = ts
        params["token"] = _media_stream_token(user_id, ts, secret)
    query = urllib.parse.urlencode(params)
    if configured:
        base = configured.rstrip("/")
        separator = "&" if "?" in base else "?"
        return f"{base}{separator}{query}"

    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"wss://{host}/media-stream?{query}"


def _media_stream_secret() -> str | None:
    return os.getenv("MEDIA_STREAM_SECRET") or os.getenv("TWILIO_AUTH_TOKEN")


def _media_stream_token(user_id: str, ts: str, secret: str) -> str:
    message = f"{user_id}:{ts}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _validate_media_stream_auth(user_id: str, ts: str | None, token: str | None) -> bool:
    secret = _media_stream_secret()
    if not secret:
        return True
    if not ts or not token:
        return False
    try:
        timestamp = int(ts)
    except ValueError:
        return False
    if abs(time.time() - timestamp) > 600:
        return False
    expected = _media_stream_token(user_id, ts, secret)
    return hmac.compare_digest(token, expected)


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


def _key_exists(key: str) -> bool:
    try:
        _s3_client().head_object(Bucket=_bucket(), Key=key)
        return True
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchKey":
            return False
        raise


def _transcript_to_text(transcript: dict[str, Any], index: int) -> str:
    source = transcript.get("source_file") or f"transcript_{index}"
    turns = transcript.get("turns") or transcript.get("segments")
    if isinstance(turns, list):
        lines = [f"SOURCE: {source}"]
        for turn in turns:
            if not isinstance(turn, dict):
                continue
            role = turn.get("role") or turn.get("speaker") or turn.get("speaker_label") or "speaker"
            text = turn.get("text") or turn.get("content") or ""
            if text:
                lines.append(f"{str(role).upper()}: {text}")
        return "\n".join(lines)
    if isinstance(transcript.get("text"), str):
        return f"SOURCE: {source}\n{transcript['text']}"
    return f"SOURCE: {source}\n{json.dumps(transcript, ensure_ascii=True)}"


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


_ALLOWED_UPLOAD_SUFFIXES = {".mp3", ".mp4", ".wav", ".m4a", ".webm", ".ogg", ".txt", ".eml", ".json", ".csv", ".md", ".pdf", ".docx"}
_MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


def _bootstrap_instant_persona(user_id: str) -> None:
    try:
        from personality.extractor import extract_instant_personality, save_instant_personality_spec
        from ingestion.pipeline import get_user_corpus, get_user_transcripts
        import json
        
        # Load corpus and transcripts
        corpus_texts = get_user_corpus(user_id)
        transcripts = get_user_transcripts(user_id)
        transcript_texts = [json.dumps(item, ensure_ascii=True) for item in transcripts]
        full_text = "\n\n".join(corpus_texts + transcript_texts).strip()
        
        # Extract a short snippet
        snippet = full_text[:4000]
        spec = extract_instant_personality(snippet)
        
        s3 = _s3_client()
        bucket = _bucket()
        save_instant_personality_spec(user_id, spec, s3, bucket)
        LOGGER.info("bootstrap_instant_persona_completed user_id=%s", user_id)
    except Exception:
        LOGGER.exception("bootstrap_instant_persona_failed user_id=%s", user_id)


@app.post("/users/{user_id}/ingest")
async def ingest(user_id: str, background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict[str, Any]:
    user_id = _validate_user_id(user_id)
    suffix = Path(file.filename or "upload.bin").suffix.lower()
    if suffix not in _ALLOWED_UPLOAD_SUFFIXES:
        raise HTTPException(status_code=400, detail=f"File type {suffix!r} not allowed")
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds 500 MB limit")
        chunks.append(chunk)
    data = b"".join(chunks)
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
        path = Path(handle.name)
        handle.write(data)
    try:
        res = await ingest_file(user_id, str(path), file.filename)
        if res.get("status") == "completed":
            background_tasks.add_task(_bootstrap_instant_persona, user_id)
        return res
    finally:
        path.unlink(missing_ok=True)



def _run_build(user_id: str, job_id: str) -> None:
    user_id = _validate_user_id(user_id)
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
        transcript_rag_texts = [_transcript_to_text(item, idx) for idx, item in enumerate(transcripts)]
        kb_texts = get_user_knowledge_base_texts(user_id) + corpus_texts + transcript_rag_texts
        build_knowledge_base(user_id, kb_texts, "build_pipeline")

        _put_status(user_id, job_id, {"job_id": job_id, "stage": "fine_tuning", "status": "running"})
        fine_tune_job_id = None
        fine_tune_error = None
        examples_count = 0
        try:
            from finetune.persona_finetune import save_adapter_id as _save_adapter_id, wait_for_finetune
            examples = generate_synthetic_conversations(spec, training_transcripts, n=20)
            examples_count = len(examples)
            if not examples:
                raise RuntimeError("No synthetic training examples were generated from the uploaded transcripts.")
            fine_tune_job_id = submit_finetune(user_id, examples, "initial")
            adapter_id = wait_for_finetune(fine_tune_job_id)
            _save_adapter_id(user_id, adapter_id, s3, bucket)
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
                "synthetic_examples_generated": examples_count,
                "fallback_model_id": _base_model() if fine_tune_error else None,
                "fine_tune_error": fine_tune_error,
            },
        )
    except Exception as exc:
        LOGGER.exception("build_failed user_id=%s job_id=%s", user_id, job_id)
        try:
            _put_status(
                user_id,
                job_id,
                {
                    "job_id": job_id,
                    "stage": "failed",
                    "status": "failed",
                    "error": str(exc) or "Build pipeline failed. Check server logs.",
                },
            )
        except Exception:
            LOGGER.exception("put_status_failed_during_build_error user_id=%s job_id=%s", user_id, job_id)


@app.post("/users/{user_id}/build", response_model=QueuedResponse)
async def build(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    user_id = _validate_user_id(user_id)
    _rate_limit("build", user_id)
    job_id = str(uuid.uuid4())
    _put_status(user_id, job_id, {"job_id": job_id, "stage": "queued", "status": "queued"})
    background_tasks.add_task(_run_build, user_id, job_id)
    return QueuedResponse(job_id=job_id, status="queued")


@app.get("/users/{user_id}/build/status")
async def build_status(user_id: str) -> dict[str, Any]:
    user_id = _validate_user_id(user_id)
    try:
        return _get_json_key(f"{user_id}/build_status/latest.json")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchKey":
            return {"status": "none", "stage": "none"}
        raise


_ALLOWED_ROOM_DOMAINS = {"daily.co"}


def _spawn_persona_bot(
    user_id: str,
    user_name: str,
    room_url: str,
    daily_token: str,
    mode: str,
) -> None:
    def _runner() -> None:
        try:
            run_persona_bot(user_id, user_name, room_url, daily_token, mode=mode)
        except Exception:
            LOGGER.exception("persona_bot_launch_failed user_id=%s room_url=%s mode=%s", user_id, room_url, mode)

    Thread(
        target=_runner,
        name=f"persona-bot-{user_id}-{mode}",
        daemon=True,
    ).start()


@app.post("/join_room")
async def join_room(request: JoinRoomRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    user_id = _validate_user_id(request.user_id)
    parsed = urllib.parse.urlparse(request.room_url)
    if not any(parsed.netloc == d or parsed.netloc.endswith("." + d) for d in _ALLOWED_ROOM_DOMAINS):
        raise HTTPException(status_code=400, detail="Invalid room_url: must be a daily.co room")
    if request.mode == "robust":
        _require_built_user(user_id)
    _spawn_persona_bot(
        user_id,
        request.user_name,
        request.room_url,
        request.daily_token,
        mode=request.mode,
    )
    return {"status": "joining"}


@app.post("/users/{user_id}/call", response_model=CallResponse)
async def call_agent(user_id: str, background_tasks: BackgroundTasks, mode: str = "robust") -> CallResponse:
    user_id = _validate_user_id(user_id)
    if mode == "robust":
        _require_built_user(user_id)
    daily = await _create_daily_room()
    _spawn_persona_bot(user_id, user_id, daily["room_url"], daily["token"], mode)
    return CallResponse(room_url=daily["room_url"], phone_number=os.getenv("TWILIO_PHONE_NUMBER", ""))



async def _twilio_inbound_response(request: Request, user_id: str) -> Response:
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    if not auth_token:
        raise HTTPException(status_code=503, detail="TWILIO_AUTH_TOKEN not configured")
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
    user_id = _validate_user_id(user_id)
    _require_built_user(user_id)
    return await _twilio_inbound_response(request, user_id)


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        raw_user_id = websocket.query_params.get("user_id", "")
        if not raw_user_id:
            LOGGER.warning("media_stream_no_user_id_param")
            await websocket.close(code=1008)
            return
        user_id = _validate_user_id(raw_user_id)
        if not _validate_media_stream_auth(
            user_id,
            websocket.query_params.get("ts"),
            websocket.query_params.get("token"),
        ):
            LOGGER.warning("media_stream_auth_failed user_id=%s", user_id)
            await websocket.close(code=1008)
            return
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

        mode = websocket.query_params.get("mode", "robust")

        from prompts import zero_shot_system, instant_persona_system, persona_system
        if mode == "zero_shot":
            initial_system_prompt = zero_shot_system(user_id)
            spec = {}
        elif mode == "instant":
            from personality.extractor import load_instant_personality_spec
            spec = load_instant_personality_spec(user_id, _s3_client(), _bucket())
            initial_system_prompt = instant_persona_system(user_id, spec)
        else:
            spec = load_personality_spec(user_id, _s3_client(), _bucket())
            initial_system_prompt = persona_system(user_id, spec, [])

        llm = GeminiLiveLLMService(
            api_key=os.getenv("GEMINI_API_KEY"),
            settings=GeminiLiveLLMService.Settings(
                model=os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview"),
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
                
                if mode != "robust":
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


def _run_vanguard_background(user_id: str, run_id: str) -> None:
    import threading
    _vanguard_live_totals[run_id] = -1  # -1 = initializing, -2 = error
    try:
        suite = load_attack_suite(user_id)
        _vanguard_live_totals[run_id] = len(suite)
        persona_agent_url = os.getenv("PERSONA_AGENT_URL", "http://localhost:8000")
        asyncio.run(run_vanguard(user_id, run_id, persona_agent_url, suite, live_results=_vanguard_live))
    except Exception:
        LOGGER.exception("vanguard_background_failed run_id=%s", run_id)
        _vanguard_live_totals[run_id] = -2

    def _cleanup() -> None:
        time.sleep(300)
        _vanguard_live.pop(run_id, None)
        _vanguard_live_totals.pop(run_id, None)
    Thread(target=_cleanup, daemon=True).start()


@app.post("/users/{user_id}/vanguard/run", response_model=QueuedResponse)
async def vanguard_run(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    user_id = _validate_user_id(user_id)
    _rate_limit("vanguard", user_id)
    _require_built_user(user_id)
    run_id = str(uuid.uuid4())
    background_tasks.add_task(_run_vanguard_background, user_id, run_id)
    return QueuedResponse(run_id=run_id, status="queued")


def _vanguard_runs_sync(user_id: str) -> list[dict[str, Any]]:
    user_id = _validate_user_id(user_id)
    runs = []
    for key in _list_keys(f"{user_id}/vanguard_runs/"):
        if key.endswith(".json"):
            try:
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
            except Exception:
                continue
    return sorted(runs, key=_vanguard_run_sort_key)


@app.get("/users/{user_id}/vanguard/runs")
async def vanguard_runs(user_id: str) -> list[dict[str, Any]]:
    user_id = _validate_user_id(user_id)
    return await asyncio.to_thread(_vanguard_runs_sync, user_id)


@app.get("/users/{user_id}/vanguard/runs/{run_id}")
async def vanguard_run_result(user_id: str, run_id: str) -> dict[str, Any]:
    user_id = _validate_user_id(user_id)
    if not _UUID_RE.match(run_id) and not _CYCLE_RUN_RE.match(run_id):
        raise HTTPException(status_code=400, detail="Invalid run_id format")
    data = _get_json_key(f"{user_id}/vanguard_runs/{run_id}.json")
    data.pop("persona_agent_url", None)  # don't expose internal service topology
    return data


@app.get("/users/{user_id}/vanguard/runs/{run_id}/live")
async def vanguard_run_live(user_id: str, run_id: str) -> dict[str, Any]:  # noqa: ARG001
    _validate_user_id(user_id)
    sessions = list(_vanguard_live.get(run_id, []))
    expected = _vanguard_live_totals.get(run_id)
    error = expected == -2
    complete = error or (expected is not None and expected >= 0 and len(sessions) >= expected)
    return {
        "sessions": sessions,
        "complete": complete,
        "total": len(sessions),
        "expected_total": max(0, expected or 0),
        "error": error,
    }


@app.get("/users/{user_id}/attack_suite")
async def get_attack_suite(user_id: str) -> list[dict[str, Any]]:
    user_id = _validate_user_id(user_id)
    return await asyncio.to_thread(load_attack_suite, user_id)


@app.post("/users/{user_id}/vanguard/improve", response_model=QueuedResponse)
async def vanguard_improve(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
    user_id = _validate_user_id(user_id)
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
    run_id = f"cycle_{cycle_number}_regression"
    _vanguard_live_totals[run_id] = -1
    _vanguard_live[run_id] = []

    def _cleanup() -> None:
        time.sleep(1200)
        _vanguard_live.pop(run_id, None)
        _vanguard_live_totals.pop(run_id, None)
    Thread(target=_cleanup, daemon=True).start()

    background_tasks.add_task(run_improvement_cycle, user_id, full_run, persona_prompt, cycle_number)
    return QueuedResponse(cycle_number=cycle_number, run_id=run_id, status="queued")


def _aggregate_pass_rate_by_persona(user_id: str) -> dict[str, dict[str, Any]]:
    """Aggregate pass/fail counts per attack_persona across all vanguard runs."""
    user_id = _validate_user_id(user_id)
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
    user_id = _validate_user_id(user_id)
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
    suite_size = len(await asyncio.to_thread(load_attack_suite, user_id))
    pass_rate_by_persona = await asyncio.to_thread(_aggregate_pass_rate_by_persona, user_id)
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
                "pass_rate_before": item.get("pass_rate_before"),
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
    user_id = _validate_user_id(user_id)
    personality_spec_ready = _key_exists(f"{user_id}/personality/personality_spec.json")
    instant_spec_ready = _key_exists(f"{user_id}/personality/instant_spec.json")
    voice_runtime_ready = bool(os.getenv("GEMINI_API_KEY"))

    rag_ready = False
    try:
        rag_ready = await asyncio.to_thread(has_knowledge_base, user_id)
    except Exception:
        pass

    vanguard_runs = len([key for key in _list_keys(f"{user_id}/vanguard_runs/") if key.endswith(".json")])
    improvement_cycles = len([key for key in _list_keys(f"{user_id}/improvement_cycles/") if key.endswith(".json")])
    try:
        attack_suite_size = len(_get_json_key(f"{user_id}/attack_suite.json")) if _key_exists(f"{user_id}/attack_suite.json") else 0
    except Exception:
        attack_suite_size = 0

    return {
        "personality_spec_ready": personality_spec_ready,
        "instant_spec_ready": instant_spec_ready,
        "voice_runtime_ready": voice_runtime_ready,
        "voice_clone_ready": voice_runtime_ready,
        "rag_ready": rag_ready,
        "vanguard_runs": vanguard_runs,
        "improvement_cycles": improvement_cycles,
        "attack_suite_size": attack_suite_size,
    }


class ChatRequest(BaseModel):
    message: str
    user_id: str = "demo"
    mode: str = "robust"


@app.get("/users/{user_id}/transcript_scores")
async def transcript_scores(user_id: str) -> dict[str, Any]:
    user_id = _validate_user_id(user_id)
    try:
        return _get_json_key(f"{user_id}/transcript_scores/overall.json")
    except Exception:
        raise HTTPException(status_code=404, detail="No transcript scores found. Run build first.")


@app.post("/chat")
async def chat(req: ChatRequest):
    user_id = _validate_user_id(req.user_id)
    _rate_limit("chat", user_id)
    if req.mode == "robust":
        _require_built_user(user_id)
    start = time.time()
    
    from prompts import zero_shot_system, instant_persona_system
    if req.mode == "zero_shot":
        system_prompt = zero_shot_system(user_id)
    elif req.mode == "instant":
        from personality.extractor import load_instant_personality_spec
        spec = load_instant_personality_spec(user_id, _s3_client(), _bucket())
        system_prompt = instant_persona_system(user_id, spec)
    else:
        system_prompt = await asyncio.to_thread(build_dynamic_system_prompt, user_id, user_id, [], req.message)
        
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
