"""Sync user bio vectors to Qdrant (same point IDs as NestJS uuid v5 from mongo ObjectId)."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.config import settings

logger = logging.getLogger("embedding-service")

# Must match backend/libs/util/src/util.service.ts (uuid v5 namespace)
MONGO_ID_TO_UUID_NAMESPACE = uuid.UUID("1b671a64-40d5-491e-99b0-da01ff1f3341")


def mongo_id_to_qdrant_point_id(mongo_id: str) -> str:
    return str(uuid.uuid5(MONGO_ID_TO_UUID_NAMESPACE, mongo_id))


def _qdrant_base_url() -> str:
    if settings.qdrant_url:
        return settings.qdrant_url.rstrip("/")
    return f"http://{settings.qdrant_host}:{settings.qdrant_port}"


def _qdrant_request(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    url = f"{_qdrant_base_url()}{path}"
    headers = {"Content-Type": "application/json"}
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=10) as response:
        raw = response.read()
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))


def _ensure_collection() -> None:
    try:
        _qdrant_request("GET", f"/collections/{settings.qdrant_collection}")
        return
    except HTTPError as exc:
        if exc.code != 404:
            raise
    except URLError:
        raise

    _qdrant_request(
        "PUT",
        f"/collections/{settings.qdrant_collection}",
        {
            "vectors": {
                "size": settings.qdrant_vector_size,
                "distance": "Cosine",
            }
        },
    )


def upsert_user_bio_vectors(rows: list[tuple[str, list[float]]]) -> int:
    """
    Upsert points: id = uuid v5(mongoId), payload includes mongoId for Nest filters.
    Returns number of points sent (best-effort; failures return 0).
    """
    if not rows or not settings.qdrant_enabled:
        return 0

    points = [
        {
            "id": mongo_id_to_qdrant_point_id(mongo_id),
            "vector": vector,
            "payload": {"mongoId": mongo_id},
        }
        for mongo_id, vector in rows
        if mongo_id and vector
    ]
    if not points:
        return 0

    try:
        _ensure_collection()
        _qdrant_request(
            "PUT",
            f"/collections/{settings.qdrant_collection}/points?wait=true",
            {"points": points},
        )
        return len(points)
    except Exception as exc:
        logger.exception("Qdrant upsert failed")
        if settings.qdrant_enabled:
            raise RuntimeError(f"Qdrant upsert failed: {exc}") from exc
        return 0
