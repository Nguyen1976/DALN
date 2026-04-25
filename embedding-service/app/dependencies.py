import logging
import os

from pymongo import MongoClient

from app.config import settings
from app.controllers.embedding_controller import EmbeddingController
from app.controllers.logistic_controller import LogisticController
from app.repositories.user_repository import UserRepository
from app.services.embedding_service import EmbeddingService
from app.services.logistic_service import LogisticService

os.environ["TOKENIZERS_PARALLELISM"] = "false"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(message)s",
    handlers=[logging.FileHandler(settings.log_file)],
)

logger = logging.getLogger("embedding-service")

mongo_client = MongoClient(settings.mongo_uri, directConnection=True)
db = mongo_client[settings.mongo_db_name]
collection = db[settings.mongo_collection_name]

user_repository = UserRepository(collection)
embedding_service = EmbeddingService(user_repository)
embedding_controller = EmbeddingController(embedding_service, logger)
logistic_service = LogisticService(db)
logistic_controller = LogisticController(logistic_service, logger)


def get_embedding_controller() -> EmbeddingController:
    return embedding_controller


def get_logistic_controller() -> LogisticController:
    return logistic_controller
