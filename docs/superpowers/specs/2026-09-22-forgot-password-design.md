# Quên mật khẩu — bản thiết kế

**Ngày:** 2026-09-22 · **Trạng thái:** đã duyệt, chờ lập kế hoạch triển khai

Đặt lại mật khẩu qua liên kết một lần gửi tới email, cho người dùng không đăng
nhập được. Tài liệu này mô tả luồng, hợp đồng API, mô hình dữ liệu, giao diện và
những rủi ro đã biết chấp nhận để lại.

**Tài liệu kèm theo**

- [`docs/diagrams/forgot-password-flow.html`](../../diagrams/forgot-password-flow.html) — sequence, luồng đầu–cuối qua 5 thành phần
- [`docs/diagrams/password-reset-token-state.html`](../../diagrams/password-reset-token-state.html) — state machine, vòng đời token trong Redis
- [`docs/design/forgot-password-ui.html`](../../design/forgot-password-ui.html) — mockup 6 trạng thái giao diện, sáng và tối

---

## 1. Phạm vi

**Trong phạm vi**

- Yêu cầu đặt lại mật khẩu bằng địa chỉ email
- Liên kết một lần, hết hạn sau 15 phút, gửi qua email
- Trang đặt mật khẩu mới
- Email cảnh báo sau khi mật khẩu đã đổi

**Ngoài phạm vi** — cố ý, không phải bỏ sót

- Đổi mật khẩu khi đang đăng nhập (`/settings/account` hiện là nút `disabled`
  gắn nhãn `soon`). Luồng đó dùng chung validator và `PasswordField`, nên khi
  làm sẽ tái dùng được phần lớn thiết kế này.
