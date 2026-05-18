# Recommendation (RCM) — Trạng thái triển khai & vận hành

Tài liệu này mô tả **code và dữ liệu thực tế** của bài toán gợi ý bạn bè (RCM) trong monorepo `backend/`.  
Thiết kế dài hạn / mục tiêu kiến trúc: [`README.RECOMMENDATION.md`](./README.RECOMMENDATION.md) (có thể chưa khớp 100% code).

---

## 1. Tóm tắt nhanh (đã giải quyết trong code chưa?)

| Thành phần | Trong code | Lưu trữ (persist) | Ghi chú kiểm tra môi trường local (máy dev) |
|------------|------------|-------------------|---------------------------------------------|
| **RCM theo model Python (GB)** | Có — `recommendationHelper` → `POST /recommend/rank` | Có — Mongo `recommendation-service.RecommendationResult` | **Chưa có bản ghi** nếu chưa chạy batch/cron hoặc `UserSnapshot` rỗng |
| **Cold start khi GET** (heuristic, không model) | Có — `getLiveHeuristicColdStartRecommendations` | **Không** lưu DB; trả live `source: live_heuristic` | Cần `UserSnapshot` + location/interests/bio; Qdrant bio cần có point |
| **Cold blend trong batch** | Có — blend `cold_prior` khi graph thưa | Nằm trong `RecommendationResult` sau cron | `α` model thấp hơn khi `isColdStartUser` |
| **Bio → vector Mongo + Qdrant** | Có — `embedding-service` `/embed-and-save` | `user-service.User.profile_vector` + Qdrant `user_bios` | Qdrant **0 point** = chưa embed/upsert thành công |
| **Replica user → recommendation** | Có — RMQ `USER_CREATED` / `USER_UPDATED` / `USER_INTERESTS_UPDATED` | `UserSnapshot` | **0 snapshot** = Rabbit/event hoặc user tạo trước khi bật subscriber |

**Kết luận:** Bài toán **đã được implement** (model path + cold start path + lưu kết quả batch). Trên DB local hiện tại **chưa có dữ liệu chạy thật** (`UserSnapshot: 0`, `RecommendationResult: 0`, Qdrant `user_bios`: 0 points) — cần sync snapshot, embed bio, rồi chạy ranking một lần (cron hoặc gọi helper).

---

## 2. Kiến trúc luồng dữ liệu

```mermaid
flowchart LR
  subgraph user_svc [user-service :3002]
    U[(User Mongo)]
  end
  subgraph rmq [RabbitMQ]
    E[USER_* events]
  end
  subgraph rcm_svc [recommendation :3005]
    S[UserSnapshot]
    R[RecommendationResult]
    H[recommendationHelper]
  end
  subgraph py [embedding-service :8000]
    EM[embed-and-save]
    TK[/recommend/rank gb.joblib]
  end
  subgraph stores [Stores]
    N4j[(Neo4j graph)]
    Qd[(Qdrant user_bios)]
  end
  U --> E --> S
  U --> EM --> U
  EM --> Qd
  S --> H
  N4j --> H
  Qd --> H
  H --> TK --> H
  H --> R
```

**Cổng mặc định (host):** user `3002`, chat `3003`, notification `3004`, recommendation `3005`, Kong `8080`, embedding `8000`, Qdrant `6333`.

---

## 3. Hai đường gợi ý (đừng nhầm)

### 3.1. Đường model Python (batch / cron) — có lưu DB

1. `RecommendationCron` — mỗi ngày 00:00 (`CronExpression.EVERY_DAY_AT_MIDNIGHT`) gọi `recommendation()`.
2. Lấy mọi `userId` từ **`UserSnapshot`**, chunk 50, gọi `recommendationHelper(userId)` song song.
3. Helper thu thập ứng viên: Neo4j (bạn chung / nhóm), Qdrant `recommend`, Mongo `$geoNear`, cold mở rộng (interest + geo).
4. Tính 15 feature (`SAFE_FEATURES` trong Python), gọi **`PYTHON_RECOMMEND_URL`** (mặc định `http://127.0.0.1:8000/recommend/rank`; vẫn đọc được **`PYTHON_TOPK_URL`** nếu set full URL cũ).
5. Blend với `cold_prior` nếu cold start; fallback xếp theo cold prior nếu Python trả rỗng.
6. **`prisma.recommendationResult.upsert`** — lưu `candidates` (top ~100), `features` (audit), `dayVersion`, `expiresAt` (+24h).

