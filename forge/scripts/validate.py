"""Pre-hackathon validation script for Forge.

Run from the forge/ directory:
    python3 scripts/validate.py
    python3 scripts/validate.py --vanguard

Checks critical dependencies and prints PASS/FAIL/SKIP for each.
Continues even if earlier checks fail.
"""

from __future__ import annotations

import argparse
import os
import sys

# Must be run from forge/ so that rag.retriever imports work.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env if python-dotenv is available.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
except ImportError:
    pass

import json
from pathlib import Path

try:
    import httpx
    _HTTP_LIB = "httpx"
except ImportError:
    import requests  # type: ignore
    _HTTP_LIB = "requests"


def _get(url: str, headers: dict | None = None, timeout: int = 15):
    """GET request using httpx or requests, returns (status_code, body_text)."""
    if _HTTP_LIB == "httpx":
        r = httpx.get(url, headers=headers or {}, timeout=timeout)
        return r.status_code, r.text
    else:
        r = requests.get(url, headers=headers or {}, timeout=timeout)
        return r.status_code, r.text


def _post(url: str, headers: dict | None = None, json_body: dict | None = None, timeout: int = 30):
    """POST request using httpx or requests, returns (status_code, body_text)."""
    if _HTTP_LIB == "httpx":
        r = httpx.post(url, headers=headers or {}, json=json_body, timeout=timeout)
        return r.status_code, r.text
    else:
        r = requests.post(url, headers=headers or {}, json=json_body, timeout=timeout)
        return r.status_code, r.text


passed = 0
skipped = 0
total = 12


parser = argparse.ArgumentParser(description="Validate Forge demo dependencies.")
parser.add_argument(
    "--vanguard",
    action="store_true",
    help="Include Vanguard-specific Gemini attacker readiness details.",
)
args = parser.parse_args()


def check(n: int, label: str, ok: bool, detail: str = "") -> None:
    global passed
    status = "PASS" if ok else "FAIL"
    suffix = f"  ({detail})" if detail else ""
    print(f"[{status}] Check {n:02d}: {label}{suffix}")
    if ok:
        passed += 1


def skip(n: int, label: str, detail: str = "") -> None:
    global skipped
    suffix = f"  ({detail})" if detail else ""
    print(f"[SKIP] Check {n:02d}: {label}{suffix}")
    skipped += 1


# ---------------------------------------------------------------------------
# Check 1: Required env vars
# ---------------------------------------------------------------------------
REQUIRED_ENV_VARS = [
    "GEMINI_API_KEY",
    "NVIDIA_API_KEY",
    "NVIDIA_BASE_URL",
    "NVIDIA_BASE_MODEL",
    "NVIDIA_EMBEDDING_MODEL",
    "DAILY_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
]

# CEKURA_API_KEY / CEKURA_BASE_URL are optional — evaluator falls back to LLM.

try:
    missing = [v for v in REQUIRED_ENV_VARS if not os.getenv(v)]
    if missing:
        check(1, "Required env vars", False, f"missing: {', '.join(missing)}")
    else:
        check(1, "Required env vars", True, f"all {len(REQUIRED_ENV_VARS)} present")
except Exception as exc:
    check(1, "Required env vars", False, str(exc))


# ---------------------------------------------------------------------------
# Check 2: NVIDIA NIM LLM responds to a test completion
# ---------------------------------------------------------------------------
try:
    nvidia_base_url = os.getenv("NVIDIA_BASE_URL", "").rstrip("/")
    nvidia_api_key = os.getenv("NVIDIA_API_KEY", "")
    nvidia_model = os.getenv("NVIDIA_BASE_MODEL", "meta/llama-4-maverick-17b-128e-instruct")

    status, body = _post(
        f"{nvidia_base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {nvidia_api_key}",
            "Content-Type": "application/json",
        },
        json_body={
            "model": nvidia_model,
            "messages": [{"role": "user", "content": "Say OK in one word"}],
            "max_tokens": 10,
        },
    )
    if status == 200:
        data = json.loads(body)
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        check(2, "NVIDIA NIM LLM completion", True, f"reply: {reply!r}")
    else:
        check(2, "NVIDIA NIM LLM completion", False, f"HTTP {status}: {body[:200]}")
