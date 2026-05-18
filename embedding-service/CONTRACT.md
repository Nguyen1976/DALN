# Embedding service — HTTP contract (runtime)

Service FastAPI (`main.py` → `app.application.create_app`). **Chỉ hai endpoint** này được backend Nest gọi trong luồng production.

| Method | Path | Caller (backend) | Body / response |
|--------|------|------------------|-----------------|
| `POST` | `/embed-and-save` | `apps/user/src/user.service.ts` (`notifyEmbeddingServiceBio`), `apps/recommendation/src/services/embedding-notify.service.ts`, `apps/recommendation/src/recommendation.service.ts` (`requestEmbedAndSave`) | `{ "users": [ { "id", "bio", "age" } ] }` → `{ "status": "ok"|"empty"|"error", "updated", "matched", "qdrant_upserted" }` |
| `POST` | `/top-k` | `apps/recommendation/src/python-recommendation.client.ts` (`PYTHON_TOPK_URL`, default `http://127.0.0.1:8000/top-k`) | `{ "data": [ RankingCandidate... ], "k": 100 }` → `{ "status": "ok"|"empty"|"error", "data": [...] }` |

**Model inference:** `train_model/models/gb.joblib` (tạo bởi `train_model/train_and_eval.py` hoặc `train_fast.py`). Feature keys phải khớp `SAFE_FEATURES` trong `app/services/logistic_service.py` và payload Nest.

**Training / offline (không phải HTTP contract):** thư mục `train_model/` — dataset, F1, AUC, xuất `gb.joblib`. Không import vào `app/` runtime ngoài đường dẫn file model.

**Env thường dùng:** `MONGO_URI`, `MONGO_DB_NAME`, `MONGO_COLLECTION_NAME`, `QDRANT_*`, `EMBEDDING_MODEL_NAME` (embed); model path cố định tương đối repo.

Kiểm tra nhanh backend vẫn trỏ đúng contract:

```bash
python embedding-service/scripts/check_backend_contract.py
```

(Chạy từ **root repo** `DALN/`, hoặc chỉnh `REPO_ROOT` trong script.)
