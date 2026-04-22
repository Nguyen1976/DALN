import torch
from sentence_transformers import SentenceTransformer

from app.config import settings
from app.repositories.user_repository import UserRepository
from app.schemas.embedding import UserData


class EmbeddingService:
    def __init__(self, repository: UserRepository) -> None:
        self.repository = repository
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model = SentenceTransformer(settings.embedding_model_name, device=self.device)
        if self.device == "mps":
            self.model.half()

    def embed_and_save(self, users: list[UserData]) -> dict:
        if not users:
            return {"status": "empty"}

        texts = [f"Tieu su: {u.bio}. Doi tuong: {u.age} tuoi." for u in users]

        with torch.no_grad():
            embeddings = self.model.encode(
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
        return {"status": "ok", "updated": updated, "matched": matched}
