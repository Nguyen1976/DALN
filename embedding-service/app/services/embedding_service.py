from importlib import import_module

from app.config import settings
from app.repositories.user_repository import UserRepository
from app.schemas.embedding import UserData
from app.services.qdrant_user_bios_sync import upsert_user_bio_vectors


class EmbeddingService:
    def __init__(self, repository: UserRepository) -> None:
        self.repository = repository
        self.device = None
        self.model = None

    def _torch(self):
        return import_module("torch")

    def _sentence_transformer(self):
        sentence_transformers = import_module("sentence_transformers")
        return sentence_transformers.SentenceTransformer

    def _get_model(self):
        if self.model is not None:
            return self.model

        torch = self._torch()
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"

        SentenceTransformer = self._sentence_transformer()
        self.model = SentenceTransformer(settings.embedding_model_name, device=self.device)
        if self.device == "mps":
            self.model.half()

        return self.model

    def embed_and_save(self, users: list[UserData]) -> dict:
        if not users:
            return {"status": "empty"}

        texts = [f"Tieu su: {u.bio}. Doi tuong: {u.age} tuoi." for u in users]

        torch = self._torch()
        model = self._get_model()

        with torch.no_grad():
            embeddings = model.encode(
                texts,
                batch_size=settings.embedding_batch_size,
                show_progress_bar=False,
                convert_to_numpy=True,
            )

        payload: list[tuple[str, list[float]]] = []
        embeddings_list = embeddings.tolist()
        for index, user in enumerate(users):
            payload.append((user.id, embeddings_list[index]))

        updated, matched = self.repository.bulk_update_profile_vectors(payload)
        q_upserted = upsert_user_bio_vectors(payload)
        return {
            "status": "ok",
            "updated": updated,
            "matched": matched,
            "qdrant_upserted": q_upserted,
        }
