from fastapi import APIRouter, Depends

from app.dependencies import get_embedding_controller
from app.schemas.embedding import BioBatch

router = APIRouter(tags=["embedding"])


@router.post("/embed-and-save")
async def embed_and_save(
    data: BioBatch,
    controller=Depends(get_embedding_controller),
):
    return await controller.embed_and_save(data)