except Exception as exc:
    check(2, "NVIDIA NIM LLM completion", False, str(exc))


# ---------------------------------------------------------------------------
# Check 3: NVIDIA NIM embedding model returns a vector
# ---------------------------------------------------------------------------
try:
    nvidia_base_url = os.getenv("NVIDIA_BASE_URL", "").rstrip("/")
    nvidia_api_key = os.getenv("NVIDIA_API_KEY", "")
    embedding_model = os.getenv("NVIDIA_EMBEDDING_MODEL", "nvidia/llama-3.2-nv-embedqa-1b-v2")

    status, body = _post(
        f"{nvidia_base_url}/embeddings",
        headers={
            "Authorization": f"Bearer {nvidia_api_key}",
            "Content-Type": "application/json",
        },
        json_body={
            "model": embedding_model,
            "input": ["test embedding string"],
            "input_type": "passage",
        },
    )
    if status == 200:
        data = json.loads(body)
        embedding = data.get("data", [{}])[0].get("embedding", [])
        check(3, "NVIDIA NIM embedding model", True, f"vector dim: {len(embedding)}")
    else:
        check(3, "NVIDIA NIM embedding model", False, f"HTTP {status}: {body[:200]}")
except Exception as exc:
    check(3, "NVIDIA NIM embedding model", False, str(exc))


# ---------------------------------------------------------------------------
# Check 4: Gemini Live model configuration is current
# ---------------------------------------------------------------------------
try:
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
    ok = "live" in gemini_model.lower() and "flash" in gemini_model.lower()
    detail = f"model: {gemini_model}"
    if gemini_model == "gemini-3.1-flash-live":
        detail += "; expected preview model code is gemini-3.1-flash-live-preview"
        ok = False
    check(4, "Gemini Live model config", ok, detail)
except Exception as exc:
    check(4, "Gemini Live model config", False, str(exc))


# ---------------------------------------------------------------------------
# Check 5: Gemini voice configuration exists for persona and attacker
# ---------------------------------------------------------------------------
try:
    persona_voice = os.getenv("GEMINI_VOICE", "Puck")
    attacker_voice = os.getenv("ATTACKER_GEMINI_VOICE", "Charon")
    detail = f"persona={persona_voice}, attacker={attacker_voice}"
    if args.vanguard:
        detail += f", persona_agent_url={os.getenv('PERSONA_AGENT_URL', 'http://localhost:8000')}"
    if persona_voice == attacker_voice:
        detail += "; consider distinct voices for demo clarity"
    check(5, "Gemini voice config", bool(persona_voice and attacker_voice), detail)
except Exception as exc:
    check(5, "Gemini voice config", False, str(exc))


# ---------------------------------------------------------------------------
# Check 6: Daily API key is valid (list rooms)
# ---------------------------------------------------------------------------
try:
    daily_key = os.getenv("DAILY_API_KEY", "")
    status, body = _get(
        "https://api.daily.co/v1/rooms",
        headers={"Authorization": f"Bearer {daily_key}"},
    )
    if status == 200:
        check(6, "Daily API key", True)
    else:
        check(6, "Daily API key", False, f"HTTP {status}: {body[:200]}")
except Exception as exc:
    check(6, "Daily API key", False, str(exc))


# ---------------------------------------------------------------------------
# Check 7: RAG init_db() runs without error
# ---------------------------------------------------------------------------
try:
    from rag.retriever import init_db, build_knowledge_base, retrieve
    init_db()
    check(7, "RAG init_db()", True)
except Exception as exc:
    check(7, "RAG init_db()", False, str(exc))


