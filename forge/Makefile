dev:
	docker compose up

build:
	curl -X POST http://localhost:8000/users/demo/build

vanguard:
	curl -X POST http://localhost:8000/users/demo/vanguard/run

migrate:
	python -c "from rag.retriever import init_db; init_db()"

seed:
	python scripts/seed_demo.py

validate:
	python scripts/validate.py
