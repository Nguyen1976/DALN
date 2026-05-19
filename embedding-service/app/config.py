import os
from typing import Optional


class Settings:
    """Centralized runtime settings for embedding-service."""

    mongo_uri: str = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    mongo_db_name: str = os.getenv("MONGO_DB_NAME", "user-service")
    mongo_collection_name: str = os.getenv("MONGO_COLLECTION_NAME", "User")
    embedding_model_name: str = os.getenv(
        "EMBEDDING_MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2"
    )
    embedding_batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "256"))
    log_file: str = os.getenv("EMBEDDING_LOG_FILE", "sync_process.log")
    # Qdrant (same collection name / vector size as Nest @app/qdrant)
    qdrant_enabled: bool = os.getenv("QDRANT_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    # Prefer 127.0.0.1 over "localhost" — some stacks resolve ::1 first while Qdrant listens on IPv4 only.
    qdrant_url: Optional[str] = (os.getenv("QDRANT_URL") or "").strip() or None
    qdrant_host: str = os.getenv("QDRANT_HOST", "127.0.0.1")
    qdrant_port: int = int(os.getenv("QDRANT_PORT", "6333"))
    qdrant_collection: str = os.getenv("QDRANT_COLLECTION", "user_bios")
    qdrant_vector_size: int = int(os.getenv("QDRANT_VECTOR_SIZE", "384"))


settings = Settings()
