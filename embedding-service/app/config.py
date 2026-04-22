import os


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


settings = Settings()
