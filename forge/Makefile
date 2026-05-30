PYTHON ?= python3
VENV_PYTHON ?= .venv/bin/python

.PHONY: dev install run-backend run-frontend seed validate validate-vanguard migrate build build-status vanguard vanguard-status improve dashboard status check-env test-nim test-embed nim-status demo

# ─── Local Dev (no Docker) ──────────────────────────────────────────────────
install:
	python3 -m venv .venv && $(VENV_PYTHON) -m pip install -r requirements.txt

run-backend:
	$(VENV_PYTHON) -m uvicorn api.main:app --reload --port 8000

run-frontend:
	cd frontend && npm install && npm run dev

seed:
	$(PYTHON) scripts/seed_demo.py

validate:
	$(PYTHON) scripts/validate.py

validate-vanguard:
	$(PYTHON) scripts/validate.py --vanguard

migrate:
	$(PYTHON) -c "from dotenv import load_dotenv; load_dotenv(); from rag.retriever import init_db; init_db()"

# ─── Docker Compose ─────────────────────────────────────────────────────────
dev:
	docker compose up

# ─── API Shortcuts (requires backend running on :8000) ──────────────────────
build:
	curl -s -X POST http://localhost:8000/users/demo/build | python3 -m json.tool

build-status:
	curl -s http://localhost:8000/users/demo/build/status | python3 -m json.tool

vanguard:
	curl -s -X POST http://localhost:8000/users/demo/vanguard/run | python3 -m json.tool

vanguard-status:
	curl -s http://localhost:8000/users/demo/vanguard/runs | python3 -m json.tool

improve:
	curl -s -X POST http://localhost:8000/users/demo/vanguard/improve | python3 -m json.tool

dashboard:
	curl -s http://localhost:8000/users/demo/dashboard | python3 -m json.tool

status:
	curl -s http://localhost:8000/users/demo/status | python3 -m json.tool

# ─── Integration & Demo ─────────────────────────────────────────────────────
check-env:
	@python3 -c " \
import os; from dotenv import load_dotenv; load_dotenv(); \
required = ['GEMINI_API_KEY','NVIDIA_API_KEY','NVIDIA_BASE_URL','NVIDIA_BASE_MODEL','DAILY_API_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER']; \
missing = [k for k in required if not os.getenv(k)]; \
[print(f'  MISSING: {k}') for k in missing]; \
[print(f'  OK: {k}') for k in required if k not in missing]; \
print('All required vars set!' if not missing else f'{len(missing)} missing.') \
"

test-nim:
	@python3 -c " \
from dotenv import load_dotenv; load_dotenv(); \
from ingestion.transcript_scorer import _nim_client, _nim_model; \
c = _nim_client(); r = c.chat.completions.create(model=_nim_model(), messages=[{'role':'user','content':'Say OK'}]); \
print('NIM OK:', r.choices[0].message.content[:60]) \
"

test-embed:
	@python3 -c " \
from dotenv import load_dotenv; load_dotenv(); \
from rag.retriever import _embed; \
vec = _embed(['test sentence']); \
print('Embedding dim:', len(vec[0])) \
"

nim-status:
	curl -s http://localhost:8000/health/nim | python3 -m json.tool

demo:
	@echo "Starting demo stack..."
	@$(VENV_PYTHON) -m uvicorn api.main:app --host 0.0.0.0 --port 8000 &
	@sleep 2 && $(VENV_PYTHON) scripts/seed_demo.py
	@echo "Backend running on :8000 — start frontend: cd frontend && npm run dev"
