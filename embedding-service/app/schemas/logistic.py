from pydantic import BaseModel
from typing import Literal


class LogisticCandidate(BaseModel):
    candidateId: str
    # Original 4 features
    mutualFriends: int
    mutualGroups: int
    interestSimilarity: float
    distanceKm: float
    # Graph Features (6)
    jaccard: float
    cosineGraph: float
    adamicAdar: float
    prefAttach: float
    degreeU: int
    degreeV: int
    # Bio Embedding Features (3)
    bioCosine: float
    bioDot: float
    bioL2: float
    # Distance & Community Features (4)
    distanceBucket: int
    sameGroup: int
    groupInter: int
    groupJaccard: float


class TopKRequest(BaseModel):
    data: list[LogisticCandidate]
    k: int = 100


class EvaluateRequest(BaseModel):
    version: int
    model_name: Literal["logistic_regression", "random_forest", "xgboost"] = "xgboost"
