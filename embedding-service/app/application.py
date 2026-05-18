from fastapi import FastAPI

from app.routes.embedding_routes import router as embedding_router
from app.routes.recommendation_routes import router as recommendation_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="DALN embedding-service",
        description="HTTP contract: POST /embed-and-save, POST /recommend/rank (GB). See CONTRACT.md",
    )
    app.include_router(embedding_router)
    app.include_router(recommendation_router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "contract": ["/embed-and-save", "/recommend/rank"]}

    return app
