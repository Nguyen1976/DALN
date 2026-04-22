from fastapi import FastAPI

from app.routes.embedding_routes import router as embedding_router


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(embedding_router)
    return app
