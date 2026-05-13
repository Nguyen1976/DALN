# DALN — Context cho AI (cursor1.md)

Tài liệu ngắn để AI khác nắm kiến trúc, thay đổi đã làm và chỗ cần lưu ý. **Cập nhật theo phiên làm việc đã mô tả trong chat.**

## Repo tổng quan

| Thư mục | Vai trò |
|----------|---------|
| `backend/` | Monorepo **NestJS**: apps `user`, `chat`, `notification`, `realtime-gateway`, **`recommendation`**; libs `neo4j`, `qdrant`, `redis`, `common`, … |
| `embedding-service/` | FastAPI + Sentence Transformers: embed bio/age → Mongo `User.profile_vector` |
| `frontend/` | React + Vite + Redux; Kong entry `API_ROOT` thường `http://localhost:8080` |
| `backend/kong/kong.yml` | Gateway: `/user`, `/chat`, `/notification`, `/recommendation` → `host.docker.internal:PORT` |
| `backend/docker-compose.yml` | Kong + Prometheus + Grafana + cAdvisor (**không** chứa microservice Nest trong compose mặc định) |

**Cổng tham chiếu:** user `3002`, chat `3003`, notification `3004`, recommendation `3005` (chạy trên host khi dùng Kong như hiện tại).

---

## Recommendation & embedding (logic chính)

- **Recommendation DB (Mongo, Prisma riêng):** `UserSnapshot`, `InterestTag`, `RecommendationResult`.
- **Luồng ranking:** Neo4j (bạn chung / nhóm) + Qdrant (`user_bios`, similar) + Mongo `$geoNear` + feature (graph, distance, bio vector) → HTTP **`PYTHON_TOPK_URL`** (embedding-service `/top-k`, GB `SAFE_FEATURES`).
- **Cron:** `RecommendationCron` — mỗi ngày nửa đêm gọi `recommendation()` → `recommendationHelper` từng user.
- **Spec thiết kế:** `backend/README.RECOMMENDATION.md` (local replica, event — có thể chưa khớp 100% code).

### Cold start (đã implement trong code)

- File chính: `backend/apps/recommendation/src/recommendation.service.ts`.
- **Phát hiện cold:** ít bạn bè / ít ứng viên graph / union nhỏ → mở rộng pool + blend mạnh hơn với “cold prior”.
- **Mở rộng ứng viên (Mongo):** `$geoNear` (near chuẩn hóa GeoJSON **hoặc** `{ lat, lon }`), `$match` **interests** giao với slug user, thêm vòng geo khi cold; union có thứ tự ưu tiên + cap ~480.
- **Cold prior:** Jaccard **interest tags**, bio token similarity, decay khoảng cách (Haversine qua `getLngLatPair`), tín hiệu vector (`bio_cosine` + qdrant). Lưu audit trong `RecommendationResult.features` (kèm `interest_jaccard`, `cold_prior`).
- **Model Python:** vẫn chỉ 15 feature cũ khi gọi predict; sau đó **blend** `score = α·model + (1−α)·cold_norm` (α thấp hơn khi cold). Python rỗng → xếp theo cold prior.
- **Độ bền:** `Promise.allSettled` Neo4j/Qdrant; neighbors/groups batch try/catch; `getVectorsBatch` try/catch.
- **Sync snapshot user mới:** `backend/apps/recommendation/src/services/user-snapshot-sync.service.ts` — `location` tạo **GeoJSON Point** `[lon, lat]` (tốt cho index 2dsphere).

### Qdrant / Rabbit (ảnh hưởng startup)

- `backend/libs/qdrant/src/qdrant.service.ts` — `onModuleInit` **try/catch** createCollection (Qdrant tắt vẫn start app).
- `backend/apps/recommendation/src/recommendation.module.ts` — RabbitMQ `connectionInitOptions: { wait: false }`.
- `backend/apps/recommendation/src/main.ts` — giống user/chat: ValidationPipe, GrpcToHttpExceptionFilter, **ResponseInterceptor**, cookieParser, listen **`0.0.0.0`**.

