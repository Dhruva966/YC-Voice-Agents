"""Personality extraction using NVIDIA NIM-compatible OpenAI client."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from openai import OpenAI

from prompts import personality_extraction

DEFAULT_NVIDIA_BASE_MODEL = "meta/llama-4-maverick-17b-128e-instruct"


def _persona_model() -> str:
    return (
        os.getenv("NVIDIA_PERSONA_MODEL")
        or os.getenv("NVIDIA_BASE_MODEL")
        or DEFAULT_NVIDIA_BASE_MODEL
    )


def _strip_json_fences(raw: str) -> str:
    text = raw.strip()
    match = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else text


def extract_personality(corpus: str) -> dict[str, Any]:
    if not corpus.strip():
        raise ValueError("Corpus is empty — upload transcripts before building.")
    trimmed = corpus[:80000]
    prompt = personality_extraction(trimmed)
    client = OpenAI(api_key=os.getenv("NVIDIA_API_KEY"), base_url=os.getenv("NVIDIA_BASE_URL"))
    last_exc: Exception | None = None
    raw_output = ""
    for _attempt in range(2):
        response = client.chat.completions.create(
            model=_persona_model(),
            messages=[
                {"role": "system", "content": prompt["system"]},
                {"role": "user", "content": prompt["user"]},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_output = response.choices[0].message.content or ""
        cleaned = _strip_json_fences(raw_output)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as exc:
            last_exc = exc
    raise ValueError(f"Failed to parse personality JSON after 2 attempts: {raw_output}") from last_exc


def save_personality_spec(user_id: str, spec: dict[str, Any], s3_client, bucket: str) -> str:
    key = f"{user_id}/personality/personality_spec.json"
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(spec, ensure_ascii=True, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    return key


def load_personality_spec(user_id: str, s3_client, bucket: str) -> dict[str, Any]:
    key = f"{user_id}/personality/personality_spec.json"
    body = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
    return json.loads(body.decode("utf-8"))
