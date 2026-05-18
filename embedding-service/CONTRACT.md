# Embedding service — HTTP contract (runtime)

Service FastAPI (`main.py` → `app.application.create_app`). **Chỉ hai endpoint** này được backend Nest gọi trong luồng production.

| Method | Path | Caller (backend) | Body / response |
|--------|------|------------------|-----------------|
| `POST` | `/embed-and-save` | `apps/user/src/user.service.ts`, `apps/recommendation/src/services/embedding-notify.service.ts`, `apps/recommendation/src/recommendation.service.ts` | `{ "users": [ { "id", "bio", "age" } ] }` → `{ "status": "ok"|"empty"|"error", "updated", "matched", "qdrant_upserted" }` |
| `POST` | `/recommend/rank` | `apps/recommendation/src/python-recommendation.client.ts` — env **`PYTHON_RECOMMEND_URL`** (mặc định `http://127.0.0.1:8000/recommend/rank`), fallback **`PYTHON_TOPK_URL`** nếu bạn vẫn set full URL cũ | `{ "data": [ RankingCandidate... ], "k": 100 }` → `{ "status": "ok"|"empty"|"error", "data": [...] }` |

**Model inference:** Gradient Boosting — `train_model/models/gb.joblib` (train trong `train_model/train_and_eval.py` / `train_fast.py`). Feature keys khớp `SAFE_FEATURES` trong `app/services/recommendation_rank_service.py` và payload Nest.

**Training / offline:** thư mục `train_model/` — không import vào `app/` runtime ngoài đường dẫn file model.

**Env:** `MONGO_*`, `QDRANT_*`, `EMBEDDING_MODEL_NAME` (embed); `PYTHON_RECOMMEND_URL` hoặc `PYTHON_TOPK_URL` (rank).

Kiểm tra Nest vẫn trỏ đúng contract:

```bash
python embedding-service/scripts/check_backend_contract.py
```

(Chạy từ **root repo** `DALN/`.)
