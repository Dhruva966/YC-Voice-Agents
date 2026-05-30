"""Forge FastAPI backend."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
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
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
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
    build_initial_system_prompt,
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
from rag.retriever import build_knowledge_base, init_db
from vanguard.orchestrator import load_attack_suite, run_vanguard
from voice.clone import create_voice_clone

LOGGER = logging.getLogger(__name__)
DEFAULT_NVIDIA_BASE_MODEL = "meta/llama-4-maverick-17b-128e-instruct"
_vanguard_live: dict[str, list[dict[str, Any]]] = {}
_vanguard_live_totals: dict[str, int] = {}


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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


def _base_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or DEFAULT_NVIDIA_BASE_MODEL


def _twilio_stream_url(request: Request) -> str:
    configured = os.getenv("TWILIO_STREAM_URL") or os.getenv("WSS_BASE_URL")
    if configured:
        return configured.rstrip("/")

    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"wss://{host}/media-stream"


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
        if isolated_keys:
            create_voice_clone(user_id, user_id, isolated_keys)

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
    daily = await _create_daily_room()
    background_tasks.add_task(run_persona_bot, user_id, user_id, daily["room_url"], daily["token"])
    return CallResponse(room_url=daily["room_url"], phone_number=os.getenv("TWILIO_PHONE_NUMBER", ""))


@app.post("/webhook/twilio/inbound")
async def twilio_inbound(request: Request) -> Response:
    twiml = VoiceResponse()
    connect = twiml.connect()
    connect.stream(url=_twilio_stream_url(request))
    return Response(content=str(twiml), media_type="application/xml")


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket):
    await websocket.accept()
    raw = await websocket.receive_text()
    data = json.loads(raw)
    while data.get("event") != "start":
        raw = await websocket.receive_text()
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

    spec = load_personality_spec("demo", _s3_client(), _bucket())
    initial_system_prompt = persona_system("demo", spec, [])

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
                chunks = await asyncio.to_thread(retrieve, "demo", query, 5)
                prompt = persona_system("demo", self._personality_spec, chunks)
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


def _run_vanguard_background(user_id: str, run_id: str) -> None:
    suite = load_attack_suite(user_id)
    _vanguard_live[run_id] = []
    _vanguard_live_totals[run_id] = len(suite)
    persona_agent_url = os.getenv("PERSONA_AGENT_URL", "http://backend:8000")
    asyncio.run(run_vanguard(user_id, run_id, persona_agent_url, suite, live_results=_vanguard_live))


@app.post("/users/{user_id}/vanguard/run", response_model=QueuedResponse)
async def vanguard_run(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
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
    sessions = list(_vanguard_live.get(run_id, []))
    expected = _vanguard_live_totals.get(run_id)
    complete = expected is not None and len(sessions) >= expected
    return {"sessions": sessions, "complete": complete, "total": len(sessions), "expected_total": expected or 0}


@app.post("/users/{user_id}/vanguard/improve", response_model=QueuedResponse)
async def vanguard_improve(user_id: str, background_tasks: BackgroundTasks) -> QueuedResponse:
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
    from pathlib import Path

    local_data = Path("local_data") / user_id

    # personality_spec_ready
    spec_path = local_data / "personality" / "personality_spec.json"
    personality_spec_ready = spec_path.exists()

    # voice_clone_ready
    voice_path = local_data / "voice_id.txt"
    voice_clone_ready = voice_path.exists()

    # rag_ready - check ChromaDB collection
    rag_ready = False
    try:
        import chromadb
        chroma_path = os.getenv("LOCAL_CHROMA_DIR", "./local_data/chroma")
        client = chromadb.PersistentClient(path=chroma_path)
        collection_names = [c.name for c in client.list_collections()]
        rag_ready = f"user_{user_id}" in collection_names
    except Exception:
        pass

    # vanguard_runs - count files in local_data/{user_id}/vanguard_runs/
    vanguard_dir = local_data / "vanguard_runs"
    vanguard_runs = 0
    if vanguard_dir.exists():
        vanguard_runs = len(list(vanguard_dir.glob("*.json")))

    # improvement_cycles - count files
    cycles_dir = local_data / "improvement_cycles"
    improvement_cycles = 0
    if cycles_dir.exists():
        improvement_cycles = len(list(cycles_dir.glob("*.json")))

    # attack_suite_size - read attack_suite.json
    attack_suite_size = 0
    suite_path = local_data / "attack_suite.json"
    if suite_path.exists():
        try:
            import json as _json
            suite = _json.loads(suite_path.read_text())
            attack_suite_size = len(suite)
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
    import time
    start = time.time()
    system_prompt = await asyncio.to_thread(build_dynamic_system_prompt, req.user_id, req.user_id, [], req.message)
    # Direct NVIDIA NIM call
    client = openai.AsyncOpenAI(
        api_key=os.getenv("NVIDIA_API_KEY"),
        base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
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
