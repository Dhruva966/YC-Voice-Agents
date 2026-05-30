"""Transcript quality scoring — selects the best CALLER/AGENT turns for fine-tuning.

Algorithm:
1. Parse each transcript into CALLER/AGENT turn pairs
2. Score each AGENT turn via NVIDIA NIM on 5 dimensions (0-10)
3. Compute aggregate score per turn (mean of 5 dimensions)
4. Select top-K turns per dimension (TRANSCRIPT_SCORE_TOP_K, default 50)
5. Return ScoredTranscriptResult with all turns + top-K selection

The top_k_turns from this result become the fine-tune training JSONL for NVIDIA NIM LoRA.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field, asdict
from typing import Any

from openai import OpenAI

from prompts import transcript_quality_score as _score_prompt
from storage import s3_client as _s3_client, bucket_name as _bucket

LOGGER = logging.getLogger(__name__)

_DIMENSIONS = ["empathy", "objection_handling", "naturalness", "conversational_flow", "closing_technique"]
_CALLER_LABELS = {"caller", "customer", "user", "prospect", "buyer", "client"}
_AGENT_LABELS = {"agent", "assistant", "rep", "sales", "sales_rep", "seller"}


def _nim_client() -> OpenAI:
    return OpenAI(
        api_key=os.getenv("NVIDIA_API_KEY"),
        base_url=os.getenv("NVIDIA_BASE_URL"),
    )


def _nim_model() -> str:
    return os.getenv("NVIDIA_BASE_MODEL") or "meta/llama-4-maverick-17b-128e-instruct"


def _role_from_label(label: str, generic_roles: dict[str, str]) -> str | None:
    normalized = label.strip().lower().replace(" ", "_")
    if normalized in _CALLER_LABELS:
        return "caller"
    if normalized in _AGENT_LABELS:
        return "agent"
    if normalized.startswith(("speaker", "participant")):
        if normalized not in generic_roles:
            generic_roles[normalized] = "caller" if "caller" not in generic_roles.values() else "agent"
        return generic_roles[normalized]
    return None


@dataclass
class ScoredTurn:
    caller: str
    agent: str
    source_file: str
    turn_index: int
    scores: dict[str, float] = field(default_factory=dict)

    @property
    def aggregate(self) -> float:
        if not self.scores:
            return 0.0
        return sum(self.scores.get(d, 0.0) for d in _DIMENSIONS) / len(_DIMENSIONS)


@dataclass
class ScoredTranscriptResult:
    turns: list[ScoredTurn] = field(default_factory=list)
    top_k_turns: list[ScoredTurn] = field(default_factory=list)
    aggregate_score: float = 0.0
    dimension_scores: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "turns": [
                {**asdict(t), "aggregate": t.aggregate}
                for t in self.turns
            ],
            "top_k_turns": [
                {**asdict(t), "aggregate": t.aggregate}
                for t in self.top_k_turns
            ],
            "aggregate_score": self.aggregate_score,
            "dimension_scores": self.dimension_scores,
        }


def _parse_turns(transcript: dict[str, Any], source_file: str) -> list[ScoredTurn]:
    """Extract CALLER/AGENT turn pairs from a transcript dict."""
    turns_raw = transcript.get("turns") or transcript.get("segments") or []
    paired: list[ScoredTurn] = []

    if turns_raw and isinstance(turns_raw[0], dict):
        # Standard format: [{role: caller|agent, text: ...}] plus speaker-labelled variants.
        caller_buf = ""
        generic_roles: dict[str, str] = {}
        for i, turn in enumerate(turns_raw):
            role = _role_from_label(
                str(turn.get("role") or turn.get("speaker") or turn.get("speaker_label") or turn.get("participant") or ""),
                generic_roles,
            )
            text = (turn.get("text") or turn.get("content") or "").strip()
            if role == "caller" and text:
                caller_buf = text
            elif role == "agent" and text and caller_buf:
                paired.append(ScoredTurn(
                    caller=caller_buf,
                    agent=text,
                    source_file=source_file,
                    turn_index=i,
                ))
                caller_buf = ""
        if paired:
            return paired

    # Plain text: parse CALLER:/AGENT: lines
    raw_text = transcript.get("text") or json.dumps(transcript, ensure_ascii=True)
    lines = raw_text.splitlines()
    caller_buf = ""
    generic_roles: dict[str, str] = {}
    for i, line in enumerate(lines):
        line = line.strip()
        match = re.match(r"^([A-Za-z][A-Za-z0-9 _.-]{0,40})\s*:\s*(.+)$", line)
        if not match:
            continue
        role = _role_from_label(match.group(1), generic_roles)
        text = match.group(2).strip()
        if role == "caller" and text:
            caller_buf = text
        elif role == "agent" and text and caller_buf:
            paired.append(ScoredTurn(
                caller=caller_buf,
                agent=text,
                source_file=source_file,
                turn_index=i,
            ))
            caller_buf = ""

    return paired


def _score_turn(turn: ScoredTurn, client: OpenAI, model: str) -> dict[str, float]:
    """Call NVIDIA NIM to score one turn. Returns dimension scores dict."""
    prompt = _score_prompt(caller_turn=turn.caller, agent_turn=turn.agent)
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompt["system"]},
                {"role": "user", "content": prompt["user"]},
            ],
            temperature=0,
            max_tokens=64,
        )
        raw = (response.choices[0].message.content or "{}").strip()
        data = json.loads(raw)
        return {d: float(data.get(d, 5.0)) for d in _DIMENSIONS}
    except Exception:
        LOGGER.warning("score_turn_failed source=%s turn=%d", turn.source_file, turn.turn_index)
        return {d: 5.0 for d in _DIMENSIONS}


def _select_top_k(turns: list[ScoredTurn], k: int) -> list[ScoredTurn]:
    """Select top-K turns by aggregate score."""
    if not turns:
        return []
    sorted_turns = sorted(turns, key=lambda t: t.aggregate, reverse=True)
    return sorted_turns[:k]


def score_transcripts(
    user_id: str,
    transcripts: list[dict[str, Any]],
    source_filenames: list[str] | None = None,
) -> ScoredTranscriptResult:
    """Score all transcripts and return top-K selected turns.

    Args:
        user_id: Used to persist scores to local_data/{user_id}/transcript_scores/
        transcripts: List of transcript dicts (from get_user_transcripts())
        source_filenames: Optional parallel list of source file names for attribution
    """
    top_k = int(os.getenv("TRANSCRIPT_SCORE_TOP_K", "50"))
    client = _nim_client()
    model = _nim_model()

    all_turns: list[ScoredTurn] = []

    for idx, transcript in enumerate(transcripts):
        source = (
            source_filenames[idx] if source_filenames and idx < len(source_filenames)
            else transcript.get("source_file") or f"transcript_{idx}"
        )
        turns = _parse_turns(transcript, source)

        if not turns:
            LOGGER.warning("no_agent_turns_found source=%s", source)
            continue

        for turn in turns:
            turn.scores = _score_turn(turn, client, model)
            all_turns.append(turn)

    if not all_turns:
        LOGGER.warning("no_scoreable_turns_found user_id=%s", user_id)
        return ScoredTranscriptResult()

    top_k_turns = _select_top_k(all_turns, k=top_k)

    aggregate_score = sum(t.aggregate for t in all_turns) / len(all_turns)
    dimension_scores = {
        d: sum(t.scores.get(d, 0.0) for t in all_turns) / len(all_turns)
        for d in _DIMENSIONS
    }

    result = ScoredTranscriptResult(
        turns=all_turns,
        top_k_turns=top_k_turns,
        aggregate_score=round(aggregate_score, 3),
        dimension_scores={d: round(v, 3) for d, v in dimension_scores.items()},
    )

    # Persist scores for dashboard display
    try:
        s3 = _s3_client()
        s3.put_object(
            Bucket=_bucket(),
            Key=f"{user_id}/transcript_scores/overall.json",
            Body=json.dumps(result.to_dict(), ensure_ascii=True, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception:
        LOGGER.warning("transcript_scores_persist_failed user_id=%s", user_id)

    return result
