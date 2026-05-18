from fastapi import APIRouter, Depends

from app.controllers.recommendation_controller import RecommendationController
from app.dependencies import get_recommendation_controller
from app.schemas.recommendation import RankRequest

router = APIRouter(tags=["recommendation"])


@router.post("/recommend/rank")
async def recommend_rank(
    payload: RankRequest,
    controller: RecommendationController = Depends(get_recommendation_controller),
):
    candidates = [candidate.model_dump() for candidate in payload.data]
    return await controller.rank_top_k(candidates, payload.k)
