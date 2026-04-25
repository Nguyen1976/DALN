from fastapi import APIRouter, Depends

from app.controllers.logistic_controller import LogisticController
from app.dependencies import get_logistic_controller
from app.schemas.logistic import EvaluateRequest, TopKRequest

router = APIRouter(tags=["logistic"])


@router.post("/top-k")
async def predict_top_k(
    payload: TopKRequest,
    controller: LogisticController = Depends(get_logistic_controller),
):
    candidates = [candidate.model_dump() for candidate in payload.data]
    return await controller.predict_top_k(candidates, payload.k)


@router.post("/retrain")
async def retrain_model(
    controller: LogisticController = Depends(get_logistic_controller),
):
    return await controller.retrain_model()


@router.post("/evaluate")
async def evaluate_model(
    payload: EvaluateRequest,
    controller: LogisticController = Depends(get_logistic_controller),
):
    return await controller.evaluate_model(payload.version)
