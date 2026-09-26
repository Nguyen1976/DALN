# Deploy chỉ phần thật sự đổi — bản thiết kế

**Ngày:** 2026-09-26 · **Trạng thái:** đã duyệt hướng làm, chờ lập kế hoạch

Mỗi lần deploy hiện tạo lại **toàn bộ** container backend và web, dù thay đổi chỉ
nằm ở một service. Tài liệu này sửa gốc của việc đó, rồi gỡ những chỗ code của một
service đang nằm trong lib dùng chung và kéo các service khác restart theo.

Mục tiêu đo được:

- Sửa frontend thì không restart backend.
- Sửa `apps/user` thì chỉ restart `user`.
- Sửa OTP hoặc đặt lại mật khẩu thì chỉ restart `user`.
- Sửa template mail thì chỉ restart `notification`.
- Một thay đổi chỉ-tài-liệu thì **không tạo lại container nào**.
- Rollback vẫn là deploy lại một SHA cũ.

---

## 1. Số liệu làm căn cứ

**Mọi lần deploy tạo lại tất cả.** Log của 5 lần deploy gần nhất (PR #42 → #47) đều
ghi `Tạo lại: chat db-push migrate migrate-background notification realtime-gateway
recommendation recommendation-worker saga-orchestrator user web`.

Nguyên nhân: cả 8 tham chiếu `image:` trong `docker-compose.prod.yml` dùng chung
`${DALN_IMAGE_TAG}`, mà giá trị đó là SHA của commit. Tag đổi thì chuỗi `image:`
đổi, và `up -d` tạo lại container dù nội dung image giống hệt.

**Build backend tái lập được.** Tôi so digest manifest amd64 trên GHCR:

| Image | b9cda2d | 3073edc | 892b3a0 | 7443ce6 |
|---|---|---|---|---|
| db-push | b219540f | 7463434b | **7463434b** | **7463434b** |
| saga-orchestrator | 39629ed7 | 600c5591 | b9d812ac | **b9d812ac** |

Ô in đậm: image giống hệt lần trước mà container vẫn bị tạo lại.

**`web` không tái lập được khi cache miss.** Giữa `892b3a0` và `7443ce6` không file
frontend nào đổi, nhưng hai layer `COPY` cuối khác nhau vài byte. Đó là mtime lúc
checkout lọt vào layer. Cache GHA (giới hạn 10 GB, 8 scope ở `mode=max`) bị miss
thì layer được dựng lại với mtime mới.

**Chỗ đổi nhiều nằm trong lib dùng chung, nhưng là code của một service.**
Từ 2026-08-01:

- `libs/redis/src/redis.service.ts` được sửa trong nhiều commit, phần lớn là tính
  năng riêng của `user` (OTP, đặt lại mật khẩu, đổi mật khẩu).
- File này nằm trong bundle của 5 service, và khoảng **20 phương thức chỉ `user`
  gọi**.
- `libs/mailer` có 6 commit. Template của nó được copy vào **cả 6** image backend
  (`Dockerfile`, dòng `COPY --from=build /app/libs/mailer/src/templates`), dù chỉ
  `notification` gửi mail.

---

## 2. Phạm vi

**Trong phạm vi**

- **Phần A:** mỗi service một tag. Deploy giữ tag cũ khi nội dung image không đổi;
  CI build tái lập được.
- **Phần B:** tách khỏi `libs/`:
  - ~20 phương thức Redis chỉ `user` dùng → `apps/user`;
  - 2 phương thức chỉ `recommendation` dùng → `apps/recommendation`;
  - `libs/mailer` (cả template) → `apps/notification`.

**Ngoài phạm vi** — đã cân nhắc, cố ý bỏ

- **Cho stage build chỉ copy lib service cần.** Khi deploy quyết định theo *nội
  dung image*, context build không còn ảnh hưởng tới restart; việc này chỉ tiết
  kiệm phút runner CI (vốn chạy song song). Trong khi đó Docker không `COPY` có
  điều kiện theo service được, nên phải dựng context riêng cho từng service ở cả
  CI lẫn đường build dự phòng.
- **Dời `qdrant`, `rate-limit`, hai validator, `display-name`, `object-id`.** Từ khi
  tạo, mỗi file chỉ được sửa một lần, nên dời gần như không bớt được lần restart
  nào.
- **Dời `libs/migrations`.** Không app nào import nó, nên nó không vào bundle nào.
- **Đổi import từ barrel sang đường dẫn con.** Hữu ích, nhưng là một đợt sửa riêng.

---

## 3. Phần A — chỉ tạo lại container có image đổi

### 3.1 Build tái lập (`.github/workflows/ci-cd.yml`, job `images`)

Bước `docker/build-push-action`:

- thêm `env: SOURCE_DATE_EPOCH: 0`;
- thay `push: true` bằng `outputs: type=image,push=true,rewrite-timestamp=true`.

Timestamp trong mọi layer và trong config bị cố định, nên cùng input thì ra cùng
image dù cache có hay không. Tag giữ nguyên như cũ: `:<sha>` và `:latest`.

### 3.2 Compose (`backend/docker-compose.prod.yml`)

Mỗi tham chiếu `image:` có biến riêng, mặc định rơi về tag chung:

```yaml
image: ${DALN_IMAGE_PREFIX:-daln}/user:${DALN_TAG_USER:-${DALN_IMAGE_TAG:-latest}}
```

| Image | Biến | Service dùng |
|---|---|---|
| db-push | `DALN_TAG_DB_PUSH` | db-push, migrate, migrate-background |
| user | `DALN_TAG_USER` | user |
| chat | `DALN_TAG_CHAT` | chat |
| notification | `DALN_TAG_NOTIFICATION` | notification |
| realtime-gateway | `DALN_TAG_REALTIME_GATEWAY` | realtime-gateway |
| recommendation | `DALN_TAG_RECOMMENDATION` | recommendation, recommendation-worker |
| saga-orchestrator | `DALN_TAG_SAGA_ORCHESTRATOR` | saga-orchestrator |
| web | `DALN_TAG_WEB` | web |

Tên biến là tên image viết hoa, `-` đổi thành `_`. Không đặt biến nào thì hành vi y
như hiện nay. Đã thử: Compose v5 thế đúng `${A:-${B:-latest}}` ở cả ba trường hợp.

### 3.3 Chọn tag lúc deploy (`deploy/lib/image-tags.sh`, mới)

Tách thành file riêng để test được, và `deploy.sh` `source` nó. Gồm ba hàm:

- `image_fingerprint <ref>` — vân tay nội dung (`.RootFS.Layers` + `.Config`), đúng
  công thức của `image_id()` đang có. `.Id` không dùng được vì với containerd image
  store, `.Id` đổi sau mỗi lần build.
- `running_image_ref <service>` — tham chiếu image của container mang nhãn
  `com.docker.compose.project=<project>` và `com.docker.compose.service=<service>`.
  Container đã dừng cũng tính, vì `db-push` và `migrate` là one-shot. Không có
  container thì trả chuỗi rỗng.
- `choose_image_tag <image> <service> <new_tag>` — in ra tag cần dùng:
  - trả **tag cũ** chỉ khi *cả ba* điều sau cùng đúng: có container, đọc được vân
    tay của cả hai image, và hai vân tay bằng nhau;
  - mọi trường hợp khác (không có container, inspect lỗi, vân tay khác) trả
    `<new_tag>`.

  Lỗi luôn nghiêng về phía deploy bản mới. Chọn nhầm tag cũ cho một image *đã đổi*
  là không bao giờ được xảy ra.

Project mặc định là `daln-prod`; test đổi qua biến `DALN_COMPOSE_PROJECT`.

### 3.4 `deploy/deploy.sh`

1. Đầu script, `unset` mọi `DALN_TAG_*` còn sót trong môi trường, để pull và build
   luôn dùng SHA mới.
2. Pull (hoặc build tại chỗ) như hiện nay.
3. **Ngay sau khi có image, trước khi đếm migration:** với từng image, đặt
   `DALN_TAG_<IMAGE>` bằng kết quả của `choose_image_tag` và export. Service đại
   diện cho mỗi image là cột "Service dùng" đầu tiên trong bảng §3.2.
4. `built` (dòng tóm tắt "Image mới") chỉ còn các image thật sự chuyển sang tag
   mới. Thêm dòng "Giữ nguyên" liệt kê image kèm 7 ký tự đầu của tag đang chạy.
5. Các bước đếm migration, `up -d` và restart Kong giữ nguyên. Kong vốn chỉ restart
   khi một service phía sau nó được tạo lại.
6. Bước dọn image loại trừ **mọi** tag đang dùng (tập các giá trị `DALN_TAG_*`),
   không chỉ SHA mới. Docker vốn từ chối xoá image còn container dùng; bước này
   chỉ làm cho ý định hiện rõ ra.

**Rollback:** deploy một SHA cũ sẽ pull image của SHA đó và đi qua cùng phép so
sánh. Service nào khác nội dung thì chuyển.

**Lần deploy đầu sau thay đổi này:** quy tắc timestamp đổi nên mọi image khác một
lần, và tất cả được tạo lại. Từ lần thứ hai trở đi mới thấy hiệu quả.

---

## 4. Phần B — tách code một-service khỏi `libs/`

Chỉ dời code, **không đổi hành vi**. Tên phương thức, khoá Redis, TTL và thứ tự lệnh
giữ nguyên từng chữ.

### 4.1 `RedisService`

**Ở lại `libs/redis`**, vì dùng chung:

- các primitive: `get`, `set`, `setEx`, `del`, `delMany`, `exists`, `eval`,
  `pipeline`, `sadd`, `srem`, `smembers`, `spop`;
- presence: `isOnline`, `isOnlineBatch`;
- `claimOnce` (chat dùng; phần đặt lại mật khẩu cũng gọi nó).

**Dời sang `apps/user/src/auth-store/user-auth.store.ts`** (class `UserAuthStore`),
kèm các khai báo nội bộ chúng cần (`OtpNamespace`, hai namespace OTP, `hashOtp`,
các hàm dựng khoá):

- OTP đăng ký: `saveOTP`, `verifyOTP`, `deleteOTP`, `claimOtpAttempt`,
  `claimOtpResendSlot`;
- OTP đổi mật khẩu: `saveChangePasswordOtp`, `verifyChangePasswordOtp`,
  `deleteChangePasswordOtp`, `claimChangePasswordOtpAttempt`,
  `claimChangePasswordOtpResendSlot`;
- khoá đăng nhập: `countLoginFailure`, `loginFailureCount`, `clearLoginFailures`;
- đặt lại mật khẩu: `savePasswordResetToken`, `peekPasswordResetToken`,
  `consumePasswordResetToken`, `clearPasswordResetIndex`,
  `claimPasswordResetSlot`, `claimPasswordResetIpSlot`,
  `claimPasswordResetHourlySlot`.

`UserAuthStore` inject `'REDIS_CLIENT'` (do `RedisModule`, vốn `@Global`, export) và
`RedisService` (để gọi `claimOnce`). `UserService` nhận thêm tham số cuối
`authStore: UserAuthStore` và gọi 20 phương thức trên qua đó; `redisService` chỉ
còn dùng cho `isOnlineBatch`.

**Dời sang `apps/recommendation/src/services/user-features.cache.ts`** (class
`UserFeaturesCache`): `getUserFeaturesBatch`, `setUserFeaturesBatch`, interface
`CachedFeatures` và hàm dựng khoá. `RecommendationService` nhận thêm tham số cuối
`featuresCache: UserFeaturesCache`.

**Test đi theo code:**

- phần OTP, khoá đăng nhập và OTP đổi mật khẩu trong `redis.service.redis.spec.ts`
  → `apps/user/src/auth-store/user-auth.store.redis.spec.ts`;
- phần "token đặt lại mật khẩu" trong `redis.service.spec.ts`
  → `apps/user/src/auth-store/user-auth.store.spec.ts`.

Các spec của `UserService` đã mock đúng tên phương thức, nên truyền luôn mock đó cho
tham số `authStore`.

### 4.2 Mailer → `apps/notification/src/mailer/`

- Dời `mailer.module.ts`, `mailer.service.ts`, `mailer.service.spec.ts` và
  `templates/`.
- `resolveTemplate` thử hai chỗ, theo thứ tự:
  1. `join(__dirname, 'templates', f)` — bố cục mã nguồn (dev, jest);
  2. `join(__dirname, 'mailer', 'templates', f)` — bố cục bundle: webpack giữ
     `__dirname` thật, tức `dist/apps/notification`.

  Bỏ ứng viên `process.cwd()/libs/mailer/...`.
- `nest-cli.json`, project `notification`: thêm asset
  `{ "include": "mailer/templates/**/*", "outDir": "dist/apps/notification" }`.
  Template đi cùng `dist` của riêng `notification`.
- `Dockerfile`: bỏ dòng copy template vào mọi image.
- Dọn tham chiếu lib cũ: project `mailer` trong `nest-cli.json`, alias
  `@app/mailer` trong `tsconfig.json`, mapper jest trong `package.json`, và cả thư
  mục `libs/mailer`.

---

## 5. Kiểm thử

- **Unit:** các test đã dời chạy xanh ở vị trí mới (suite Redis thật không được
  skip). Toàn bộ `npm test`, `typecheck`, `lint:check`; frontend `lint` và `build`.
- **Hàm chọn tag** — `deploy/tests/image-tags.test.sh`, chạy trên Docker local, không
  đụng prod. Dựng image tí hon, tạo container mang nhãn compose của một project
  test, rồi kiểm:
  - nội dung giống → giữ tag cũ;
  - nội dung khác → tag mới;
  - không có container → tag mới;
  - tag đang chạy không inspect được → tag mới.
- **Build tái lập:** build image `saga-orchestrator` hai lần ở local với
  `--no-cache`, `SOURCE_DATE_EPOCH=0` và `rewrite-timestamp=true`; danh sách layer
  phải trùng nhau.
- **Image prod ở local:**
  - `notification` phải có `dist/apps/notification/mailer/templates/*`;
  - `user` và `chat` không còn `libs/mailer`;
  - `check-externals` qua cho cả hai.
- **QC dev:** chạy `auth-api.sh` (OTP, khoá đăng nhập, đặt lại mật khẩu),
  `change-password-browser.mjs` (OTP đổi mật khẩu, mail qua MailHog) và
  `session-location-browser.mjs`.
- **Nghiệm thu trên prod:**
  - lần deploy đầu sau merge tạo lại tất cả (§3.4);
  - lần sau là một thay đổi chỉ-tài-liệu, và log phải ghi **`Tạo lại: không có`**
    cùng `Image mới: không có`.

---

## 6. Rủi ro

- **Docker Compose trên server quá cũ, không thế được biến lồng nhau.** Không
  kiểm được từ xa. Nếu gặp, `compose config` báo lỗi ngay ở bước `pull`, trước khi
  đụng container, nên deploy dừng và app cũ chạy tiếp.
- **Build vẫn không tái lập trên runner CI.** Hậu quả an toàn: service đó bị tạo lại
  như hiện nay. Nghiệm thu chỉ-tài-liệu sẽ phát hiện.
- **So sánh sai theo hướng giữ tag cũ.** Rủi ro duy nhất có hại, nên hàm chỉ giữ tag
  cũ khi cả hai vân tay đọc được và bằng nhau, và test phủ nhánh inspect lỗi.
- **`__dirname` trong bundle webpack.** Nếu không phải đường dẫn thật thì mail lỗi
  "template not found". Kiểm bằng image prod local; spec `MailerService` phủ bố cục
  mã nguồn.

---

## 7. Danh sách tệp

| Tệp | Thay đổi |
|---|---|
| `.github/workflows/ci-cd.yml` | `SOURCE_DATE_EPOCH`, `rewrite-timestamp` |
| `backend/docker-compose.prod.yml` | 8 biến tag theo image |
| `deploy/lib/image-tags.sh` | **mới** — ba hàm chọn tag |
| `deploy/tests/image-tags.test.sh` | **mới** |
| `deploy/deploy.sh` | source lib, chọn tag sau pull, tóm tắt, dọn image |
| `deploy/README.md` | mục "Deploy chỉ làm lại phần có thay đổi" cập nhật |
| `backend/libs/redis/src/redis.service.ts` | bỏ ~22 phương thức một-service |
| `backend/libs/redis/src/redis.service{,.redis}.spec.ts` | bỏ phần test đã dời |
| `backend/apps/user/src/auth-store/user-auth.store{,.spec,.redis.spec}.ts` | **mới** |
| `backend/apps/user/src/user.service.ts`, `user.module.ts` | dùng `UserAuthStore` |
| `backend/apps/user/src/user.service.*.spec.ts` (4 file) | tham số thứ 13 |
| `backend/apps/recommendation/src/services/user-features.cache.ts` | **mới** |
| `backend/apps/recommendation/src/recommendation.service.ts`, `.module.ts`, `.read.spec.ts` | dùng `UserFeaturesCache` |
| `backend/apps/notification/src/mailer/*` | **dời** từ `libs/mailer` |
| `backend/apps/notification/src/notification.{module,service}.ts` | import mới |
| `backend/nest-cli.json`, `tsconfig.json`, `package.json` | bỏ lib `mailer`; asset template |
| `backend/Dockerfile` | bỏ copy template vào mọi image |

---

## 8. Nghiệm thu trên prod (2026-09-26/27)

| Lần deploy | Nguồn image | Image mới | Tạo lại |
|---|---|---|---|
| PR #48 (`a3a1216`) | pull hỏng (`db-push`, connection reset qua IPv6) → build tại chỗ | cả 8 | tất cả (dự kiến: quy tắc timestamp đổi) |
| Chạy lại `a3a1216` | pull hỏng lần 2, vẫn `db-push` → build tại chỗ | cả 8 | tất cả |
| PR #49 (`a1d51b1`, thử lại pull + chỉ build image hỏng) | pull thành công, 114s | cả 8 (chuyển từ image build tại server sang image CI) | tất cả |
| PR này (chỉ tài liệu) | xem PR | kỳ vọng: không có | kỳ vọng: không có |

Compose trên server là v5.5.1, thế được biến lồng nhau. Build cache của hai lần build
tại chỗ để lại 63 GB trên đĩa; đã dọn bằng `docker builder prune -af`.
