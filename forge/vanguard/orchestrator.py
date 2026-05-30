"""Vanguard attack-suite orchestration."""

from __future__ import annotations

import asyncio
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


async def _run_one_session(user_id: str, persona_agent_url: str, session: dict[str, Any]) -> dict[str, Any]:
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
    transcript = await asyncio.to_thread(
        run_attacker_bot,
        session["session_id"],
        session["attack_persona"],
        daily["room_url"],
        daily["attacker_token"],
        system_prompt=session.get("system_prompt"),
    )
    evaluation = await evaluate_transcript(
        session["session_id"],
        transcript,
        session["attack_persona"],
        personality_spec=session.get("personality_spec"),
        rag_summaries=session.get("rag_summaries", ""),
        user_id=user_id,
    )
    return {
        **session,
        "status": "passed" if evaluation.get("overall_pass") else "failed",
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
    live_key: str | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    semaphore = asyncio.Semaphore(max_concurrent)
    _live_key = live_key or run_id
    if live_results is not None:
        live_results[_live_key] = []

    async def guarded(session: dict[str, Any]) -> dict[str, Any]:
        async with semaphore:
            try:
                result = await _run_one_session(user_id, persona_agent_url, session)
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
            if live_results is not None:
                live_results[_live_key].append(result)
            return result

    sessions = await asyncio.gather(*(guarded(session) for session in attack_suite))
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
    personas = list(ATTACKER_PERSONAS)
    repeated = personas + personas[:4]
    return [
        {"session_id": str(uuid.uuid4()), "attack_persona": persona, "status": "queued"}
        for persona in repeated
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
