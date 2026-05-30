"""Drop-in S3 shim for local development.

When USE_LOCAL_STORAGE=true, all S3 operations are redirected to ./local_data/
on disk. When false, a real boto3 S3 client is returned instead.

Usage (replaces raw boto3 calls in every module):
    from storage import s3_client, bucket_name
"""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any

from botocore.exceptions import ClientError

_LOCAL_DATA_DIR = Path("./local_data")


def _is_local() -> bool:
    return os.getenv("USE_LOCAL_STORAGE", "true").lower() in {"true", "1", "yes"}


def _ensure_local_dir() -> None:
    _LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)


class _LocalS3Client:
    """Minimal S3-compatible client backed by the local filesystem."""

    def _path(self, key: str) -> Path:
        # Prevent path traversal. Check for any ".." path component first (handles
        # single-segment cases like "user/../other" that resolve() alone would allow
        # because the result still falls inside LOCAL_DATA_DIR).
        safe_key = key.lstrip("/")
        if ".." in Path(safe_key).parts:
            raise ValueError(f"Path traversal blocked: {key!r}")
        dest = (_LOCAL_DATA_DIR / safe_key).resolve()
        base = _LOCAL_DATA_DIR.resolve()
        try:
            dest.relative_to(base)
        except ValueError:
            raise ValueError(f"Path traversal blocked: {key!r}")
        return dest

    def put_object(self, Bucket: str, Key: str, Body: bytes | str, **kwargs: Any) -> dict[str, Any]:
        dest = self._path(Key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(Body, str):
            Body = Body.encode("utf-8")
        dest.write_bytes(Body)
        return {}

    def get_object(self, Bucket: str, Key: str, **kwargs: Any) -> dict[str, Any]:
        path = self._path(Key)
        if not path.exists():
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}},
                "GetObject",
            )
        data = path.read_bytes()
        return {"Body": io.BytesIO(data)}

    def head_object(self, Bucket: str, Key: str, **kwargs: Any) -> dict[str, Any]:
        path = self._path(Key)
        if not path.exists():
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}},
                "HeadObject",
            )
        return {"ContentLength": path.stat().st_size}

    def list_objects_v2(self, Bucket: str, Prefix: str = "", **kwargs: Any) -> dict[str, Any]:
        base = _LOCAL_DATA_DIR
        contents = []
        if base.exists():
            for p in base.rglob("*"):
                if p.is_file():
                    relative = p.relative_to(base).as_posix()
                    if relative.startswith(Prefix):
                        contents.append({"Key": relative, "Size": p.stat().st_size})
        return {"Contents": contents, "KeyCount": len(contents)}

    def delete_object(self, Bucket: str, Key: str, **kwargs: Any) -> dict[str, Any]:
        path = self._path(Key)
        if path.exists():
            path.unlink()
        return {}

    # upload_file / download_file are used in ingestion/pipeline.py and voice/clone.py
    def upload_file(self, Filename: str, Bucket: str, Key: str, **kwargs: Any) -> None:
        data = Path(Filename).read_bytes()
        self.put_object(Bucket=Bucket, Key=Key, Body=data)

    def download_file(self, Bucket: str, Key: str, Filename: str, **kwargs: Any) -> None:
        obj = self.get_object(Bucket=Bucket, Key=Key)
        Path(Filename).write_bytes(obj["Body"].read())

    def generate_presigned_url(self, operation: str, Params: dict[str, Any] | None = None, **kwargs: Any) -> str:
        """Return a file:// URL for local dev reference.

        NOTE: file:// URLs are only accessible on the local machine. NVIDIA's
        customization API cannot reach them. Fine-tune submission will fail in
        local mode unless NVIDIA_CUSTOMIZATION_BASE_URL is unset (which causes
        submit_finetune() to raise before ever calling this method).
        """
        if Params is None:
            Params = {}
        key = Params.get("Key", "")
        path = self._path(key).resolve()
        return path.as_uri()

    def get_paginator(self, operation_name: str):
        """Return a minimal paginator that yields a single page."""

        class _Paginator:
            def __init__(self_, client: "_LocalS3Client") -> None:
                self_._client = client

            def paginate(self_, **kwargs: Any):
                result = self_._client.list_objects_v2(**kwargs)
                yield result

        return _Paginator(self)


def s3_client():
    """Return an S3 client — local shim or real boto3 depending on USE_LOCAL_STORAGE."""
    if _is_local():
        _ensure_local_dir()
        return _LocalS3Client()
    import boto3
    return boto3.client(
        "s3",
        region_name=os.getenv("AWS_REGION"),
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )


def bucket_name() -> str:
    """Return the S3 bucket name.

    In local mode, auto-sets 'forge-local' if AWS_S3_BUCKET is not provided.
    In AWS mode, requires AWS_S3_BUCKET to be set.
    """
    if _is_local():
        bucket = os.getenv("AWS_S3_BUCKET")
        if not bucket:
            os.environ["AWS_S3_BUCKET"] = "forge-local"
            return "forge-local"
        return bucket
    bucket = os.getenv("AWS_S3_BUCKET")
    if not bucket:
        raise RuntimeError("AWS_S3_BUCKET is required")
    return bucket