**API đọc kết quả:** `GET /recommendation` hoặc `GET /recommendation/me` (auth) → `getRecommendationForUser` đọc `RecommendationResult` + enrich `profile` từ `UserSnapshot`.

### 3.2. Cold start khi GET (heuristic, không gọi model) — có cache vào Mongo

Điều kiện (trong `getRecommendationForUser`):

- Không có `RecommendationResult` **hoặc** `candidates` rỗng / không enrich được profile.

Khi load trang gợi ý (`GET /recommendation/me`), service tự:

1. **Hydrate** `UserSnapshot` từ DB `user-service` nếu replica thiếu (`UserSnapshotHydrateService`).
2. Chạy heuristic 3 bio (Qdrant) + 3 geo + 3 interest, fallback user khác trong hệ thống.
3. **Upsert** kết quả vào `RecommendationResult` (lần sau GET đọc từ DB, `source` có thể không còn trong response cũ).

Hành vi:

- Tối đa **3** user từ Qdrant (vector bio tương tự),
- **3** từ `$geoNear`,
- **3** từ interest overlap (Jaccard trên slug),
- Gộp, **dedupe**, trả `source: 'live_heuristic'`.

Không chạy `gb.joblib`, không ghi `RecommendationResult`.

---

## 4. Bio & vector DB

| Bước | Nơi thực hiện | Kết quả |
|------|----------------|---------|
| User cập nhật bio | `POST /user/update-profile` | Mongo user + RMQ `USER_UPDATED` (có `bio`) |
| Sync snapshot | `UserSnapshotSyncService.syncUserUpdated` | `UserSnapshot.bio` |
| Embed | User service + recommendation `EmbeddingNotifyService` → `POST /embed-and-save` | `profile_vector` trong `user-service` |
| Qdrant | `embedding-service` `upsert_user_bio_vectors` | Collection `user_bios`, point id = uuid v5(mongoId), payload `mongoId` |

**Env gợi ý (recommendation + user):**

```env
EMBEDDING_SERVICE_URL=http://127.0.0.1:8000
PYTHON_RECOMMEND_URL=http://127.0.0.1:8000/recommend/rank
# (tuỳ chọn, legacy) PYTHON_TOPK_URL=http://127.0.0.1:8000/recommend/rank
RABBITMQ_URL=amqp://user:user@localhost:5672
```

Nếu không set `EMBEDDING_SERVICE_URL`, code dùng **origin** của `PYTHON_RECOMMEND_URL` hoặc `PYTHON_TOPK_URL`.

---

## 5. Kiểm tra dịch vụ (đã probe trên local)

| Dịch vụ | URL | Kỳ vọng |
|---------|-----|---------|
| embedding-service | `http://127.0.0.1:8000/docs` | HTTP 200 |
| Python GB rank | `POST http://127.0.0.1:8000/recommend/rank` | `status: ok` (cần `train_model/models/gb.joblib`) |
| Qdrant | `http://127.0.0.1:6333/collections` | collection `user_bios`, size 384, Cosine |
| recommendation | `http://127.0.0.1:3005/recommendation/interest-tags` | HTTP 200 |
| Kong | `http://127.0.0.1:8080/recommendation/interest-tags` | HTTP 200 |

**Model Python:** `embedding-service/train_model/models/gb.joblib` (không commit git; cần train hoặc copy vào máy).

**Hợp đồng HTTP Python (chỉ 2 endpoint):** [`embedding-service/CONTRACT.md`](../embedding-service/CONTRACT.md). Kiểm tra Nest vẫn gọi đúng: từ root repo chạy `python embedding-service/scripts/check_backend_contract.py`.

---

## 6. Kiểm tra dữ liệu Mongo (mongosh)

```bash
# Replica recommendation
mongosh recommendation-service --eval '
  print("UserSnapshot", db.UserSnapshot.countDocuments());
  print("RecommendationResult", db.RecommendationResult.countDocuments());
  print("InterestTag", db.InterestTag.countDocuments());
'

# Vector bio ở user DB
mongosh user-service --eval '
  print("Users", db.User.countDocuments());
  print("With profile_vector", db.User.countDocuments({ profile_vector: { $exists: true } }));
'
```

**Qdrant:**

```bash
curl -s http://127.0.0.1:6333/collections/user_bios | python3 -m json.tool
# points_count > 0 sau khi embed-and-save thành công
```

---

## 7. Làm cho hệ thống “có gợi ý thật” (checklist)

