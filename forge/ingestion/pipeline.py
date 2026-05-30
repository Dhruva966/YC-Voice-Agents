"""File ingestion pipeline."""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from docx import Document
from pypdf import PdfReader

from storage import s3_client as _s3_client, bucket_name as _bucket
from .diarize import diarize_and_isolate
from .text_cleaner import clean_text_file
from .transcribe import transcribe_audio

AUDIO_EXTENSIONS = {".mp3", ".mp4", ".wav", ".m4a", ".webm"}
TEXT_EXTENSIONS = {".txt", ".eml", ".json", ".csv", ".md"}
DOCX_EXTENSIONS = {".docx"}
PDF_EXTENSIONS = {".pdf"}

_EXECUTOR = ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 2) // 2))


async def _run_cpu(func, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_EXECUTOR, lambda: func(*args))


def _put_json(s3_client, bucket: str, key: str, payload: dict[str, Any]) -> None:
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8"),
        ContentType="application/json",
    )


def _put_text(s3_client, bucket: str, key: str, text: str) -> None:
    s3_client.put_object(Bucket=bucket, Key=key, Body=text.encode("utf-8"), ContentType="text/plain")


def _looks_like_call_transcript(text: str) -> bool:
    labels = [
        match.group(1).strip().lower().replace(" ", "_")
        for match in re.finditer(r"(?mi)^\s*([a-z][a-z0-9 _.-]{0,40})\s*:\s*\S", text)
    ]
    if len(labels) < 2:
        return False

    caller_labels = {"caller", "customer", "user", "prospect", "buyer", "client"}
    agent_labels = {"agent", "assistant", "rep", "sales", "sales_rep", "seller"}
    has_caller = any(label in caller_labels for label in labels)
    has_agent = any(label in agent_labels for label in labels)
    generic_speakers = {label for label in labels if label.startswith(("speaker", "participant"))}
    return (has_caller and has_agent) or len(generic_speakers) >= 2


def _transcript_payload(path: Path, cleaned: str, filename: str) -> dict[str, Any] | None:
    if path.suffix.lower() == ".json":
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            data = None
        if isinstance(data, dict) and any(key in data for key in ("turns", "segments", "text")):
            return {**data, "source_file": filename}
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return {"source_file": filename, "turns": data}

    if _looks_like_call_transcript(cleaned):
        return {"source_file": filename, "text": cleaned}
    return None


async def ingest_file(user_id: str, file_path: str, original_filename: str | None = None) -> dict[str, Any]:
    job_id = str(uuid.uuid4())
    path = Path(file_path)
    filename = original_filename or path.name
    suffix = Path(filename).suffix.lower()
    s3 = _s3_client()
    bucket = _bucket()

    result: dict[str, Any] = {
        "job_id": job_id,
        "user_id": user_id,
        "input_type": None,
        "s3_original_path": "",
        "s3_transcript_path": None,
        "s3_isolated_audio_path": None,
        "s3_corpus_path": None,
        "s3_knowledge_base_path": None,
        "speakers": [],
        "quality": {},
        "status": "failed",
        "errors": [],
    }

    raw_key = f"{user_id}/raw/{job_id}/{filename}"
    result["s3_original_path"] = raw_key
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    s3.upload_file(str(path), bucket, raw_key, ExtraArgs={"ContentType": content_type})

    try:
        if suffix in AUDIO_EXTENSIONS:
            result["input_type"] = "audio"
            transcript = await _run_cpu(transcribe_audio, path)
            with tempfile.TemporaryDirectory() as tempdir:
                isolated_path = Path(tempdir) / f"{job_id}.wav"
                isolation = await _run_cpu(diarize_and_isolate, path, isolated_path, transcript)
                duration = float(isolation["isolated_duration_seconds"])
                result["quality"] = {
                    "isolated_duration_seconds": duration,
                    "minimum_required_seconds": 30,
                    "passed": duration >= 30,
                }
                result["speakers"] = isolation["speakers"]
                if duration < 30:
                    raise ValueError("Isolated audio is shorter than 30 seconds")

                transcript_key = f"{user_id}/transcripts/{job_id}.json"
                audio_key = f"{user_id}/isolated_audio/{job_id}.wav"
                _put_json(s3, bucket, transcript_key, transcript)
                s3.upload_file(str(isolated_path), bucket, audio_key, ExtraArgs={"ContentType": "audio/wav"})
                result["s3_transcript_path"] = transcript_key
                result["s3_isolated_audio_path"] = audio_key

        elif suffix in TEXT_EXTENSIONS:
            result["input_type"] = "text"
            cleaned = await _run_cpu(clean_text_file, path)
            corpus_key = f"{user_id}/corpus/{job_id}.txt"
            _put_text(s3, bucket, corpus_key, cleaned)
            result["s3_corpus_path"] = corpus_key
            transcript = _transcript_payload(path, cleaned, filename)
            if transcript:
                transcript_key = f"{user_id}/transcripts/{job_id}.json"
                _put_json(s3, bucket, transcript_key, transcript)
                result["s3_transcript_path"] = transcript_key

        elif suffix in PDF_EXTENSIONS:
            result["input_type"] = "pdf"
            text = await _run_cpu(_extract_pdf_text, path)
            kb_key = f"{user_id}/knowledge_base/{job_id}.txt"
            _put_text(s3, bucket, kb_key, text)
            result["s3_knowledge_base_path"] = kb_key

        elif suffix in DOCX_EXTENSIONS:
            result["input_type"] = "docx"
            text = await _run_cpu(_extract_docx_text, path)
            kb_key = f"{user_id}/knowledge_base/{job_id}.txt"
            _put_text(s3, bucket, kb_key, text)
            result["s3_knowledge_base_path"] = kb_key

        else:
            raise ValueError(f"Unsupported file type: {suffix}")

        result["status"] = "completed"
    except Exception as exc:
        result["errors"].append(str(exc))

    return result


def _extract_docx_text(path: str | Path) -> str:
    doc = Document(str(path))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_pdf_text(path: str | Path) -> str:
    reader = PdfReader(str(path))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip()


def _list_prefix_text(s3_client, bucket: str, prefix: str) -> list[str]:
    paginator = s3_client.get_paginator("list_objects_v2")
    texts: list[str] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            body = s3_client.get_object(Bucket=bucket, Key=item["Key"])["Body"].read()
            texts.append(body.decode("utf-8", errors="ignore"))
    return texts


def get_user_corpus(user_id: str) -> list[str]:
    s3 = _s3_client()
    return _list_prefix_text(s3, _bucket(), f"{user_id}/corpus/")


def get_user_transcripts(user_id: str) -> list[dict[str, Any]]:
    s3 = _s3_client()
    transcripts = []
    for text in _list_prefix_text(s3, _bucket(), f"{user_id}/transcripts/"):
        transcripts.append(json.loads(text))
    return transcripts


def get_user_knowledge_base_texts(user_id: str) -> list[str]:
    s3 = _s3_client()
    return _list_prefix_text(s3, _bucket(), f"{user_id}/knowledge_base/")
