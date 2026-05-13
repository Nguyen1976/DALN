"""Sync user bio vectors to Qdrant (same point IDs as NestJS uuid v5 from mongo ObjectId)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.config import settings

logger = logging.getLogger("embedding-service")

# Must match backend/libs/util/src/util.service.ts (uuid v5 namespace)
MONGO_ID_TO_UUID_NAMESPACE = uuid.UUID("1b671a64-40d5-491e-99b0-da01ff1f3341")


def mongo_id_to_qdrant_point_id(mongo_id: str) -> str:
    return str(uuid.uuid5(MONGO_ID_TO_UUID_NAMESPACE, mongo_id))


def _get_qdrant_client():
    from importlib import import_module

    qdrant_module = import_module("qdrant_client")
    QdrantClient = qdrant_module.QdrantClient
    return QdrantClient(
        host=settings.qdrant_host,
        port=settings.qdrant_port,
        prefer_grpc=False,
    )


def _ensure_collection(client: Any) -> None:
    from importlib import import_module

    models = import_module("qdrant_client.models")
    Distance = models.Distance
    VectorParams = models.VectorParams

    cols = client.get_collections().collections
    if any(c.name == settings.qdrant_collection for c in cols):
        return
    client.create_collection(
        collection_name=settings.qdrant_collection,
        vectors_config=VectorParams(
            size=settings.qdrant_vector_size, distance=Distance.COSINE
        ),
    )


def upsert_user_bio_vectors(rows: list[tuple[str, list[float]]]) -> int:
    """
    Upsert points: id = uuid v5(mongoId), payload includes mongoId for Nest filters.
    Returns number of points sent (best-effort; failures return 0).
    """
    if not rows or not settings.qdrant_enabled:
        return 0
    try:
        from importlib import import_module

        models = import_module("qdrant_client.models")
        PointStruct = models.PointStruct

        client = _get_qdrant_client()
        _ensure_collection(client)

        points = [
            PointStruct(
                id=mongo_id_to_qdrant_point_id(mongo_id),
                vector=vector,
                payload={"mongoId": mongo_id},
            )
            for mongo_id, vector in rows
            if mongo_id and vector
        ]
        if not points:
            return 0
        client.upsert(collection_name=settings.qdrant_collection, points=points, wait=True)
        return len(points)
    except Exception as exc:
        logger.warning("Qdrant upsert skipped/failed: %s", exc)
        return 0