1. **RabbitMQ** chạy; **recommendation** và **user** đều kết nối cùng `RABBITMQ_URL`.
2. **Tạo lại snapshot** cho user hiện có (nếu đăng ký trước khi có subscriber):
   - Đăng ký user mới (event `USER_CREATED`), hoặc
   - Script/seed upsert `UserSnapshot` từ `user-service.User`, hoặc
   - Cập nhật profile (trigger `USER_UPDATED`).
3. **Seed interest tags** (đã có ~40 tag nếu chạy seed):  
   `cd backend/apps/recommendation && npx prisma db seed` (theo script trong repo).
4. **Embed bio** (backfill Qdrant + `profile_vector`):
   - Cập nhật bio qua app, hoặc
   - `POST http://127.0.0.1:8000/embed-and-save` body `{ "users": [{ "id": "<mongoId>", "bio": "...", "age": 0 }] }`, hoặc
   - Script `database/sync_data_profile_embedding.js`.
5. **Chạy ranking batch một lần** (lưu `RecommendationResult`):
   - Đợi cron nửa đêm, hoặc
   - Gọi tạm từ code/console: `recommendationService.recommendation()` (cần `UserSnapshot` > 0).
6. **GET gợi ý** qua Kong: `GET http://localhost:8080/recommendation/me` (cookie đăng nhập).

---

## 8. File code quan trọng

| Chủ đề | Đường dẫn |
|--------|-----------|
| GET + cold start live | `apps/recommendation/src/recommendation.service.ts` — `getRecommendationForUser`, `getLiveHeuristicColdStartRecommendations` |
| Batch + lưu Mongo | `recommendationHelper`, `recommendation()` |
| Cron | `apps/recommendation/src/background-jobs/recommendation/recommendation.cron.ts` |
| Python client | `apps/recommendation/src/python-recommendation.client.ts` |
| Embed notify | `apps/recommendation/src/services/embedding-notify.service.ts` |
| Snapshot RMQ | `apps/recommendation/src/rmq/subscribers/user-snapshot-sync.subscriber.ts` |
| Qdrant | `libs/qdrant/src/qdrant.service.ts` |
| Python recommend/rank + embed | `embedding-service/app/services/recommendation_rank_service.py`, `embedding_service.py`, `qdrant_user_bios_sync.py` |
| Kong route | `kong/kong.yml` → `host.docker.internal:3005` |
| Prisma | `apps/recommendation/prisma/schema.prisma` |

---

## 9. API cho frontend

| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| GET | `/recommendation/interest-tags` | Không | Catalog tag onboarding |
| GET | `/recommendation/me` | Có | Danh sách gợi ý (stored hoặc `live_heuristic`) |

Response gợi ý: `candidates[]` với feature scores + `profile` (username, avatar, bio, …).  
Khi cold live: thêm field **`source: "live_heuristic"`** (không có trong response cron).

---

## 10. Kết bạn → xóa khỏi danh sách gợi ý

Khi lời mời được **chấp nhận** (`USER_UPDATE_STATUS_MAKE_FRIEND`, `status: ACCEPTED`):

- RabbitMQ → `FriendshipRecommendationSubscriber` → xóa user khỏi `RecommendationResult.candidates` (và `features`) **cả hai chiều** (A khỏi list B, B khỏi list A).
- `GET /recommendation/me` còn lọc thêm theo Neo4j `FRIEND` và ghi lại Mongo nếu cache còn sót.

File: `services/recommendation-friendship.service.ts`, `rmq/subscribers/friendship-recommendation.subscriber.ts`.

Sau khi bên kia accept, user nên **tải lại** trang gợi ý (FE đã có nút “Tải lại”) để thấy list mới.

---

## 11. Hạn chế / việc tiếp theo

- **Cron chỉ chạy 1 lần/ngày** — user mới / đổi bio có thể cần trigger `recommendationHelper` sau event (chưa có queue riêng).
- **`UserSnapshot` rỗng** → batch không xử lý ai; GET cold start cũng không tìm thấy `me`.
- **Qdrant trống** → nhánh “3 user giống bio” trong cold start trống (vẫn có thể có geo + interest).
- **ImpressionLog / training online** — trong spec [`README.RECOMMENDATION.md`](./README.RECOMMENDATION.md), chưa bắt buộc cho luồng hiện tại.
- Spec **không join DB user trực tiếp** — đúng; mọi thứ qua replica + event.

---

## 11. Liên quan tài liệu khác

- [`README.RECOMMENDATION.md`](./README.RECOMMENDATION.md) — thiết kế mục tiêu, schema đầy đủ, training loop.
- [`cursor1.md`](../cursor1.md) (repo root) — ghi chú phiên làm việc cho AI.
- [`kong/kong.md`](./kong/kong.md) — gateway.
