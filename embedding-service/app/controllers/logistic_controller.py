import logging

from app.services.logistic_service import LogisticService


class LogisticController:
    def __init__(self, service: LogisticService, logger: logging.Logger) -> None:
        self.service = service
        self.logger = logger

    async def evaluate_model(self, version: int) -> dict:
        try:
            return self.service.evaluate_model(version)
        except Exception as exc:
            self.logger.error("Error: %s", str(exc))
            return {"status": "error", "message": str(exc)}

    async def retrain_model(self) -> dict:
        try:
            return self.service.retrain_model()
        except Exception as exc:
            self.logger.error("Error: %s", str(exc))
            return {"status": "error", "message": str(exc)}

    async def predict_top_k(self, data: list, k: int = 100) -> dict:
        try:
            print(data, k)
            result = self.service.predict_top_k(data, k)
            print("Predicted top-k candidates:", result)
            return result
        except Exception as exc:
            self.logger.error("Error: %s", str(exc))
            return {"status": "error"}
