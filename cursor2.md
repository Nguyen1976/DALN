# DALN — Context phiên làm việc (cursor2.md)

Tài liệu **mục tiêu + những việc đã làm** trong các chỉnh sửa gần đây (recommendation, embedding-service, Qdrant, cold start, kết bạn). Cập nhật khi có thay đổi lớn tiếp theo.

---

## Mục tiêu đã hướng tới

1. **Cold start** khi user mới / chưa có danh sách RCM: dùng **heuristic** (bio vector, geo, interest), **không phụ thuộc** model GB cho bước GET tức thời; có thể **lưu cache** vào Mongo sau khi tính.
2. **Bio → vector**: khi tạo/cập nhật bio phải đồng bộ **Mongo `profile_vector`** và **Qdrant** (`user_bios`) để tìm người tương tự bio.
3. **Replica `UserSnapshot`**: đảm bảo khi load RCM vẫn có dữ liệu — **hydrate từ DB user-service** nếu RMQ/snapshot thiếu; **RMQ `USER_UPDATED` có `bio`**, `syncUserUpdated` **upsert** snapshot.
4. **Sau khi kết bạn (Accept)**: **gỡ** user khỏi `RecommendationResult` đã lưu; GET còn **lọc theo Neo4j** bạn bè.
5. **Làm sạch Python runtime**: chỉ giữ **hợp đồng HTTP** với Nest + giữ **`train_model/`** (train dataset → F1/AUC → `gb.joblib`); xóa script thử nghiệm không thuộc contract.
6. **Đổi tên luồng ranking**: bỏ tên “logistic” cũ → **`/recommend/rank`** (Gradient Boosting), env **`PYTHON_RECOMMEND_URL`**, fallback `PYTHON_TOPK_URL`.

---

## Đã làm (tóm tắt theo khu vực)

### Backend — `apps/recommendation`

- **`getRecommendationForUser`**: nếu không có / rỗng `RecommendationResult` → chạy **cold start heuristic** (không còn bắt buộc “0 bạn bè”); có **lưu** kết quả heuristic vào `RecommendationResult` khi thành công.
- **`UserSnapshotHydrateService`**: đọc Mongo **user-service** → upsert **`UserSnapshot`** cho user hiện tại + peer khi replica quá ít.
- **`getLiveHeuristicColdStartRecommendations`**: pool **3** Qdrant (similar bio) + **3** `$geoNear` + **3** interest overlap; **exclude bạn bè**; fallback user khác; filter sau khi enrich.
- **`RecommendationFriendshipService`** + **`FriendshipRecommendationSubscriber`**: queue RMQ `USER_UPDATE_STATUS_MAKE_FRIEND` + `ACCEPTED` → xóa candidate khỏi `RecommendationResult` **hai chiều**.
- **`getRecommendationForUser`**: đầu request gọi **`stripFriendsFromStoredRecommendations`** + lọc response theo Neo4j friends.
- **`UserSnapshotSyncService.syncUserUpdated`**: **`upsert`** thay vì `update` khi thiếu snapshot; sau update bio gọi **`EmbeddingNotifyService`**.
- **`PythonRecommendationClient`**: URL **`PYTHON_RECOMMEND_URL`** mặc định `http://127.0.0.1:8000/recommend/rank`, fallback **`PYTHON_TOPK_URL`**.
- **`recommendation.service.ts` / `embedding-notify.service.ts`**: origin embed ưu tiên **`PYTHON_RECOMMEND_URL`** rồi `PYTHON_TOPK_URL`.
- **`recommendation.module.ts`**: providers/subscriber mới; dependency **`mongodb`** (package root backend) cho hydrate.

### Backend — `apps/user`

- **`publishUserUpdated`**: thêm **`bio`** trong payload RMQ.
- **`notifyEmbeddingServiceBio`**: **await** `POST …/embed-and-save`, log `qdrant_upserted`; base URL cùng logic với recommendation.

### Backend — `libs/constant`

- **`UserUpdatedPayload`**: thêm field **`bio?`**.
- **`QUEUE_RMQ`**: thêm **`RECOMMENDATION_USER_UPDATE_STATUS_MAKE_FRIEND`**.

### Backend — `libs/qdrant`

