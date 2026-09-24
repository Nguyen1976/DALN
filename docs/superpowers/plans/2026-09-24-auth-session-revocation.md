# Phiên đăng nhập thu hồi được — refresh token stateful có rotation

Ngày: 2026-09-24 · Phương án C đã chốt trong phiên brainstorming.

## Mục tiêu

Hôm nay logout chỉ xoá cookie ở máy người dùng; bản copy của cookie trong tay
người khác vẫn dùng được đủ 7 ngày, và đặt lại mật khẩu không giành lại được
tài khoản. Sau thay đổi này: thu hồi có hiệu lực **ngay** cho REST, ngay cho
WebSocket, và refresh token bị đánh cắp sẽ **tự tố giác** ở lần dùng thứ hai.

## Quyết định đã chốt

| Quyết định | Chọn |
|---|---|
| Kiểm tra mỗi request | **Có** — thu hồi tức thì |
| Người đang đăng nhập lúc deploy | **Đăng xuất tất cả** + đổi `JWT_SECRET` → một đường code duy nhất |
| Redis chết | **Fail-closed nhưng 503**, không phải 401 → FE retry, không đăng xuất |

### Sửa đổi phát hiện khi triển khai

`tokenVersion` (cột DB + cache `authver:<uid>`) bị **bỏ**. Vì guard đã chấp nhận
một round-trip Redis mỗi request, `EXISTS sess:<sid>` cho đúng độ tức thì đó mà
không cần số phiên bản: xoá phiên **là** thu hồi. Bỏ nó đồng thời gỡ một vấn đề
kiến trúc thật — chat/notification/recommendation không đọc được DB của
user-service, nên cache `ver` miss ở đó sẽ buộc phải gọi HTTP nội bộ.

Hệ quả: không có migration DB, không cần `prisma generate`, Redis chỉ còn 2 key.

## State

```
sess:<sid>      HASH  { uid, rtHash, prevHash, prevUntil, absExp, createdAt, lastSeenAt, ua, ip }
                TTL 7 ngày (idle), đẩy lại mỗi lần rotate
sess:idx:<uid>  SET   các sid của user — dùng cho logout-all, tự lành khi đọc
                TTL 30 ngày (lưới dọn rác)
```

Token:

```
access   JWT 15m, cookie path=/            { userId, email, username, sid, typ:'at' }
refresh  "<sid>.<verifier>", 7d, cookie path=/user (xem "Sai lệch" bên dưới)
         sid = randomBytes(16).base64url — chỉ để tra key
         verifier = randomBytes(32).base64url — Redis chỉ giữ sha256
```

## Việc

- [x] `session.constants.ts` — TTL dùng chung, tách ra để tránh vòng import
- [x] `session.store.ts` + spec — create · consume (Lua nguyên tử) · revoke · list
- [x] `resolve-tokens.ts` + spec — **co lại**: chỉ verify access, bỏ nhánh refresh
- [x] `auth.guard.ts` + spec — async, bỏ đoạn mint token, thêm `EXISTS sess:<sid>`
- [x] `RedisService` — thêm `exists`, `hgetall`
- [x] `user.service.ts` + spec — login tạo phiên, `refreshSession`, `logout`, `logoutAll`, reset mật khẩu thu hồi
- [x] `user-http.controller.ts` — `POST /user/refresh`, `POST /user/logout-all`, logout đọc cookie, 2 path cookie
- [x] RMQ — routing key + queue + payload `auth.session.revoked`
- [x] `realtime.gateway.ts` — subscriber ngắt socket theo sid; handshake access-only + kiểm phiên
- [x] FE `authorizeAxios.ts` — single-flight refresh, 503 ≠ 401
- [x] FE `socketAuth.ts` — refresh qua `/user/refresh`, `SESSION_REVOKED` là terminal
- [x] FE — `socket.disconnect()` ở cả 3 đường logout
- [x] Chạy test + lint + build
- [x] QC bằng Puppeteer trên dev: happy path + các nhánh bad

## Ma trận test

**session.store — 3 nhánh của consume**

