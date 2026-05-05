# Recommendation Pipeline

Tài liệu này mô tả luồng gợi ý, train model và đánh giá model trong hệ thống hiện tại, dựa trên `backend/apps/recommendation/src/recommendation.service.ts` và `embedding-service/app/services/logistic_service.py`.

## 1. Mục tiêu

Pipeline recommendation có 3 nhiệm vụ chính:

1. Tạo danh sách candidate cho mỗi user từ nhiều nguồn khác nhau.
2. Hydrate feature đầy đủ cho candidate trước khi đưa vào model.
3. Train, evaluate và predict bằng model Python.

## 2. Các thành phần chính

### Backend recommendation service

File: `backend/apps/recommendation/src/recommendation.service.ts`

Service này chịu trách nhiệm:

- Lấy danh sách user cần gợi ý.
- Tạo candidate pool từ Neo4j, Qdrant và MongoDB/Prisma.
- Hydrate feature gồm `bio`, `location`, `mutualFriends`, `mutualGroups`, `interestSimilarity`, `distanceKm`.
- Gửi candidate sang Python để lấy top 100.
- Ghi kết quả vào `impresstionLog`.

### Python logistic service

File: `embedding-service/app/services/logistic_service.py`

Service này chịu trách nhiệm:

- Đọc dữ liệu train từ `impresstionLog`.
- Kết hợp với `actionLog` khi build label dataset.
- Train model.
- Evaluate model.
- Load model và dự đoán top K candidate.

### Redis cache

Redis được dùng để cache feature hydration cho user:

- Key: `user:{userId}:features`
- Value: JSON chứa `bio` và `location`

Mục tiêu là giảm số lần query Prisma khi hydrate feature cho candidate.

## 3. Luồng recommendation

### Bước 1: Lấy user đầu vào

Trong `recommendation()`, backend lấy một tập user từ Prisma, sau đó chia thành từng lô nhỏ bằng `lodash.chunk`.

Hiện tại code đang xử lý theo chunk để tránh dồn quá nhiều request cùng lúc vào DB:

- Lấy tối đa 1000 user.
- Chia thành chunk size 50.
- Mỗi chunk chạy song song bằng `Promise.all`.

### Bước 2: Tạo candidate pool

Trong `recommendationHelper(userId)`:

- Neo4j lấy friend graph để tìm user liên quan.
- Neo4j lấy common friend/common group cho candidate set.
- Qdrant trả về candidate theo độ tương đồng interest.
- MongoDB/Prisma lấy user hiện tại để lấy `bio` và `location`.
- GeoNear được dùng để tìm candidate gần vị trí.

Từ các nguồn trên, hệ thống tạo ra `allCandidateIds` là tập union candidate duy nhất.

### Bước 3: Hydrate feature

Giai đoạn 7 hiện tại làm theo thứ tự sau:

1. Đọc cache từ Redis bằng batch.
2. Tìm các ID bị miss cache.
3. Query Prisma chỉ cho ID bị miss.
4. Warm-up cache lại bằng `setUserFeaturesBatch`.
5. Dùng `Map` để merge dữ liệu O(1).
6. Không query Neo4j lại cho `commonFriends` và `commonGroups` ở stage này, mà tái sử dụng dữ liệu đã lấy trước đó.

### Bước 4: Tạo feature cho model

Cho mỗi candidate, backend tính 4 feature chính:

- `mutualFriends`
- `mutualGroups`
- `interestSimilarity`
- `distanceKm`

Trong đó:

- `interestSimilarity` là max của điểm Qdrant và độ giống bio.
- `distanceKm` được tính bằng Haversine từ tọa độ user hiện tại và candidate.

### Bước 5: Gọi Python để xếp hạng

Backend gửi danh sách candidate đã hydrate xong sang Python thông qua `PythonRecommendationClient`.

Python trả về danh sách đã sắp xếp theo score, backend lấy top 100.

