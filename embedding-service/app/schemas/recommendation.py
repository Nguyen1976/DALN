from pydantic import BaseModel


class RankingCandidate(BaseModel):
    """Feature row for one candidate; must match Nest + GB `SAFE_FEATURES`."""

    candidateId: str
    jaccard: float
    cosine_graph: float
    adamic_adar: float
    pref_attach: float
    deg_u: float
    deg_v: float
    dist_km: float
    dist_bucket: float
    bio_cosine: float
    bio_dot: float
    bio_l2: float
    same_cluster: float = 0
    group_inter: float
    group_jaccard: float
    same_group: float


class RankRequest(BaseModel):
    """Body for POST /recommend/rank (Gradient Boosting ranker, `gb.joblib`)."""

    data: list[RankingCandidate]
    k: int = 100
