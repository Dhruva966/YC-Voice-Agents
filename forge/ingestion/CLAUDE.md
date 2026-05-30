# forge/ingestion — CLAUDE.md

**Purpose:** All data ingestion and transcript intelligence. Routes uploaded files to the right processor, transcribes audio, diarizes speakers, and — the novel step — scores transcript segments to select the best training data for fine-tuning.

→ Root: [CLAUDE.md](../../CLAUDE.md)

## Key Files
| What | Where |
|------|-------|
| Entry point | `pipeline.py:ingest_file()` |
| Transcript scorer (new) | `transcript_scorer.py:score_transcripts()` |
| Audio transcription | `transcribe.py:transcribe_audio()` |
| Speaker diarization | `diarize.py:diarize_audio()` |
| Text normalization | `text_cleaner.py:clean_text()` |
| Corpus loader | `pipeline.py:get_user_corpus()` |
| Knowledge base loader | `pipeline.py:get_user_knowledge_base_texts()` |
| Transcript loader | `pipeline.py:get_user_transcripts()` |

## Transcript Scorer — Algorithm

`transcript_scorer.py:score_transcripts(user_id, transcripts)`:

1. Parse each transcript into CALLER/AGENT turn pairs
2. Score each AGENT turn via NVIDIA NIM on 5 dimensions (0–10):
   - `empathy` — warmth, active listening signal
   - `objection_handling` — smooth pivot, not defensive
   - `naturalness` — human-like pacing, no robotic phrasing
   - `conversational_flow` — clean turn transitions, no dead air
   - `closing_technique` — confident ask, clear CTA
3. Select top-K turns per dimension (`TRANSCRIPT_SCORE_TOP_K`, default 50)
4. Save scores → `./local_data/{user_id}/transcript_scores/{filename}.json`
5. Return `ScoredTranscriptResult` with `top_k_turns`, `aggregate_score`, `dimension_scores`

The top-K turns become the fine-tune training JSONL for NVIDIA NIM LoRA.

## Allowed Patterns

✅ **Score each turn, collect top-K per dimension, return structured result:**
```python
def score_transcripts(user_id: str, transcripts: list[dict]) -> ScoredTranscriptResult:
    all_turns = []
    for transcript in transcripts:
        for turn in _parse_turns(transcript):
            score = _score_turn_via_nim(turn)
            all_turns.append({**turn, "scores": score})
    top_k = _select_top_k(all_turns, k=int(os.getenv("TRANSCRIPT_SCORE_TOP_K", "50")))
    return ScoredTranscriptResult(turns=all_turns, top_k_turns=top_k, ...)
```

✅ **Scoring prompt lives in prompts.py only:**
```python
from prompts import transcript_quality_score

prompt = transcript_quality_score(caller_turn=turn["caller"], agent_turn=turn["agent"])
```

✅ **Diarization with graceful fallback:**
```python
try:
    from diarize import diarize_audio
    segments = diarize_audio(audio_path)
except Exception:
    LOGGER.warning("diarization_failed_using_raw_transcription")
    segments = _fallback_segments(transcript_text)
```

✅ **ingest_file() routes by extension — add new types here only:**
```python
async def ingest_file(user_id: str, local_path: str, filename: str) -> dict:
    ext = Path(filename).suffix.lower()
    if ext in {".wav", ".mp3", ".m4a", ".ogg"}:
        return await _ingest_audio(user_id, local_path, filename)
    elif ext in {".txt", ".eml"}:
        return await _ingest_text(user_id, local_path, filename)
    elif ext == ".pdf":
        return await _ingest_pdf(user_id, local_path, filename)
    ...
```

✅ **Always persist raw uploads to S3/local before processing:**
```python
s3 = _s3_client()
s3.upload_file(local_path, _bucket(), f"{user_id}/uploads/{filename}")
# Then process
```

## Forbidden Patterns

❌ **Never score inline — all scoring logic in transcript_scorer.py:**
```python
# WRONG — inline scoring
for turn in turns:
    if len(turn["agent"]) > 50:  # "good enough" heuristic
        good_turns.append(turn)

# RIGHT
from ingestion.transcript_scorer import score_transcripts
result = score_transcripts(user_id, transcripts)
top_turns = result.top_k_turns
```

❌ **Never call NVIDIA NIM directly in pipeline.py — go through transcript_scorer or personality/extractor:**
```python
# WRONG — direct NIM call in ingestion pipeline
import openai
client = openai.OpenAI(api_key=NVIDIA_API_KEY, base_url=NVIDIA_BASE_URL)
response = client.chat.completions.create(...)

# RIGHT — call the scorer
from ingestion.transcript_scorer import score_transcripts
```

❌ **Never hardcode the Whisper model size — use env var:**
```python
# WRONG
model = WhisperModel("large-v3")

# RIGHT
model_size = os.getenv("WHISPER_MODEL_SIZE", "large-v3")
model = WhisperModel(model_size)
```

❌ **Never store raw audio permanently in local_data without the user_id prefix:**
```python
# WRONG — no user isolation
s3.upload_file(path, bucket, f"audio/{filename}")

# RIGHT
s3.upload_file(path, bucket, f"{user_id}/audio/{filename}")
```

## What NOT to Do

1. **Don't block the FastAPI event loop during transcription.** Whisper runs on CPU and takes 10–60s. Always wrap in `asyncio.to_thread()` when called from an async context.

2. **Don't score transcripts that have no AGENT turns.** If a file is all CALLER, skip scoring and log a warning. The scorer will divide by zero or return meaningless results.

3. **Don't download the Whisper `large-v3` model on first production run.** It's 1.5GB. Pre-download during Docker build or set `WHISPER_MODEL_SIZE=base` for demos.

4. **Don't use the transcript scorer output directly as RAG documents.** The RAG corpus should be the full cleaned text. The top-K turns are for fine-tuning only.

5. **Don't silently drop failed transcription files.** Log the error, return a partial result with `status: "transcription_failed"`, and continue. The build pipeline must see what succeeded and what didn't.
