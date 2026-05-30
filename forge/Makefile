PYTHON ?= python3

dev:
	docker compose up

build:
	curl -X POST http://localhost:8000/users/demo/build

vanguard:
	curl -X POST http://localhost:8000/users/demo/vanguard/run

migrate:
	$(PYTHON) -c "from rag.retriever import init_db; init_db()"

seed:
	$(PYTHON) scripts/seed_demo.py

validate:
	$(PYTHON) scripts/validate.py
