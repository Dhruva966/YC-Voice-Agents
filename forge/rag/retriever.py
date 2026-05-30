"""RAG retriever — ChromaDB (local) or pgvector (AWS RDS) selected by USE_LOCAL_RAG."""

from __future__ import annotations

import hashlib
import os
import threading
from typing import Iterable

from langchain_text_splitters import RecursiveCharacterTextSplitter
from openai import OpenAI

_USE_LOCAL = os.getenv("USE_LOCAL_RAG", "true").lower() == "true"
_LOCAL_CHROMA_DIR = os.getenv("LOCAL_CHROMA_DIR", "./local_data/chroma")

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _client() -> OpenAI:
    return OpenAI(api_key=os.getenv("NVIDIA_API_KEY"), base_url=os.getenv("NVIDIA_BASE_URL"))


def _embed(texts: list[str], input_type: str = "passage") -> list[list[float]]:
    model = os.getenv("NVIDIA_EMBEDDING_MODEL", "nvidia/llama-3.2-nv-embedqa-1b-v2")
    response = _client().embeddings.create(
        model=model,
        input=texts,
        extra_body={"input_type": input_type},
    )
    return [item.embedding for item in response.data]


def _chunks(texts: Iterable[str]) -> list[str]:
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    result: list[str] = []
    for text in texts:
        result.extend(chunk.strip() for chunk in splitter.split_text(text) if chunk.strip())
    return result


# ---------------------------------------------------------------------------
# ChromaDB backend
# ---------------------------------------------------------------------------

_chroma_lock = threading.Lock()
_chroma_client = None


def _get_chroma():
    global _chroma_client
    with _chroma_lock:
        if _chroma_client is None:
            import chromadb
            os.makedirs(_LOCAL_CHROMA_DIR, exist_ok=True)
            _chroma_client = chromadb.PersistentClient(path=_LOCAL_CHROMA_DIR)
    return _chroma_client


def _chroma_collection(user_id: str):
    return _get_chroma().get_or_create_collection(
        name=f"user_{user_id}",
        metadata={"hnsw:space": "cosine"},
    )


def _chroma_init_db() -> None:
    _get_chroma()  # ensures directory + client initialized


def _chroma_build(user_id: str, texts: list[str], source_label: str) -> int:
    chunks = _chunks(texts)
    if not chunks:
        return 0
    collection = _chroma_collection(user_id)
    inserted = 0
    for start in range(0, len(chunks), 32):
        batch = chunks[start : start + 32]
        embeddings = _embed(batch, input_type="passage")
        ids = [hashlib.sha256(f"{user_id}:{c}".encode()).hexdigest() for c in batch]
        metadatas = [{"source": source_label}] * len(batch)
        existing = set(collection.get(ids=ids)["ids"])
        new_ids, new_docs, new_embs, new_meta = [], [], [], []
        for id_, doc, emb, meta in zip(ids, batch, embeddings, metadatas):
            if id_ not in existing:
                new_ids.append(id_)
                new_docs.append(doc)
                new_embs.append(emb)
                new_meta.append(meta)
        if new_ids:
            collection.add(ids=new_ids, documents=new_docs, embeddings=new_embs, metadatas=new_meta)
            inserted += len(new_ids)
    return inserted


def _chroma_retrieve(user_id: str, query: str, top_k: int = 5) -> list[str]:
    collection = _chroma_collection(user_id)
    if collection.count() == 0:
        return []
    embedding = _embed([query], input_type="query")[0]
    results = collection.query(query_embeddings=[embedding], n_results=min(top_k, collection.count()))
    return results["documents"][0] if results["documents"] else []


# ---------------------------------------------------------------------------
# pgvector backend
# ---------------------------------------------------------------------------

from contextlib import contextmanager  # noqa: E402

_pool = None
_pool_lock = threading.Lock()


def _get_pool():
    global _pool
    with _pool_lock:
        if _pool is None:
            import psycopg2
            from psycopg2.pool import ThreadedConnectionPool
            _pool = ThreadedConnectionPool(
                minconn=2,
                maxconn=20,
                host=os.getenv("AWS_RDS_HOST"),
                port=os.getenv("AWS_RDS_PORT", "5432"),
                dbname=os.getenv("AWS_RDS_DB"),
                user=os.getenv("AWS_RDS_USER"),
                password=os.getenv("AWS_RDS_PASSWORD"),
            )
    return _pool


@contextmanager
def _get_conn():
    from pgvector.psycopg2 import register_vector
    pool = _get_pool()
    conn = pool.getconn()
    register_vector(conn)
    try:
        yield conn
    finally:
        pool.putconn(conn)


def _pgvector_init_db() -> None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS knowledge_chunks (
                    id BIGSERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    chunk_hash TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding vector(1024) NOT NULL,
                    source_file TEXT,
                    created_at TIMESTAMPTZ DEFAULT now(),
                    UNIQUE(user_id, chunk_hash)
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
                ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 200)
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS knowledge_chunks_user_id_idx ON knowledge_chunks(user_id)"
            )


def _pgvector_build(user_id: str, texts: list[str], source_label: str) -> int:
    chunks = _chunks(texts)
    if not chunks:
        return 0
    inserted = 0
    with _get_conn() as conn:
        with conn.cursor() as cur:
            for start in range(0, len(chunks), 32):
                batch = chunks[start : start + 32]
                embeddings = _embed(batch, input_type="passage")
                for content, embedding in zip(batch, embeddings):
                    chunk_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    cur.execute(
                        """
                        INSERT INTO knowledge_chunks
                        (user_id, chunk_hash, content, embedding, source_file)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (user_id, chunk_hash) DO NOTHING
                        """,
                        (user_id, chunk_hash, content, embedding, source_label),
                    )
                    inserted += cur.rowcount
    return inserted


def _pgvector_retrieve(user_id: str, query: str, top_k: int = 5) -> list[str]:
    embedding = _embed([query], input_type="query")[0]
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT content
                FROM knowledge_chunks
                WHERE user_id = %s
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (user_id, embedding, top_k),
            )
            return [row[0] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Public API — routed by USE_LOCAL_RAG
# ---------------------------------------------------------------------------

def init_db() -> None:
    if _USE_LOCAL:
        _chroma_init_db()
    else:
        _pgvector_init_db()


def build_knowledge_base(user_id: str, texts: list[str], source_label: str) -> int:
    if _USE_LOCAL:
        return _chroma_build(user_id, texts, source_label)
    return _pgvector_build(user_id, texts, source_label)


def retrieve(user_id: str, query: str, top_k: int = 5) -> list[str]:
    if _USE_LOCAL:
        return _chroma_retrieve(user_id, query, top_k)
    return _pgvector_retrieve(user_id, query, top_k)
