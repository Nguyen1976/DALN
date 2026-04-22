from fastapi import FastAPI

from app.routes.embedding_routes import router as embedding_router
from app.routes.logistic_routes import router as logistic_router


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(embedding_router)
    app.include_router(logistic_router)
    return app