| Đầu vào | Kỳ vọng |
|---|---|
| verifier khớp `rtHash` | `rotated`, cookie mới, `prevHash` = hash cũ, idle TTL được đẩy |
| verifier khớp `prevHash`, còn trong 30s | `grace` — **không** rotate lần nữa |
| verifier khớp `prevHash`, đã quá 30s | `replayed` |
| verifier không khớp gì | `replayed` |
| sid không tồn tại | `invalid` |
| cookie méo (không có dấu chấm) | `invalid`, không gọi Redis |
| `absExp` đã quá | `invalid` + key bị xoá |
| 5 request đồng thời cùng token | đúng 1 `rotated`, 4 `grace`, không ai bị giết |

**auth.guard**

| Đầu vào | Kỳ vọng |
|---|---|
| access hợp lệ + phiên còn | cho qua |
| access hợp lệ + phiên đã bị xoá | 401 `SESSION_REVOKED` |
| access hết hạn | 401 `ACCESS_TOKEN_EXPIRED` (FE gọi refresh) |
| access sai chữ ký | 401 `TOKEN_INVALID` |
| token thiếu `sid` (token cũ trước deploy) | 401 `TOKEN_INVALID` |
| `typ` ≠ `at` (đưa refresh vào chỗ access) | 401 `TOKEN_INVALID` |
| Redis lỗi | **503** `SESSION_CHECK_UNAVAILABLE` |
| `@WithoutLogin()` | cho qua, không chạm Redis |
| `@InternalOnly()` | vẫn thắng `@WithoutLogin()` như cũ |

**user.service**

login → có sid trong index · refresh rotate → sid không đổi · logout → phiên chết,
phiên khác của cùng user còn sống · logout-all → chết hết · reset mật khẩu → chết hết
· reuse detected → giết phiên + publish event.

---

## Phát hiện khi QC (và đã sửa)

Hai bug thật chỉ lộ ra khi chạy trên hệ thống sống, không phải khi chạy unit test.

### 1. Fail-closed 503 không hề chạy — request TREO

`libs/redis/src/redis.config.ts` đặt `maxRetriesPerRequest: null` và một
`retryStrategy` không giới hạn, nên khi Redis chết lệnh **không lỗi** mà xếp
hàng vô hạn. Nhánh `catch` trả 503 vì thế không bao giờ được chạm tới: đo bằng
`docker stop daln-redis` thì `curl` trả `000` sau khi tự bỏ, và login treo 15
giây. Unit test xanh vì nó mock một promise reject — tức là test đã kiểm một
tình huống không xảy ra trong thực tế.

Sửa: `SESSION_STORE_TIMEOUT_MS = 1000` bọc mọi lệnh của `SessionStore`
(`bounded()`), ném `SessionStoreUnavailableError`. Đo lại: 503 sau ~1,03s cho
`/user/me`, `/user/refresh`, `/user/login`, `/user/logout-all`; `/user/logout`
vẫn 204 vì đăng xuất là best-effort phía server. Đã thêm test cho ca "lệnh treo".

### 2. Frontend đăng xuất người dùng ở đúng mốc 15 phút

Cookie access có `maxAge` bằng TTL nên **trình duyệt tự xoá nó đúng lúc token
hết hạn**: request đầu tiên sau mốc đó không mang access token nào, và guard trả
`ACCESS_TOKEN_MISSING`. Bản đầu của interceptor xếp mã này vào nhóm "phiên chấm
dứt" → đăng xuất, dù refresh token còn hạn 7 ngày. Đây đúng là bug mà comment cũ
trong `resolve-tokens.ts` đã cảnh báo, chỉ là dựng lại ở tầng FE.

Sửa: chỉ `SESSION_REVOKED` là chấm dứt. Mọi 401 khác đều thử làm mới trước —
kể cả `TOKEN_INVALID`, vì sau khi đổi `JWT_SECRET` thì access token cũ vô hiệu
nhưng refresh token (chuỗi opaque) vẫn cứu được phiên.

## Sai lệch so với thiết kế ban đầu

- **Bỏ `tokenVersion`**: `EXISTS sess:<sid>` cho cùng độ tức thì mà không cần
  cột DB, không cần cache `authver`, và gỡ được việc chat/notification phải gọi
  HTTP nội bộ sang user-service khi cache miss.
- **Cookie refresh dùng `path=/user`, không phải `/user/refresh`**: hẹp hơn thì
  trình duyệt không gửi cookie tới `/user/logout` và logout mất đường xác định
  phiên. Đã kiểm bằng browser: `POST /user/logout` từ trong trang trả 204 và
  phiên biến mất khỏi Redis.