- Thu hồi phiên đăng nhập sau khi đổi mật khẩu — xem [§8 Rủi ro](#8-rủi-ro-đã-biết).
- Quản lý thiết bị đang đăng nhập.
- Xác thực hai lớp.

---

## 2. Nền tảng sẵn có được tái dùng

Thiết kế này cố ý bám theo các cơ chế đã chạy trong hệ thống thay vì dựng mới.

| Thứ có sẵn | Ở đâu | Dùng vào việc gì |
|---|---|---|
| Template mail `{{biến}}`, logo CID, `buildFrontendUrl()` | `libs/mailer/src/mailer.service.ts` | Hai template mới |
| `claimOtpResendSlot()` — `SET NX EX` nguyên tử | `libs/redis/src/redis.service.ts` | Mẫu cho cooldown 60s |
| Trả lời giống hệt nhau dù email tồn tại hay không | `UserService.resendRegistrationOtp` | Chống dò tài khoản |
| user-service publish → notification-service gửi mail | `UserEventsPublisher` | Hai event mới |
| Countdown gắn deadline trong `localStorage` | `pages/VerifyOtp/index.tsx` | Nút "Gửi lại" |
| `PasswordField` + `PasswordStrength` | `components/AuthForm/PasswordField.tsx` | Trang đặt mật khẩu mới |
| `hashPassword` / `comparePassword` | `UtilService` | Ghi mật khẩu mới |

**Không** đổi schema MongoDB. **Không** đụng `AuthGuard`.

---

## 3. Luồng đầu–cuối

```
Trang /auth ── "Quên mật khẩu?" ──→ /forgot-password
     │
     │  POST /user/forgot-password { email }
     ├──────────────────────────────────────────→ 204 (luôn luôn)
     │     user-service:
     │       1. INCR bộ đếm theo IP        → quá hạn mức thì im lặng bỏ qua
     │       2. claim cooldown theo email  → đang trong cooldown thì im lặng bỏ qua
     │       3. tra user; không có / chưa kích hoạt → im lặng bỏ qua
     │       4. sinh token, lưu sha256 vào Redis (TTL 15')
     │       5. publish user.passwordReset
     │     notification-service:
     │       consume → MailerService.sendPasswordReset(link)
     │
     │  Hộp thư ── [Đặt lại mật khẩu] ──→ /reset-password?token=xxx
     │
     │  GET /user/reset-password/validate?token=xxx
     ├──────────────────────────────────────────→ { valid, maskedEmail? }
     │
     │  POST /user/reset-password { token, password }
     └──────────────────────────────────────────→ 204
           user-service:
             1. GETDEL pwdreset:sha256(token) → không có thì 400
             2. hash mật khẩu mới, ghi vào User
             3. xoá chỉ mục ngược (nỗ lực tốt nhất)
             4. publish user.passwordChanged
           notification-service:
             consume → MailerService.sendPasswordChanged()

     Frontend ──→ /auth + toast "Đặt lại mật khẩu thành công"
```

---

## 4. Mô hình dữ liệu — Redis

Token sống trong Redis, không phải MongoDB. Lý do: OTP đăng ký đã sống ở đó, cả
hai đều là dữ liệu ngắn hạn tự hết hạn, và mất Redis chỉ khiến người dùng phải
bấm "gửi lại liên kết" — không mất dữ liệu nào.

| Key | Giá trị | TTL | Vai trò |
|---|---|---|---|
| `pwdreset:<sha256(token)>` | `userId` | 900s | Tra token → tài khoản |
| `pwdreset:email:<email>` | `sha256(token)` | 900s | Huỷ token cũ khi cấp token mới |
| `pwdreset:cooldown:<email>` | `1` | 60s | Chặn dội bom một hộp thư |
| `pwdreset:ip:<ip>` | bộ đếm | 3600s | Chặn quét hàng loạt địa chỉ |

**Sinh token:** `randomBytes(32).toString('base64url')` → 43 ký tự, 256 bit
entropy. An toàn trong URL, không cần escape.

**Lưu hash, không lưu token thô.** Đây là điểm khác cố ý so với OTP đăng ký hiện
tại. OTP là 6 chữ số sống 5 phút — thô cũng chấp nhận được. Token này là chìa
khoá đầy đủ vào tài khoản: ai đọc được Redis qua dump, log hay backup đều không
được phép dùng lại nó. So khớp bằng `timingSafeEqual` trên hai hash.

**Dùng một lần, tiêu thụ bằng `GETDEL`.** Đọc và xoá phải nằm trong *một* lệnh.
Tách thành `GET` rồi `DEL` để hở một khe: hai request mang cùng token có thể cùng
vượt qua bước `GET` trước khi bước `DEL` đầu tiên kịp chạy, và token "một lần"
vừa dùng được hai lần. `GETDEL` (Redis 6.2+, dự án chạy Redis 7) đóng khe đó —
đúng một caller nhận được `userId`, caller còn lại nhận `null`.

Thứ tự cũng là một phần của bảo đảm: **tiêu thụ token trước, ghi mật khẩu sau.**
Làm ngược lại là mở lại đúng khe hở vừa đóng.

Chỉ mục ngược `pwdreset:email:<email>` xoá theo kiểu nỗ-lực-tốt-nhất sau đó. Nó
chỉ là chỉ mục: nếu còn sót, lần cấp token kế tiếp sẽ `DEL` một key đã biến mất —
vô hại — và bản thân nó cũng tự hết hạn trong vòng 900 giây.

**Cấp lại huỷ token cũ.** Trước khi ghi token mới, đọc `pwdreset:email:<email>`
và xoá hash cũ nếu có. Nếu không, mỗi lần bấm "gửi lại" sẽ để lại một chìa khoá
còn sống thêm 15 phút nữa.

---

## 5. Hợp đồng API

Cả ba endpoint đều gắn `@WithoutLogin()`, nằm trong `UserHttpController`.

### 5.1 `POST /user/forgot-password`

```ts
class ForgotPasswordDto {
  @Transform(toNormalizedEmail)
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string
}
```

**Trả về `204 No Content` trong mọi trường hợp** — kể cả email không tồn tại,
tài khoản chưa kích hoạt, đang trong cooldown, hay vượt hạn mức IP. Không có
nhánh nào ném ngoại lệ.

Thứ tự thực hiện, và lý do của thứ tự đó:

1. **Bộ đếm IP** — `INCR pwdreset:ip:<ip>`, đặt `EXPIRE 3600` khi giá trị trả về
   là 1. Quá 10 thì dừng, trả 204.
2. **Cooldown theo email** — claim `SET NX EX 60`. Không giành được thì dừng,
   trả 204.
3. **Tra user** — sau hai bước trên. Đây là đúng thứ tự mà
   `resendRegistrationOtp` đang dùng: claim trước khi tra, để email tồn tại và
   email không tồn tại đi qua cùng số lượng thao tác.
4. Không tìm thấy, hoặc `isActive === false` → dừng, trả 204. Tài khoản chưa
   kích hoạt thuộc về luồng `verify-otp`; gửi link đặt lại mật khẩu cho một tài
   khoản chưa bao giờ mở là vô nghĩa.
5. Sinh token, huỷ token cũ, lưu hai key, publish `user.passwordReset`.

**Tại sao cooldown trả 204 chứ không 429.** Đây là chỗ cố ý khác với
`resendRegistrationOtp`. Ở luồng đăng ký, người dùng vừa tự tay yêu cầu mã và
đang nhìn màn hình chờ, nên `429` kèm `retryAfterSeconds` là thông tin hữu ích
cho chính họ. Ở đây thì ngược lại: `429` nói cho người gọi biết "địa chỉ này vừa
xin đặt lại mật khẩu" — một sự thật về tài khoản người khác. Countdown chuyển
hẳn sang phía client, và server im lặng bỏ qua.

### 5.2 `GET /user/reset-password/validate?token=<token>`

```ts
// 200 OK
{ valid: true,  maskedEmail: 'ng****05@gmail.com' }
{ valid: false }
```

Mục đích là để trang đặt lại mật khẩu phân biệt được link hỏng **trước khi** bắt
người dùng gõ xong mật khẩu rồi mới báo lỗi.

`maskedEmail` giữ 2 ký tự đầu và 2 ký tự cuối của phần trước `@`, phần tên miền
để nguyên. Ai cầm token thì đằng nào cũng sắp đổi được mật khẩu, nên che một
phần là đủ — mà vẫn cho họ biết đang đặt lại cho tài khoản nào, thứ có ích khi
một người có nhiều địa chỉ.

Endpoint này **không tiêu thụ token**: nó chỉ đọc, không xoá.

### 5.3 `POST /user/reset-password`

```ts
class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  token: string

  @IsNotEmpty()
  @MaxLength(20, { message: 'Password is too long. Maximum length is $constraint1 characters' })
  @MinLength(6,  { message: 'Password is too short. Minimum length is $constraint1 characters' })
  password: string
}
```

Ràng buộc mật khẩu khớp đúng `RegisterUserDto` — hai đường vào cùng một trường
thì không được có hai luật khác nhau.

Trả `204 No Content` khi thành công.

Token sai hoặc hết hạn → `400` *"Liên kết đặt lại mật khẩu không hợp lệ hoặc đã
hết hạn"*, qua `UserErrors.passwordResetTokenInvalid()`. Một thông điệp duy nhất
cho cả hai trường hợp: phân biệt "sai" với "hết hạn" cho biết token đó đã từng
tồn tại.

**Không chặn đặt lại trùng mật khẩu cũ** — quyết định đã chốt. Người quên mật
khẩu rồi chợt nhớ ra không có lý do gì bị chặn, và bỏ bước này tiết kiệm một lần
`bcrypt.compare`.

Token được tiêu thụ bằng `GETDEL` **trước** khi ghi mật khẩu (xem §4). Sau khi ghi
thành công: xoá chỉ mục ngược, rồi publish
`user.passwordChanged`.

### 5.4 Lỗi mới trong `UserErrors`

```ts
static passwordResetTokenInvalid(): never {
  throw new BadRequestException(
    'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
  )
}
```

---

## 6. Sự kiện và email

user-service **publish**, notification-service **gửi**. Không gọi
`MailerService` trực tiếp trong user-service: `UserModule` chưa import nó, và
một máy chủ SMTP chậm sẽ treo request HTTP mà người dùng đang chờ.

### 6.1 Hằng số mới

```ts
// libs/constant/rmq/routing.ts
USER_PASSWORD_RESET:   'user.passwordReset',
USER_PASSWORD_CHANGED: 'user.passwordChanged',

// libs/constant/rmq/queue.ts
NOTIFICATION_USER_PASSWORD_RESET:   'notification_queue_user_password_reset',
NOTIFICATION_USER_PASSWORD_CHANGED: 'notification_queue_user_password_changed',
```

### 6.2 Payload

```ts
interface UserPasswordResetPayload {
  email: string
  username: string
  token: string      // token THÔ; chỉ bản băm nằm lại trong Redis
  expiresInMinutes: number
}

interface UserPasswordChangedPayload {
  email: string
  username: string
  changedAt: string  // ISO 8601
}
```

**URL do notification-service ghép, không phải user-service.** `FRONTEND_URL` chỉ
được đọc trong `MailerService.getFrontendBaseUrl()`, và user-service không import
`MailerModule` nên không thấy biến đó. Đây cũng đúng khuôn mẫu sẵn có: payload
mang dữ liệu thô, `MailerService` tự dựng liên kết — `sendRegistrationOtp` nhận
`email` rồi ghép `verifyUrl`, `sendMakeFriendNotification` nhận `friendRequestId`
rồi ghép `requestUrl`. Bắt user-service ghép URL sẽ phải thêm `FRONTEND_URL` vào
env của nó và tách logic ghép liên kết ra hai chỗ.

### 6.3 Hai template

**`password-reset.html`** — nút chính "Đặt lại mật khẩu", câu *"Liên kết này hết
hạn sau 15 phút và chỉ dùng được một lần."*, URL dạng văn bản bên dưới cho ứng
dụng mail chặn nút, và dòng *"Nếu bạn không yêu cầu, hãy bỏ qua email này."*

**`password-changed.html`** — *"Mật khẩu của bạn vừa được đổi lúc HH:mm ngày
DD/MM/YYYY."* kèm lối đi khi không phải họ làm.

Email thứ hai không phải trang trí. Nó là **kênh duy nhất** báo cho chủ tài
khoản biết có người vừa đặt lại mật khẩu của họ — và với việc phiên cũ chưa bị
thu hồi (§8), nó càng cần thiết hơn.

Cả hai dựng bằng `render()` sẵn có, nên tự nhận `appUrl`, `appHost`,
`settingsUrl`, `year` và escape HTML cho mọi giá trị.

---

## 7. Giao diện

### 7.1 Route mới

```ts
{ path: '/forgot-password', element: <ForgotPasswordPage /> },
{ path: '/reset-password',  element: <ResetPasswordPage /> },
```

Cả hai nằm ngoài `ProtectedRoute`, cùng cấp với `/auth` và `/verify-otp`. Cả hai
dùng lại khung hai cột của `AuthPage` (panel thương hiệu bên trái, nội dung bên
phải) để ba màn hình xác thực trông như một.

### 7.2 Link "Quên mật khẩu?"

Đặt cùng hàng với nhãn *Mật khẩu*, căn phải — chỗ người dùng nhìn khi mật khẩu
không vào được.

**Lưu ý kỹ thuật.** `useFieldMorph` bản thân đối xứng, nhưng `AuthForm` đang
hardcode `showExtras = !isLogin || leaving`, nên `data-extra` trên thực tế mang
nghĩa "của tab đăng ký". Thêm một phần chỉ hiện ở tab đăng nhập cần cờ thứ hai
đối xứng (`showLoginExtras = isLogin || leaving`) và một tên `data-morph` riêng
— không nhét vào `data-extra` sẵn có, vì làm vậy link sẽ hiện ở cả tab đăng ký.

### 7.3 `/forgot-password` — hai trạng thái

**Nhập email.** Tiêu đề *"Quên mật khẩu?"*, một dòng giải thích, một ô email,
nút *"Gửi liên kết đặt lại"*, link *"Quay lại đăng nhập"* có `ArrowLeft`.

**Đã gửi.** Cùng một khung, đổi nội dung: icon `MailCheck`, *"Kiểm tra hộp thư
của bạn"*, hiện địa chỉ vừa gõ, câu *"Liên kết hết hạn sau 15 phút."*, nút *"Gửi
lại"* khoá 60 giây với số đếm ngược, và link *"Dùng email khác"* quay về trạng
thái trước.

Countdown tái dùng nguyên cơ chế của `VerifyOtp`: ghi mốc thời gian tuyệt đối
vào `localStorage` theo từng địa chỉ, tick so với mốc đó. Tải lại trang không
reset được, và đổi tài khoản không thừa hưởng thời gian chờ của tài khoản trước.

Vì server luôn trả 204, màn hình này hiện ra kể cả khi email không tồn tại —
đúng như thiết kế.

### 7.4 `/reset-password` — ba trạng thái

**Đang kiểm tra.** Gọi `validate` ngay khi vào trang; hiện skeleton, không hiện
form. Tránh việc người dùng gõ xong mật khẩu mới biết link đã chết.

**Link hỏng.** Icon cảnh báo, *"Liên kết không còn hiệu lực"*, giải thích ngắn
(đã dùng rồi, hoặc quá 15 phút), nút chính *"Xin liên kết mới"* → `/forgot-password`.

**Đặt mật khẩu mới.** Hiện `maskedEmail` để người dùng biết đang đổi cho tài
khoản nào. Hai ô: mật khẩu mới (kèm `PasswordStrength`) và xác nhận. Kiểm tra
khớp bằng `.refine()` như `formRegisterScheme`. Thành công →
`navigate('/auth')` kèm toast *"Đặt lại mật khẩu thành công. Hãy đăng nhập
lại."*

### 7.5 Zod schema

```ts
const forgotPasswordScheme = z.object({
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không hợp lệ'),
})

const resetPasswordScheme = z
  .object({
    password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự')
                        .max(20, 'Mật khẩu tối đa 20 ký tự'),
    confirmPassword: z.string().min(6, 'Mật khẩu xác nhận phải có ít nhất 6 ký tự'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  })
```

Đặt cạnh `formLoginScheme` / `formRegisterScheme` trong
`components/AuthForm/scheme.ts` để mọi luật về mật khẩu nằm cùng một chỗ.

---

## 8. Rủi ro đã biết

### 8.1 Phiên cũ vẫn sống sau khi đổi mật khẩu — đã chốt hoãn

JWT của hệ thống là stateless: access token 15 phút, refresh token 7 ngày, không
có denylist và không có mốc thời gian để đối chiếu. Đổi mật khẩu **không** làm
các token đã cấp mất hiệu lực.

Hệ quả: kẻ đã chiếm được tài khoản vẫn đọc và gửi tin nhắn được **tối đa 7 ngày**
kể cả sau khi chủ tài khoản đã đặt lại mật khẩu. Đây là lỗ hổng thật chứ không
phải chi tiết nhỏ — phần lớn giá trị của việc đặt lại mật khẩu nằm ở chỗ đuổi
được kẻ xâm nhập, và ở đây nó không làm được điều đó.

Đã chốt hoãn. Ghi lại cách vá để không rơi mất:

1. Thêm `passwordChangedAt DateTime?` vào model `User` (Prisma, MongoDB — thêm
   trường tuỳ chọn không cần migration dữ liệu).
2. Ghi `new Date()` vào đó trong `resetPassword`.
3. Trong `AuthGuard`, sau khi verify JWT: nếu `payload.iat * 1000 <
   user.passwordChangedAt` thì từ chối. Cần một lần đọc user — hoặc cache mốc
   này trong Redis để khỏi thêm truy vấn DB vào mọi request.

Ước lượng khoảng 30 dòng cộng một lần đọc thêm trên đường xác thực.

Cho tới khi vá, email `password-changed.html` là thứ duy nhất báo cho chủ tài
khoản biết chuyện gì đang xảy ra.

### 8.2 Thời gian phản hồi lệch nhẹ

Nhánh "email tồn tại" làm thêm việc: sinh token, hai lệnh Redis, một lần publish.
Publish là fire-and-forget nên không chờ broker, nhưng chênh lệch vẫn khác 0 và
về lý thuyết đo được. Chấp nhận: dựng một endpoint hằng thời gian thật sự đòi
hỏi đệm độ trễ nhân tạo, phức tạp hơn nhiều so với mức rủi ro ở đây.

### 8.3 Token nằm trong URL

Token đi qua thanh địa chỉ nên vào lịch sử duyệt web, và có thể rò qua header
`Referer` nếu trang đặt lại mật khẩu nhúng tài nguyên từ tên miền khác. Giảm
thiểu: TTL 15 phút, dùng một lần, và trang `/reset-password` không nhúng tài
nguyên ngoài.

Trình duyệt hiện đại đã mặc định `strict-origin-when-cross-origin`, tức là
request sang tên miền khác chỉ gửi origin chứ không gửi đường dẫn và query —
token do đó **đã** được che sẵn. Thêm `<meta name="referrer"
content="strict-origin-when-cross-origin">` không đổi hành vi, mà để ghim mặc
định đó lại phòng khi một trình duyệt cũ hoặc một thay đổi cấu hình sau này làm
hỏng nó.

### 8.4 Hạn mức của Kong quá rộng

`kong.yml` cho 200 request/phút cho mỗi IP trên toàn bộ `/user`. Với một endpoint
gửi email thì con số đó gần như không phải hạn mức. Bộ đếm `pwdreset:ip:<ip>`
(10/giờ) trong thiết kế này mới là lớp chặn thật. Ghi nhận để không nhầm rằng
Kong đã lo phần đó.

---

## 9. Kiểm thử

**Unit — `UserService`**

- `forgotPassword` trả về không ném lỗi với email không tồn tại, và **không**
  publish sự kiện nào
- Tài khoản `isActive: false` → không publish
- Trong cooldown → không publish, không ném lỗi
- Vượt hạn mức IP → không publish, không ném lỗi
- Cấp token lần hai xoá hash của lần đầu
- `resetPassword` với token sai → ném `BadRequestException`
- `resetPassword` thành công → mật khẩu mới verify được bằng `comparePassword`,
  và cả hai key Redis đã bị xoá
- Dùng lại đúng token đó lần thứ hai → ném lỗi

**Unit — DTO** (`user-http.dto.spec.ts` đã có sẵn mẫu)

- `ForgotPasswordDto` chuẩn hoá email về chữ thường và cắt khoảng trắng
- `ResetPasswordDto` từ chối mật khẩu 5 ký tự và 21 ký tự

**E2E** (Playwright, theo bộ 24 case hiện có)

- Từ `/auth` bấm "Quên mật khẩu?" → gửi email → màn "Kiểm tra hộp thư"
- Mở `/reset-password?token=` với token bịa → hiện trạng thái link hỏng
- Luồng đầy đủ với token lấy từ Redis: đặt mật khẩu mới → đăng nhập được bằng
  mật khẩu mới, và **không** đăng nhập được bằng mật khẩu cũ
- Tải lại trang màn "đã gửi" → countdown không quay về 60

---

## 10. Danh sách tệp

**Backend**

| Tệp | Việc |
|---|---|
| `libs/constant/rmq/routing.ts` | + 2 routing key |
| `libs/constant/rmq/queue.ts` | + 2 queue |
| `libs/constant/rmq/payload.ts` | + 2 interface payload |
| `libs/redis/src/redis.service.ts` | + `savePasswordResetToken`, `consumePasswordResetToken`, `peekPasswordResetToken`, `claimPasswordResetSlot`, `countPasswordResetByIp` |
| `libs/mailer/src/mailer.service.ts` | + `sendPasswordReset`, `sendPasswordChanged` |
| `libs/mailer/src/templates/password-reset.html` | mới |
| `libs/mailer/src/templates/password-changed.html` | mới |
| `apps/user/src/http/user-http.dto.ts` | + `ForgotPasswordDto`, `ResetPasswordDto` |
| `apps/user/src/http/user-http.controller.ts` | + 3 route |
| `apps/user/src/user.service.ts` | + `forgotPassword`, `validateResetToken`, `resetPassword` |
| `apps/user/src/errors/user.errors.ts` | + `passwordResetTokenInvalid` |
| `apps/user/src/repositories/user.repository.ts` | + `updatePasswordById` |
| `apps/user/src/rmq/publishers/user-events.publisher.ts` | + 2 publisher |
| `apps/notification/src/rmq/subcribers/notification-subscribers.ts` | + 2 subscriber |
| `apps/notification/src/notification.service.ts` | + 2 handler |

**Frontend**

| Tệp | Việc |
|---|---|
| `src/apis/index.ts` | + `forgotPasswordAPI`, `validateResetTokenAPI`, `resetPasswordAPI` |
| `src/components/AuthForm/scheme.ts` | + 2 schema |
| `src/components/AuthForm/index.tsx` | + link "Quên mật khẩu?" và cờ `showLoginExtras` |
| `src/pages/ForgotPassword/index.tsx` | mới |
| `src/pages/ResetPassword/index.tsx` | mới |
| `src/App.tsx` | + 2 route |

Ước lượng: khoảng 12 tệp backend, 6 tệp frontend, 2 template mail.
