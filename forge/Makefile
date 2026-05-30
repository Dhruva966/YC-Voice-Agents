PYTHON ?= .venv/bin/python

.PHONY: dev install run-backend run-frontend seed validate build vanguard improve migrate

# ─── Local Dev (no Docker) ──────────────────────────────────────────────────
install:
	python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

run-backend:
	.venv/bin/uvicorn api.main:app --reload --port 8000

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