### Bước 6: Ghi log impression

Sau khi có top 100, backend ghi vào collection `impresstionLog` với:

- `userId`
- `candidateId`
- `features`
- `action`
- `score`
- `rank`
- `version`

## 4. Luồng train model

### Nguồn dữ liệu train

Trong `logistic_service.py`, dữ liệu train được build từ `impresstionLog` theo `version` mới nhất.

Mỗi row gồm:

- `mutualFriends`
- `mutualGroups`
- `interestSimilarity`
- `distanceKm`
- `action`

### Cách tạo label

Label được map như sau:

- `MESSAGE` và `FRIEND` -> `1`
- các action còn lại, ví dụ `IGNORE` -> `0`

### Vai trò của `actionLog`

Khi build dataset, Python vẫn đọc thêm `actionLog` và có thể override action theo cặp `(userId, candidateId)` nếu tìm thấy dữ liệu phù hợp.

Điều này giúp tận dụng lịch sử tương tác thật, nhưng nếu collection `actionLog` chứa dữ liệu cũ không phù hợp thì có thể làm label bị lệch.

### Model dùng để train

Hiện tại `retrain_model()` và `evaluate_model()` đều đang dùng `RandomForestClassifier`.

Thông số hiện tại trong code:

- `retrain_model()`:
  - `n_estimators=300`
  - `random_state=42`
  - `class_weight="balanced"`
  - `n_jobs=-1`

- `evaluate_model()`:
  - `n_estimators=100`
  - `random_state=42`
  - `class_weight="balanced"`
  - `n_jobs=-1`

Sau khi train xong, model được lưu ở:

- `embedding-service/models/latest_model.pkl`
- `embedding-service/models/latest_model_version_{version}.pkl`

## 5. Luồng evaluate model

Hàm `evaluate_model(version)` thực hiện:

1. Lấy rows từ `impresstionLog` theo version.
2. Tạo label từ `action`.
3. Kiểm tra điều kiện dữ liệu tối thiểu.
4. Chia train/test bằng `train_test_split` với `stratify=y`.
5. Train Random Forest.
6. Tính metric:
   - precision
   - recall
   - f1
   - accuracy
   - ROC AUC
   - confusion matrix
   - classification report
7. Lưu model đã train vào file versioned và latest.

## 6. Luồng predict top 100

Hàm `predict_top_k(candidates_json, k=100)`:

1. Load model hiện tại từ `latest_model.pkl`.
2. Convert candidate JSON sang DataFrame.
3. Lấy 4 feature đầu vào.
4. Gọi `predict_proba()`.
5. Sort theo score giảm dần.
6. Trả về top K, mặc định là 100.

## 7. Cache warm-up cho Redis

Redis cache hiện được dùng theo hướng feature hydration cache:

- `getUserFeaturesBatch()` đọc batch features từ cache.
- `setUserFeaturesBatch()` ghi ngược lại các profile bị miss.

Luồng này giúp lần recommendation sau giảm đáng kể số query Prisma.

## 8. Ghi chú quan trọng

1. Stage 7 hiện không còn query Neo4j lại cho common friends/common groups.
2. Cache Redis chỉ phát huy hiệu quả khi có warm-up từ dữ liệu miss.
3. Nếu cập nhật profile user, cần đồng bộ cache Redis để tránh dữ liệu cũ.
4. `predict_top_k()` chỉ phản ánh chất lượng model đã được train gần nhất.

## 9. Tóm tắt ngắn

Luồng tổng quát hiện tại là:

`Neo4j + Qdrant + Prisma + Redis -> feature hydration -> Python Random Forest -> top 100 -> impresstionLog -> train/evaluate versioned model`

Nếu muốn mở rộng tiếp, điểm nên làm tiếp theo là:

- cập nhật Redis khi user sửa bio/location,
- chuẩn hóa version của model,
- thêm job retrain định kỳ,
- thêm metrics theo từng phiên recommendation.
