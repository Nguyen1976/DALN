from fastapi import FastAPI

from app.routes.embedding_routes import router as embedding_router
from app.routes.logistic_routes import router as logistic_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="DALN embedding-service",
        description="HTTP contract: POST /embed-and-save, POST /top-k. See CONTRACT.md",
    )
    app.include_router(embedding_router)
    app.include_router(logistic_router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "contract": ["/embed-and-save", "/top-k"]}

    return app
