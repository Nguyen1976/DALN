import logging

from app.schemas.embedding import BioBatch
from app.services.embedding_service import EmbeddingService


class EmbeddingController:
    def __init__(self, service: EmbeddingService, logger: logging.Logger) -> None:
        self.service = service
        self.logger = logger

    async def embed_and_save(self, data: BioBatch) -> dict:
        try:
            result = self.service.embed_and_save(data.users)
            if result.get("status") == "ok":
                self.logger.info(
                    "Done: %s | Match: %s",
                    result.get("updated", 0),
                    result.get("matched", 0),
                )
            return result
        except Exception as exc:
            self.logger.error("Error: %s", str(exc))
            return {"status": "error"}