### Kong / FE interest-tags (502)

- Nguyên nhân thường gặp: recommendation không HTTP-ready; thiếu interceptor; CORS chỉ `localhost:5173` → đã thêm `127.0.0.1:5173` trong `kong/kong.yml`.
- FE: `frontend/src/apis/index.ts` — `getInterestTagsAPI` parse envelope hoặc mảng thuần; lỗi có HTTP status trong message.

---

## Interest onboarding (đăng ký / lần đầu)

**Backend user**

- Prisma `User`: `interests[]`, `hasCompletedInterestOnboarding` (legacy không field → API coi đã xong: `?? true`).
- `POST /user/interest-onboarding`, `GET /user/me`; login trả thêm 2 field trên.
- Validate slug qua HTTP catalog recommendation (`RECOMMENDATION_SERVICE_URL`).
- RMQ: `user.interests.updated` → subscriber recommendation cập nhật `UserSnapshot.interests`.

**Backend recommendation**

- `GET /recommendation/interest-tags` — `@WithoutLogin()`.
- `GET /recommendation` và `GET /recommendation/me` — gợi ý (cùng handler).

**Frontend**

- `userSlice`: `interests`, `hasCompletedInterestOnboarding`, `fetchCurrentUserAPI`, `completeInterestOnboardingAPI`.
- `ProtectedRoute`: redirect `/onboarding/interests` khi chưa xong; bootstrap `GET /user/me`.
- Trang: `frontend/src/pages/InterestOnboarding/index.tsx`; route trong `App.tsx`.

**Libs / payload**

- `libs/constant/rmq/routing.ts`, `queue.ts`, `payload.ts` — `USER_INTERESTS_UPDATED`, queue recommendation, `UserInterestsUpdatedPayload`.
- `backend/libs/redis/src/redis.service.ts` — cache features có thêm `interests`.

---

## Embedding-service

- `embedding-service/app/services/embedding_service.py` — text `"Tieu su: {bio}. Doi tuong: {age} tuoi."` → Mongo `profile_vector` (collection user service).
- **Lưu ý:** không ghi Qdrant trực tiếp; đồng bộ Qdrant nếu cần là pipeline/script riêng.

---

## File quan trọng (tham chiếu nhanh)

| Chủ đề | Đường dẫn |
|--------|-----------|
| Recommendation helper + cold start | `backend/apps/recommendation/src/recommendation.service.ts` |
| Cron | `backend/apps/recommendation/src/background-jobs/recommendation/recommendation.cron.ts` |
| Python top-k / SAFE_FEATURES | `embedding-service/app/services/logistic_service.py` |
| Qdrant lib | `backend/libs/qdrant/src/qdrant.service.ts` |
| User HTTP | `backend/apps/user/src/http/user-http.controller.ts` |
| User snapshot sync | `backend/apps/recommendation/src/services/user-snapshot-sync.service.ts` |
| Kong | `backend/kong/kong.yml` |
| FE API + interest tags | `frontend/src/apis/index.ts` |
| Spec RCM | `backend/README.RECOMMENDATION.md` |

---

## Việc có thể làm tiếp (chưa làm trong chat)

- Backfill `UserSnapshot.location` cũ → GeoJSON Point để index 2dsphere đồng nhất.
- Retrain `gb.joblib` nếu thêm `interest_jaccard` vào `SAFE_FEATURES`.
- Trigger `recommendationHelper(userId)` sau `user.interests.updated` (queue/cron nhẹ) thay vì chỉ chờ cron đêm.
- Đồng bộ `bio`/`location` user → `UserSnapshot` qua RMQ nếu chưa đủ (payload `UserUpdatedPayload` hiện chỉ một phần field).

---

## Ghi chú cho AI tiếp theo

- Đọc `backend/README.RECOMMENDATION.md` để hiểu **mục tiêu** vs code thực tế.
- Chạy DB: user và recommendation **Mongo khác nhau** (env `DATABASE_URL` từng app).
- Sau đổi Prisma user: `cd backend/apps/user && npx prisma db push` (hoặc migrate tương đương).
