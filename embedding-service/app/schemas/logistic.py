from pydantic import BaseModel


class LogisticCandidate(BaseModel):
    candidateId: str
    mutualFriends: int
    mutualGroups: int
    interestSimilarity: float
    distanceKm: float


class TopKRequest(BaseModel):
    data: list[LogisticCandidate]
    k: int = 100
