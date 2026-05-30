"""ElevenLabs voice cloning helpers."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx

from storage import s3_client as _s3_client, bucket_name as _bucket


def create_voice_clone(user_id: str, user_name: str, isolated_audio_s3_keys: list[str]) -> str:
    if not isolated_audio_s3_keys:
        raise ValueError("No isolated audio passed quality gate")

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is required")

    s3 = _s3_client()
    bucket = _bucket()
    with tempfile.TemporaryDirectory() as tempdir:
        file_handles = []
        try:
            files = []
            for index, key in enumerate(isolated_audio_s3_keys):
                local_path = Path(tempdir) / f"sample_{index}.wav"
                s3.download_file(bucket, key, str(local_path))
                handle = local_path.open("rb")
                file_handles.append(handle)
                files.append(("files", (local_path.name, handle, "audio/wav")))

            data = {
                "name": user_name,
                "description": f"Forge voice clone for {user_name}",
                "labels": '{"source":"forge","user_id":"' + user_id + '"}',
            }
            response = httpx.post(
                "https://api.elevenlabs.io/v1/voices/add",
                headers={"xi-api-key": api_key},
                data=data,
                files=files,
                timeout=120,
            )
            response.raise_for_status()
            voice_id = response.json()["voice_id"]
        finally:
            for handle in file_handles:
                handle.close()

    s3.put_object(Bucket=bucket, Key=f"{user_id}/voice_id.txt", Body=voice_id.encode("utf-8"))
    return voice_id


def get_voice_id(user_id: str, fallback: str | None = None) -> str:
    s3 = _s3_client()
    try:
        body = s3.get_object(Bucket=_bucket(), Key=f"{user_id}/voice_id.txt")["Body"].read()
        return body.decode("utf-8").strip()
    except Exception:
        if fallback is not None:
            return fallback
        raise ValueError(
            f"No voice clone found for user {user_id} — run the build pipeline first, or set TWILIO_VOICE_ID in .env"
        )


def evaluate_voice_similarity() -> dict[str, object]:
    # TODO: implement real voice similarity comparison using ElevenLabs or speaker embedding model
    return {
        "score": 0.82,
        "method": "stub",
        "note": "production would use MOS metric",
    }
