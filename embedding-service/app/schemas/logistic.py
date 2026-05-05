from pydantic import BaseModel
from typing import Literal


class LogisticCandidate(BaseModel):
    candidateId: str
    mutualFriends: int
    mutualGroups: int
    interestSimilarity: float
    distanceKm: float


class TopKRequest(BaseModel):
    data: list[LogisticCandidate]
    k: int = 100


class EvaluateRequest(BaseModel):
    version: int
    model_name: Literal["logistic_regression", "random_forest", "xgboost"] = "xgboost"
