"""Synthetic data generation and NVIDIA customization submission."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
from openai import OpenAI

from storage import s3_client as _s3_client, bucket_name as _bucket
from prompts import synthetic_conversation

DEFAULT_NVIDIA_BASE_MODEL = "meta/llama-4-maverick-17b-128e-instruct"

CONVERSATION_TOPICS = [
    "career advice",
    "startup fundraising",
    "missed appointment",
    "technical debugging",
    "personal productivity",
    "travel logistics",
    "family update",
    "customer complaint",
    "pricing negotiation",
    "new project idea",
    "calendar conflict",
    "health routine",
    "book recommendation",
    "AI ethics",
    "market analysis",
    "friend catching up",
    "urgent favor",
    "interview prep",
    "learning plan",
    "difficult feedback",
]


def _client() -> OpenAI:
    return OpenAI(api_key=os.getenv("NVIDIA_API_KEY"), base_url=os.getenv("NVIDIA_BASE_URL"))


def _base_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or DEFAULT_NVIDIA_BASE_MODEL


def _parse_labeled_conversation(text: str) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("CALLER:"):
            messages.append({"role": "user", "content": line.removeprefix("CALLER:").strip()})
        elif line.startswith("AGENT:"):
            messages.append({"role": "assistant", "content": line.removeprefix("AGENT:").strip()})
    if len(messages) < 4 or messages[0]["role"] != "user":
        raise ValueError("Malformed synthetic conversation")
    return messages


def generate_synthetic_conversations(
    personality_spec: dict[str, Any],
    real_transcripts: list[dict[str, Any]],
    n: int = 500,
) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    sample_transcripts = [json.dumps(item, ensure_ascii=True)[:4000] for item in real_transcripts[:20]]
    client = _client()
    model = _base_model()

    for index in range(n):
        topic = CONVERSATION_TOPICS[index % len(CONVERSATION_TOPICS)]
        prompt = synthetic_conversation(personality_spec, sample_transcripts, topic)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompt["system"]},
                {"role": "user", "content": prompt["user"]},
            ],
            temperature=0.8,
        )
        raw = response.choices[0].message.content or ""
        try:
            examples.append({"messages": _parse_labeled_conversation(raw)})
        except ValueError:
            continue
        if (index + 1) % 50 == 0:
            print(f"Generated {index + 1}/{n} synthetic conversations")
    return examples


def submit_finetune(user_id: str, training_examples: list[dict[str, Any]], job_type: str) -> str:
    s3 = _s3_client()
    bucket = _bucket()
    key = f"{user_id}/finetune/{job_type}/training.jsonl"
    with tempfile.TemporaryDirectory() as tempdir:
        path = Path(tempdir) / "training.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for example in training_examples:
                handle.write(json.dumps(example, ensure_ascii=True) + "\n")
        s3.upload_file(str(path), bucket, key)

    presigned_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=3600,
    )
    base_url = os.getenv("NVIDIA_CUSTOMIZATION_BASE_URL")
    if not base_url:
        raise RuntimeError("NVIDIA_CUSTOMIZATION_BASE_URL is required")

    payload = {
        "training_file_url": presigned_url,
        "base_model": _base_model(),
        "job_type": job_type,
        "lora_config": {
            "r": 16,
            "alpha": 32,
            "target_modules": ["q_proj", "v_proj"],
            "num_epochs": 3,
            "lr": 2e-4,
            "batch_size": 8,
            "max_seq_length": 2048,
        },
    }
    response = httpx.post(
        f"{base_url.rstrip('/')}/customizations",
        headers={"Authorization": f"Bearer {os.getenv('NVIDIA_API_KEY')}"},
        json=payload,
        timeout=60,
    )
    response.raise_for_status()
    job_id = response.json().get("job_id") or response.json()["id"]
    s3.put_object(Bucket=bucket, Key=f"{user_id}/finetune/{job_type}/job_id.txt", Body=job_id.encode("utf-8"))
    return job_id


def _completed_model(job_id: str, payload: Any) -> str:
    """Extract adapter model ID from NVIDIA fine-tune response payload."""
    base_model = _base_model()
    try:
        if not isinstance(payload, dict):
            return base_model

        ignored_ids = {job_id}
        for key in ("id", "job_id", "customization_id"):
            value = payload.get(key)
            if isinstance(value, str):
                ignored_ids.add(value)
        containers = (
            payload,
            payload.get("result"),
            payload.get("output"),
            payload.get("customization"),
        )
        keys = (
            "adapter_model_id",
            "adapter_id",
            "customized_model_id",
            "custom_model_id",
            "fine_tuned_model",
            "model",
            "model_id",
            "output_model_id",
        )
        for container in containers:
            if not isinstance(container, dict):
                continue
            for key in keys:
                value = container.get(key)
                if isinstance(value, str):
                    candidate = value.strip()
                    if candidate and candidate not in ignored_ids:
                        return candidate
    except Exception:
        pass
    return base_model


def wait_for_finetune(job_id: str, poll_interval: int = 60) -> str:
    """Poll for NVIDIA fine-tune completion (blocking). Prefer wait_for_finetune_async in async contexts."""
    base_url = os.getenv("NVIDIA_CUSTOMIZATION_BASE_URL")
    if not base_url:
        raise RuntimeError("NVIDIA_CUSTOMIZATION_BASE_URL is required")

    while True:
        response = httpx.get(
            f"{base_url.rstrip('/')}/customizations/{job_id}",
            headers={"Authorization": f"Bearer {os.getenv('NVIDIA_API_KEY')}"},
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        status = str(payload.get("status", "") if isinstance(payload, dict) else "").lower()
        if status in {"succeeded", "completed", "success"}:
            return _completed_model(job_id, payload)
        if status in {"failed", "cancelled", "canceled"}:
            raise RuntimeError(f"Fine-tune {job_id} ended with status {status}: {payload}")
        time.sleep(poll_interval)


async def wait_for_finetune_async(job_id: str, poll_interval: int = 60) -> str:
    """Async poll for NVIDIA fine-tune completion. Uses httpx.AsyncClient + asyncio.sleep to avoid blocking a thread."""
    base_url = os.getenv("NVIDIA_CUSTOMIZATION_BASE_URL")
    if not base_url:
        raise RuntimeError("NVIDIA_CUSTOMIZATION_BASE_URL is required")

    async with httpx.AsyncClient(timeout=60) as client:
        while True:
            response = await client.get(
                f"{base_url.rstrip('/')}/customizations/{job_id}",
                headers={"Authorization": f"Bearer {os.getenv('NVIDIA_API_KEY')}"},
            )
            response.raise_for_status()
            payload = response.json()
            status = str(payload.get("status", "") if isinstance(payload, dict) else "").lower()
            if status in {"succeeded", "completed", "success"}:
                return _completed_model(job_id, payload)
            if status in {"failed", "cancelled", "canceled"}:
                raise RuntimeError(f"Fine-tune {job_id} ended with status {status}: {payload}")
            await asyncio.sleep(poll_interval)


def save_adapter_id(user_id: str, adapter_id: str, s3_client, bucket: str) -> str:
    key = f"{user_id}/adapter_id.txt"
    s3_client.put_object(Bucket=bucket, Key=key, Body=adapter_id.encode("utf-8"))
    return key


def get_adapter_id(user_id: str, s3_client, bucket: str) -> str | None:
    try:
        body = s3_client.get_object(Bucket=bucket, Key=f"{user_id}/adapter_id.txt")["Body"].read()
    except Exception:
        return None
    return body.decode("utf-8").strip()