- **Giữ `userId` thay vì đổi sang `sub`**, không thêm `iss`/`aud`: churn vô ích,
  và `sub` sẽ vỡ mọi `@UserInfo('userId')`.

## Kết quả QC

- Backend: **445/445** test xanh (52 suite), gồm 16 test Lua trên Redis thật
  (có ca 5 request song song: đúng 1 rotate, 4 grace, 0 bị giết oan).
- API (curl, 10 nhóm): **34/34**, gồm replay, 503 khi Redis chết, và các nhánh
  cookie méo / không cookie / sai quyền.
- Browser (Puppeteer trên localhost:5174): **22/22** — đăng nhập, path cookie,
  handshake socket chỉ bằng access token, làm mới ngầm ở mốc 15 phút, thu hồi
  từ thiết bị khác ngắt socket đang mở, đăng nhập lại, đăng xuất.

Lưu ý về chính bộ QC: hai assertion đầu tiên tôi viết đều SAI theo cùng một kiểu
— `curl -c` ghi ra jar mọi cookie nó đang biết chứ không riêng cookie mới, và
`page.cookies(url)` lọc theo path nên bỏ sót cookie `Path=/user`. Cả hai làm
code trông như có bug. Khi QC báo đỏ, nghi ngờ phép đo trước đã.

## Việc còn lại trước khi deploy

1. Đổi `JWT_SECRET` **cùng lúc** với deploy backend (secret hiện tại đã nằm
   trong git qua `.env.docker`), và xoá nó khỏi file được track.
2. FE và BE phải lên gần như đồng thời — merge `develop→main` build cả hai image
   trong một lần nên việc này tự nhiên đúng.
3. Không có migration DB: MongoDB, và `tokenVersion` đã bị bỏ.

---

# Phần 2 — Hardening và hoàn thiện

Làm tiếp những gì vòng đầu để ngoài scope.

## Chống lạm dụng

| Việc | Cách làm |
|---|---|
| Hạn mức theo endpoint | `RateLimitGuard` + `@RateLimit()` trên 9 endpoint công khai. Đếm theo IP và/hoặc email trong MỘT lệnh Lua (INCR + EXPIRE + TTL), trả 429 kèm `retryAfterSeconds`. Fail-**open** khi Redis lỗi. |
| Khoá tài khoản | 10 lần sai / 15 phút, đếm theo **tài khoản** (tấn công thật là nhiều IP dội một tài khoản). Đang khoá thì trả đúng thông điệp của mật khẩu sai — nói "đang bị khoá" là xác nhận email tồn tại. |
| OTP | `randomInt` thay `Math.random()`; lưu **sha256** thay cleartext; so khớp timing-safe; 5 lần sai là **tiêu huỷ mã**; DTO yêu cầu chữ số. |
| Timing | Nhánh "email không tồn tại" vẫn chạy bcrypt với một hash cố định, để thời gian trả lời không tố giác địa chỉ nào đã đăng ký. |

Không thêm `@nestjs/throttler`: repo đã có sẵn đúng pattern này cho luồng đặt lại
mật khẩu, và ta cần hai thứ throttler không cho sẵn — đếm theo email, và hình
dạng 429 mà frontend đã biết đọc.

## Hardening HTTP

- `helmet` cho cả 4 service HTTP + gateway (nosniff, HSTS, X-Frame-Options,
  Referrer-Policy). CSP tắt có chủ ý: đây là API trả JSON.
- CORS đổi từ `origin: true` (phản chiếu MỌI Origin kèm cookie) sang allowlist
  từ `CORS_ORIGINS`. Socket gateway đổi từ `origin: '*'`, và `credentials`
  chuyển vào trong `cors` — chỗ Socket.IO thực sự đọc.
- `trust proxy` cho cả 3 service còn thiếu, nếu không `req.ip` là IP của Kong.
- Body của webhook LiveKit có trần 256KB; trước đây parser nhận mọi
  content-type mà không có trần.
- Chính sách mật khẩu: 8–64 ký tự **và** trần 72 byte. `MaxLength` đếm ký tự
  còn bcrypt cắt ở 72 byte, nên 40 ký tự tiếng Việt vẫn bị cắt âm thầm —
  `@MaxBytes(72)` đóng khe đó. Login giữ trần rộng (200) để người có mật khẩu
  cũ không bị khoá ra ngoài.