- **`QdrantService`**: thêm **`searchSimilarByVector`**; **`upsertVector`** dùng id đúng (uuid v5); comment rõ contract id/payload.
- **Đọc Qdrant** trong `recommendationHelper`: `recommendSimilar`, `getVectorsBatch`, map score cold prior; cold GET dùng `searchSimilarByVector`.

### Backend — `libs/constant` + docs

- **`README.RCM.md`**, **`README.md`**: link contract Python, env mới, mục “kết bạn → xóa RCM”.

### Embedding-service — Python

- **`/embed-and-save`**: sau embed Mongo gọi **`upsert_user_bio_vectors`** → Qdrant collection **`user_bios`**, point id = uuid v5(mongoId), payload `mongoId`.
- **`app/config.py`**: biến **`QDRANT_*`**, `QDRANT_ENABLED`.
- **Xóa** các file root không thuộc contract: `evaluate_model.py`, `bootstrap.py`, `check_model.py`, `handle_data_for_model.py`, `import_data_to_neo4j.py` và CSV rác ở root (brightkite, neo4j_*, dataset lớn tại root, v.v.).
- **Đổi tên module**: `logistic_*` → **`recommendation_*`**: `RecommendationRankService`, `RecommendationController`, **`POST /recommend/rank`**, schema **`RankRequest`** / `RankingCandidate`.
- **`CONTRACT.md`**, **`README.md`**, **`scripts/check_backend_contract.py`**: mô tả + kiểm tra Nest vẫn tham chiếu `embed-and-save`, `PYTHON_RECOMMEND_URL`, `/recommend/rank`.
- **`requirements.txt`**: thêm numpy/pandas/scikit-learn/joblib cho ranker; comment GB.
- **`train_model/`**: **giữ nguyên** pipeline train (F1, AUC, `gb.joblib`); README trỏ tới `CONTRACT.md`.

### Repo root

- **`cursor1.md`**: cập nhật một số dòng (luồng ranking URL, path `recommendation_rank_service`).

---

## Qdrant — đang dùng ở đâu (tóm tắt)

| Hướng | Nơi | Việc làm |
|--------|-----|----------|
| **Ghi** | `embedding-service` `qdrant_user_bios_sync` sau `/embed-and-save` | Upsert vector bio, payload `{ mongoId }` |
| **Đọc** | Nest `QdrantService` + `RecommendationService` | `recommendSimilar` (ứng viên từ vector user), `getVectorsBatch` (bio_cosine/…), `searchSimilarByVector` (cold GET) |
| **Collection** | `user_bios` | Vector size **384**, distance **Cosine**, point id = **uuid v5** của Mongo user id |

Nest **`upsertVector`** hiện **không** được chỗ khác gọi — ghi Qdrant chính qua **Python** sau embed.

---

## Việc có thể làm tiếp (chưa làm / gợi ý)

- Cho `QdrantService` đọc **host/port** từ env thay vì hardcode `localhost:6333`.
- Trigger **`recommendationHelper`** sau event (bio/bạn mới) thay vì chỉ cron đêm.
- FE: sau Accept friend, **invalidate** / refetch recommendations (hiện dựa vào RMQ + reload).

---

## File tham chiếu nhanh

| Chủ đề | Đường dẫn |
|--------|-----------|
| Cold GET + hydrate + heuristic | `backend/apps/recommendation/src/recommendation.service.ts` |
| Friendship → xóa RCM | `backend/apps/recommendation/src/services/recommendation-friendship.service.ts`, `rmq/subscribers/friendship-recommendation.subscriber.ts` |
| Hydrate snapshot | `backend/apps/recommendation/src/services/user-snapshot-hydrate.service.ts` |
| Qdrant lib | `backend/libs/qdrant/src/qdrant.service.ts` |
| Python embed + Qdrant upsert | `embedding-service/app/services/embedding_service.py`, `qdrant_user_bios_sync.py` |
| Python GB rank HTTP | `embedding-service/app/routes/recommendation_routes.py`, `services/recommendation_rank_service.py` |
| Hợp đồng API | `embedding-service/CONTRACT.md` |
| Train / metrics | `embedding-service/train_model/train_and_eval.py`, `README.md` |
