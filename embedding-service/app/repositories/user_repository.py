from bson import ObjectId
from pymongo.collection import Collection
from pymongo.operations import UpdateOne


class UserRepository:
    def __init__(self, collection: Collection) -> None:
        self.collection = collection

    def bulk_update_profile_vectors(
        self, payload: list[tuple[str, list[float]]]
    ) -> tuple[int, int]:
        operations: list[UpdateOne] = []

        for user_id, vector in payload:
            try:
                operations.append(
                    UpdateOne(
                        {"_id": ObjectId(user_id)},
                        {"$set": {"profile_vector": vector}},
                    )
                )
            except Exception:
                # Ignore invalid ObjectId while preserving bulk throughput.
                continue

        if not operations:
            return 0, 0

        result = self.collection.bulk_write(operations, ordered=False)
        return len(operations), result.matched_count
