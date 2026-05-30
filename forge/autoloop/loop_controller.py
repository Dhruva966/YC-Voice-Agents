"""Auto-improvement loop controller."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any

from openai import OpenAI

from storage import s3_client as _s3_client, bucket_name as _bucket
from finetune.persona_finetune import submit_finetune, wait_for_finetune_async
from prompts import (
    ATTACKER_PERSONAS,
    failure_annotation,
    finetune_example_formatter,
    harder_variant_generator,
)
from vanguard.orchestrator import load_attack_suite, run_vanguard, save_attack_suite

LOGGER = logging.getLogger(__name__)


def _base_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or "meta/llama-4-maverick-17b-128e-instruct"


def _call_json_prompt(prompt: dict[str, str]) -> dict[str, Any]:
    client = OpenAI(api_key=os.getenv("NVIDIA_API_KEY"), base_url=os.getenv("NVIDIA_BASE_URL"))
    response = client.chat.completions.create(
        model=_base_model(),
        messages=[
            {"role": "system", "content": prompt["system"]},
            {"role": "user", "content": prompt["user"]},
        ],
        temperature=0,
    )
    raw = response.choices[0].message.content or "{}"
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(raw)


def _conversation_history_until_failure(transcript: dict[str, Any], failure_turn: int) -> list[dict[str, str]]:
    turns = transcript.get("turns", [])[: max(0, failure_turn)]
    return [
        {
            "role": "user" if turn.get("role") == "caller" else "assistant",
            "content": turn.get("text", ""),
        }
        for turn in turns
    ]


def run_improvement_cycle(
    user_id: str,
    vanguard_summary: dict[str, Any],
    persona_system_prompt: str,
    cycle_number: int,
) -> dict[str, Any]:
    failed_sessions = [
        session for session in vanguard_summary.get("sessions", []) if session.get("status") == "failed"
    ]
    passed_sessions = [
        session for session in vanguard_summary.get("sessions", []) if session.get("status") == "passed"
    ]
    annotations: list[dict[str, Any]] = []
    examples: list[dict[str, Any]] = []

    for session in failed_sessions:
        prompt = failure_annotation(
            persona_system_prompt,
            json.dumps(session.get("transcript", {}), ensure_ascii=True),
            session.get("evaluation", {}),
        )
        annotation = _call_json_prompt(prompt)
        annotations.append(annotation)
        history = _conversation_history_until_failure(session.get("transcript", {}), int(annotation.get("failure_turn", 0)))
        examples.append(
            finetune_example_formatter(
                persona_system_prompt,
                history,
                annotation.get("correct_response", ""),
            )
        )

    adapter_id = _base_model()
    if examples:
        try:
            fine_tune_job_id = submit_finetune(user_id, examples, job_type=f"persona_cycle_{cycle_number}")
            adapter_id = asyncio.run(wait_for_finetune_async(fine_tune_job_id))
        except Exception:
            LOGGER.exception("fine_tune_failed_using_base_model")
    else:
        LOGGER.info("no_failed_sessions_to_fine_tune")

    persona_agent_url = vanguard_summary.get("persona_agent_url", "http://backend:8000")
    regression_suite = [
        {
            "session_id": str(uuid.uuid4()),
            "original_session_id": session["session_id"],
            "attack_persona": session["attack_persona"],
            "status": "queued",
        }
        for session in passed_sessions
    ]
    regression = asyncio.run(
        run_vanguard(
            user_id,
            f"cycle_{cycle_number}_regression",
            persona_agent_url,
            regression_suite,
            max_concurrent=10,
        )
    )
    regression_failed = regression.get("failed", 0) > 0
    if regression_failed:
        LOGGER.warning("regression_gate_failed_%d_regressions", regression.get("failed", 0))

    suite = load_attack_suite(user_id)
    old_size = len(suite)
    for session in regression.get("sessions", []):
        original = ATTACKER_PERSONAS.get(session.get("attack_persona", ""), "")
        prompt = harder_variant_generator(
            original,
            json.dumps(session.get("transcript", {}), ensure_ascii=True),
            session.get("evaluation", {}),
        )
        variants = _call_json_prompt(prompt).get("variants", [])
        for variant in variants:
            suite.append(
                {
                    "session_id": variant.get("variant_id") or f"cycle_{cycle_number}_{len(suite)}",
                    "attack_persona": session.get("attack_persona"),
                    "status": "queued",
                    "system_prompt": variant.get("full_system_prompt"),
                    "difficulty": variant.get("difficulty"),
                    "tactic_change": variant.get("tactic_change"),
                }
            )
    save_attack_suite(user_id, suite)

    before = float(vanguard_summary.get("pass_rate", 0.0))
    after = float(regression.get("pass_rate", before))
    summary = {
        "cycle_number": cycle_number,
        "pass_rate_before": before,
        "pass_rate_after": after,
        "delta": after - before,
        "adapter_id": adapter_id,
        "attack_suite_size_before": old_size,
        "attack_suite_size_after": len(suite),
        "failure_annotations": annotations,
        "regression_failed": regression_failed,
    }
    _s3_client().put_object(
        Bucket=_bucket(),
        Key=f"{user_id}/improvement_cycles/{cycle_number}.json",
        Body=json.dumps(summary, ensure_ascii=True, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    return summary
