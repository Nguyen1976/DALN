import logging

from app.services.recommendation_rank_service import RecommendationRankService


class RecommendationController:
    def __init__(self, service: RecommendationRankService, logger: logging.Logger) -> None:
        self.service = service
        self.logger = logger

    async def rank_top_k(self, data: list, k: int = 100) -> dict:
        try:
            return self.service.rank_top_k(data, k)
        except Exception as exc:
            self.logger.error("recommend/rank error: %s", str(exc))
            return {"status": "error", "message": str(exc)}
