"""Vanguard attack-suite orchestration."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import time
import uuid
from typing import Any

import httpx

from storage import s3_client as _s3_client, bucket_name as _bucket
from cekura.evaluator import evaluate_transcript
from pipeline.attacker_bot import run_attacker_bot
from prompts import ATTACKER_PERSONAS

# Dedicated executor for attacker bots. Each session calls asyncio.run() internally,
# blocking the thread for the full session duration. A separate pool prevents
# Vanguard from saturating the shared asyncio default thread pool (8 threads on a
# 4-core machine) and deadlocking concurrent asyncio.to_thread() calls in FastAPI.
_VANGUARD_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=20, thread_name_prefix="vanguard"
)


def _fresh_session(session: dict[str, Any]) -> dict[str, Any]:
    instance = dict(session)
    if session.get("session_id"):
        instance["attack_definition_id"] = session["session_id"]
    instance["session_id"] = str(uuid.uuid4())
    instance["status"] = "queued"
    return instance


async def _create_daily_room(session_id: str) -> dict[str, str]:
    api_key = os.getenv("DAILY_API_KEY")
    if not api_key:
        raise RuntimeError("DAILY_API_KEY is required")
    async with httpx.AsyncClient(timeout=30) as client:
        room_response = await client.post(
            "https://api.daily.co/v1/rooms",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "name": session_id,
                "properties": {
                    "max_participants": 2,
                    "exp": int(time.time()) + 3600,
                    "enable_recording": "cloud",
                },
            },
        )
        room_response.raise_for_status()
        room = room_response.json()
        owner_token_resp = await client.post(
            "https://api.daily.co/v1/meeting-tokens",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"properties": {"room_name": room["name"], "is_owner": True}},
        )
        owner_token_resp.raise_for_status()
        participant_token_resp = await client.post(
            "https://api.daily.co/v1/meeting-tokens",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"properties": {"room_name": room["name"], "is_owner": False}},
        )
        participant_token_resp.raise_for_status()
        return {
            "room_url": room["url"],
            "token": owner_token_resp.json()["token"],
            "attacker_token": participant_token_resp.json()["token"],
        }


async def _run_one_session(
    user_id: str,
    persona_agent_url: str,
    session: dict[str, Any],
    daily: dict[str, str] | None = None,
) -> dict[str, Any]:
    if daily is None:
        daily = await _create_daily_room(session["session_id"])
    async with httpx.AsyncClient(timeout=30) as client:
        join_response = await client.post(
            f"{persona_agent_url.rstrip('/')}/join_room",
            json={
                "user_id": user_id,
                "room_url": daily["room_url"],
                "daily_token": daily["token"],
            },
        )
        join_response.raise_for_status()

    await asyncio.sleep(2)
    loop = asyncio.get_event_loop()
    transcript = await loop.run_in_executor(
        _VANGUARD_EXECUTOR,
        lambda: run_attacker_bot(
            session["session_id"],
            session["attack_persona"],
            daily["room_url"],
            daily["attacker_token"],
            system_prompt=session.get("system_prompt"),
        ),
    )
    evaluation = await evaluate_transcript(
        session["session_id"],
        transcript,
        session["attack_persona"],
        personality_spec=session.get("personality_spec"),
        rag_summaries=session.get("rag_summaries", ""),
    )
    return {
        **session,
        "status": "passed" if evaluation.get("overall_pass") else "failed",
        "room_url": daily["room_url"],
        "transcript": transcript,
        "evaluation": evaluation,
        "overall_score": evaluation.get("overall_score", 0),
    }


async def run_vanguard(
    user_id: str,
    run_id: str,
    persona_agent_url: str,
    attack_suite: list[dict[str, Any]],
    max_concurrent: int = 8,
    live_results: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    semaphore = asyncio.Semaphore(max_concurrent)
    if live_results is not None:
        live_results[run_id] = []
    run_suite = [_fresh_session(session) for session in attack_suite]

    def publish_live(result: dict[str, Any]) -> None:
        if live_results is None:
            return
        sessions = live_results.setdefault(run_id, [])
        for index, existing in enumerate(sessions):
            if existing.get("session_id") == result.get("session_id"):
                sessions[index] = result
                return
        sessions.append(result)

    async def guarded(session: dict[str, Any]) -> dict[str, Any]:
        async with semaphore:
            # Create the Daily room first so we can publish the room_url immediately —
            # this lets the frontend show a clickable "Listen" link while the session is live.
            try:
                daily = await _create_daily_room(session["session_id"])
            except Exception as exc:
                result = {
                    **session,
                    "status": "failed",
                    "error": f"room_creation_failed: {exc}",
                    "overall_score": 0,
                    "evaluation": {"overall_pass": False, "overall_score": 0, "failure_annotations": []},
                }
                publish_live(result)
                return result
            publish_live({**session, "status": "running", "room_url": daily["room_url"]})
            try:
                result = await _run_one_session(user_id, persona_agent_url, session, daily=daily)
            except Exception as exc:
                result = {
                    **session,
                    "status": "failed",
                    "error": str(exc),
                    "overall_score": 0,
                    "evaluation": {
                        "overall_pass": False,
                        "overall_score": 0,
                        "failure_annotations": [{"error": str(exc)}],
                    },
                }
            publish_live(result)
            return result

    sessions = await asyncio.gather(*(guarded(session) for session in run_suite))
    passed = sum(1 for session in sessions if session.get("status") == "passed")
    total = len(sessions)
    result = {
        "run_id": run_id,
        "user_id": user_id,
        "persona_agent_url": persona_agent_url,
        "timestamp": time.time(),
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": (passed / total) if total else 0.0,
        "duration_seconds": round(time.perf_counter() - started, 3),
        "sessions": sessions,
    }
    s3 = _s3_client()
    s3.put_object(
        Bucket=_bucket(),
        Key=f"{user_id}/vanguard_runs/{run_id}.json",
        Body=json.dumps(result, ensure_ascii=True, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    return result


def build_default_attack_suite() -> list[dict[str, Any]]:
    # 9 sessions: one per persona, first 9 of the 10 defined personas.
    # Keeps concurrent Daily room count manageable for demo hardware.
    personas = list(ATTACKER_PERSONAS)[:9]
    return [
        {"session_id": str(uuid.uuid4()), "attack_persona": persona, "status": "queued"}
        for persona in personas
    ]


def load_attack_suite(user_id: str) -> list[dict[str, Any]]:
    s3 = _s3_client()
    try:
        body = s3.get_object(Bucket=_bucket(), Key=f"{user_id}/attack_suite.json")["Body"].read()
        return json.loads(body.decode("utf-8"))
    except Exception:
        suite = build_default_attack_suite()
        save_attack_suite(user_id, suite)
        return suite


def save_attack_suite(user_id: str, suite: list[dict[str, Any]]) -> str:
    key = f"{user_id}/attack_suite.json"
    _s3_client().put_object(
        Bucket=_bucket(),
        Key=key,
        Body=json.dumps(suite, ensure_ascii=True, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    return key
