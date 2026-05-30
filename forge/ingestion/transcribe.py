"""Audio transcription with faster-whisper."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

_model_lock = threading.Lock()
_model_cache: dict[str, object] = {}


def _get_model(model_size: str):
    if model_size not in _model_cache:
        with _model_lock:
            if model_size not in _model_cache:
                from faster_whisper import WhisperModel
                _model_cache[model_size] = WhisperModel(model_size, device="auto", compute_type="auto")
    return _model_cache[model_size]


def transcribe_audio(audio_path: str | Path, model_size: str | None = None) -> dict[str, Any]:
    model_size = model_size or os.getenv("WHISPER_MODEL_SIZE", "base")
    model = _get_model(model_size)
    segments, info = model.transcribe(
        str(audio_path),
        vad_filter=True,
        word_timestamps=True,
    )

    segment_list: list[dict[str, Any]] = []
    words: list[dict[str, Any]] = []
    for segment in segments:
        segment_words = [
            {
                "word": word.word,
                "start": word.start,
                "end": word.end,
                "probability": word.probability,
            }
            for word in (segment.words or [])
        ]
        words.extend(segment_words)
        segment_list.append(
            {
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
                "words": segment_words,
            }
        )

    return {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "text": " ".join(segment["text"].strip() for segment in segment_list).strip(),
        "segments": segment_list,
        "words": words,
    }