# ---------------------------------------------------------------------------
# Check 8: RAG build_knowledge_base() ingests one sample text for user "demo"
# ---------------------------------------------------------------------------
try:
    # init_db may have already been called; import defensively
    try:
        _bkb = build_knowledge_base
    except NameError:
        from rag.retriever import build_knowledge_base as _bkb  # type: ignore
    sample_text = (
        "Forge is a voice AI system that validates persona agents before production. "
        "It uses NVIDIA NIM for scoring and Gemini Live for the persona voice pipeline."
    )
    inserted = _bkb("demo", [sample_text], "validate_script")
    check(8, "RAG build_knowledge_base()", True, f"inserted/upserted {inserted} chunk(s)")
except Exception as exc:
    check(8, "RAG build_knowledge_base()", False, str(exc))


# ---------------------------------------------------------------------------
# Check 9: RAG retrieve() returns results for user "demo"
# ---------------------------------------------------------------------------
try:
    try:
        _retrieve = retrieve
    except NameError:
        from rag.retriever import retrieve as _retrieve  # type: ignore
    results = _retrieve("demo", "What is Forge?", top_k=3)
    if results:
        check(9, "RAG retrieve()", True, f"{len(results)} chunk(s) returned")
    else:
        check(9, "RAG retrieve()", False, "empty result set")
except Exception as exc:
    check(9, "RAG retrieve()", False, str(exc))


# ---------------------------------------------------------------------------
# Check 10: GET /users/demo/dashboard returns 200 (server must be running)
# ---------------------------------------------------------------------------
try:
    status, body = _get("http://localhost:8000/users/demo/dashboard", timeout=10)
    if status == 200:
        check(10, "GET /users/demo/dashboard", True)
    else:
        check(10, "GET /users/demo/dashboard", False, f"HTTP {status}: {body[:200]}")
except Exception as exc:
    check(10, "GET /users/demo/dashboard", False, f"{exc}  (is the server running at localhost:8000?)")


# ---------------------------------------------------------------------------
# Check 11: POST /chat returns a response for user "demo" with message "Hello"
# ---------------------------------------------------------------------------
try:
    status, body = _post(
        "http://localhost:8000/chat",
        headers={"Content-Type": "application/json"},
        json_body={"user_id": "demo", "message": "Hello"},
        timeout=15,
    )
    if status == 200:
        check(11, "POST /chat", True, f"response: {body[:100]!r}")
    else:
        check(11, "POST /chat", False, f"HTTP {status}: {body[:200]}")
except Exception as exc:
    check(11, "POST /chat", False, f"{exc}  (is the server running at localhost:8000?)")


# ---------------------------------------------------------------------------
# Check 12: No fabricated improvement cycle files
# ---------------------------------------------------------------------------
check_num = 12
print(f"\n  [{check_num}] Verifying no fabricated improvement cycle data...", end=" ")
try:
    fake_dir = Path("./local_data/demo/improvement_cycles")
    fake_files = list(fake_dir.glob("*.json")) if fake_dir.exists() else []
    if fake_files:
        has_fake = False
        for f in fake_files:
            try:
                data = json.loads(f.read_text())
                if "pass_rate_before" in data and "finetune_job_id" in data and data.get("finetune_job_id", "").startswith("seed-demo"):
                    has_fake = True
                    break
            except Exception:
                pass
        if has_fake:
            print("FAIL")
            print(f"    ✗ Fake seeded data found in local_data/demo/improvement_cycles/")
            print(f"    → Run: Remove local_data/demo/improvement_cycles/ then run python3 scripts/seed_demo.py")
        else:
            print("PASS")
            passed += 1
    else:
        print("PASS (no cycle files — expected before first Vanguard run)")
        passed += 1
except Exception as e:
    print("FAIL")
    print(f"    ✗ Error: {e}")


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print()
print(f"{passed}/{total} checks passed, {skipped} skipped.")