- Secret: `JWT_SECRET`/`INTERNAL_API_TOKEN` đã bị lấy ra khỏi `.env.docker`
  (file được git track), và boot **từ chối** secret nằm trong danh sách đã lộ
  hoặc ngắn dưới 32 ký tự — cứng ở production, cảnh báo to ở dev.

## Tính năng đi kèm cơ chế thu hồi

- `GET /user/sessions` + `POST /user/sessions/revoke` và mục "Phiên đăng nhập"
  trong Cài đặt: liệt kê thiết bị (trình duyệt, IP, hoạt động lần cuối), đánh
  dấu thiết bị hiện tại, thu hồi từng thiết bị, và "đăng xuất khỏi mọi thiết bị".
- Email cảnh báo khi phát hiện refresh token bị dùng lại, đi qua RMQ tới
  notification. **Chỉ** gửi cho lý do `token-reuse`: gửi mail cho việc người
  dùng tự làm là dạy họ bỏ qua email hệ thống, để rồi bỏ qua đúng cảnh báo thật.

## Phát hiện thêm khi QC phần 2

**1. IDOR trong thu hồi theo thiết bị.** `revokeSession` ban đầu `DEL sess:<sid>`
mà không kiểm chủ sở hữu — mở endpoint nhận `sid` từ client là mở luôn đường
xoá phiên của người khác. Sửa: `SREM` trên chỉ mục của user chạy TRƯỚC và chính
nó là bước kiểm quyền; chỉ `DEL` khi `SREM` trả 1. Có test trên Redis thật.

**2. Hạn mức "theo IP" của Kong vẫn dùng chung một xô.** Ảnh QC cho thấy IP lưu
trong phiên là `172.22.0.1` — IP docker gateway. Đo lại bằng cách gửi
`X-Forwarded-For` qua Kong: service giải đúng IP client và key hạn mức thành
`rl:login:ip:203.0.113.9`, nên **production đúng** (nginx đã set XFF, và
`trust proxy 2` bỏ đúng 2 hop nên XFF do client bịa không lọt). Riêng plugin
rate-limiting của Kong thì chưa: đã thêm `KONG_TRUSTED_IPS` +
`KONG_REAL_IP_HEADER` + `KONG_REAL_IP_RECURSIVE`. An toàn vì cổng proxy của
Kong chỉ bind `127.0.0.1`. Ở dev không có nginx nên mọi request vẫn chung một
xô — đã ghi trong `qc/README.md`.

**3. Bộ QC phụ thuộc vào đúng điểm yếu vừa sửa.** Harness đọc OTP thô từ Redis;
sau khi OTP được băm thì nó không kích hoạt được tài khoản, và 25 phép kiểm đỏ
theo kiểu dây chuyền. Sửa harness: tự ghi bản băm của một mã biết trước rồi xác
thực bằng chính mã đó — vẫn đi qua đường verify thật.

**4. Harness tự chặn mình.** Bộ QC gọi đăng nhập nhiều hơn hạn mức thật, nên nó
bị 429 và mọi nhóm sau đỏ vì không có cookie. Sửa: dọn key `rl:*` trước mỗi
nhóm, và kiểm hạn mức trong nhóm riêng ở cuối.

**5. Nhãn QC in sai.** Hai dòng in `✅ 400 (400)` thay vì nội dung thật, do JSON
escape `\"` lồng trực tiếp trong `"$( )"` làm bash tách kết quả thành nhiều
tham số. Nhãn sai trong báo cáo QC là đúng thứ sau này che mất một lỗi thật —
đã thêm helper `post_code` để chặn cả lớp lỗi đó.

## Kết quả QC cuối

| Tầng | Kết quả |
|---|---|
| Backend test | **496/496** (54 suite), gồm Lua trên Redis thật |
| `qc/auth-api.sh` | **61/61** — 18 nhóm |
| `qc/auth-browser.mjs` | **27/27** — 8 nhóm trên Chrome thật |
| tsc + eslint (BE, FE) | sạch |
| `npm run build` (FE) | thành công |

Bộ QC nằm trong repo ở `qc/`, có README và tự skip phần cần Redis khi không có.
