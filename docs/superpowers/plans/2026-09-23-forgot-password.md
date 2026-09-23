# Quên mật khẩu — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng không đăng nhập được có thể đặt lại mật khẩu qua một liên kết dùng một lần gửi tới email.

**Architecture:** user-service sinh token ngẫu nhiên 256 bit, lưu **bản băm SHA-256** vào Redis với TTL 900 giây, rồi phát sự kiện lên RabbitMQ; notification-service nhận sự kiện, tự ghép URL từ `FRONTEND_URL` và gửi mail. Khi người dùng bấm liên kết, user-service tiêu thụ token bằng một lệnh `GETDEL` duy nhất rồi mới ghi mật khẩu mới. Không đổi schema MongoDB, không đụng `AuthGuard`.

**Tech Stack:** NestJS 11 · Prisma 6 + MongoDB · ioredis + Redis 7 · RabbitMQ (`@golevelup/nestjs-rabbitmq`) · Jest 30 + ts-jest · React 19 + Vite + react-hook-form + zod + Tailwind 4 + shadcn/ui

**Spec:** [`docs/superpowers/specs/2026-09-22-forgot-password-design.md`](../specs/2026-09-22-forgot-password-design.md)

## Global Constraints

- **Ngôn ngữ giao diện và thông báo lỗi: tiếng Việt.** Comment code theo đúng thói quen file đang sửa (repo dùng lẫn Anh/Việt) — giải thích *vì sao*, không mô tả lại *cái gì*.
- **Mật khẩu: 6–20 ký tự**, đúng bằng ràng buộc của `RegisterUserDto`. Không được đặt luật khác.
- **TTL token: 900 giây.** Cooldown theo email: **60 giây**. Hạn mức IP: **10 lần / 3600 giây**.
- **`POST /user/forgot-password` trả `204` trong MỌI trường hợp** — email lạ, tài khoản chưa kích hoạt, đang cooldown, vượt hạn mức IP. Không nhánh nào được ném ngoại lệ.
- **Không bao giờ lưu token thô.** Redis chỉ chứa `sha256(token)` dạng hex.
- **Không chặn đặt lại trùng mật khẩu cũ** (đã chốt).
- Email chuẩn hoá bằng `.trim().toLowerCase()` ở mọi tầng, theo `toNormalizedEmail` sẵn có.
- Backend chạy `npm test`, `npm run typecheck`, `npm run lint:check` từ `backend/`. Frontend chạy `npm run typecheck`, `npm run lint`, `npm run build` từ `frontend/`. CI chỉ chạy unit test backend + lint/build frontend — **frontend không có test runner**, nên các task FE nghiệm thu bằng typecheck/lint/build cộng kiểm tra trên trình duyệt.
- Commit theo Conventional Commits, mỗi task một commit.

---

## Cấu trúc tệp

**Backend — tạo mới**

| Tệp | Trách nhiệm |
|---|---|
| `apps/user/src/domain/mask-email.ts` | Một hàm thuần: che email để hiển thị |
| `apps/user/src/domain/mask-email.spec.ts` | Test cho hàm trên |
| `apps/user/src/user.service.password-reset.spec.ts` | Test cho 3 phương thức nghiệp vụ mới |
| `libs/mailer/src/templates/password-reset.html` | Mail chứa liên kết |
| `libs/mailer/src/templates/password-changed.html` | Mail cảnh báo sau khi đổi |

**Backend — sửa**

| Tệp | Thêm gì |
|---|---|
| `libs/redis/src/redis.service.ts` | 5 phương thức token + rate-limit |
| `libs/redis/src/redis.service.spec.ts` | Test cho 5 phương thức đó |
| `libs/mailer/src/mailer.service.ts` | `sendPasswordReset`, `sendPasswordChanged` |
| `libs/mailer/src/mailer.service.spec.ts` | Test 2 mail mới |
| `libs/constant/rmq/routing.ts` · `queue.ts` · `payload.ts` | 2 routing key, 2 queue, 2 payload |
| `apps/user/src/rmq/publishers/user-events.publisher.ts` | 2 publisher |
| `apps/user/src/repositories/user.repository.ts` | `updatePasswordById` |
| `apps/user/src/errors/user.errors.ts` | `passwordResetTokenInvalid` |
| `apps/user/src/user.service.ts` | `forgotPassword`, `validatePasswordResetToken`, `resetPassword` |
| `apps/user/src/http/user-http.dto.ts` + `.spec.ts` | 2 DTO |
| `apps/user/src/http/user-http.controller.ts` | 3 endpoint |
| `apps/user/src/main.ts` | `trust proxy` |
| `apps/notification/src/rmq/subcribers/notification-subscribers.ts` | 2 subscriber |
| `apps/notification/src/notification.service.ts` | 2 handler |

**Frontend — tạo mới**

| Tệp | Trách nhiệm |
|---|---|
| `src/layouts/AuthShell.tsx` | Khung hai cột dùng chung cho 3 trang xác thực |
| `src/hooks/useResendCountdown.ts` | Đếm ngược theo mốc tuyệt đối, bền qua reload |
| `src/pages/ForgotPassword/index.tsx` | Nhập email → đã gửi |
| `src/pages/ResetPassword/index.tsx` | Kiểm tra → hỏng / đặt mật khẩu mới |

**Frontend — sửa**

| Tệp | Thêm gì |
|---|---|
| `src/apis/user.ts` | 3 hàm gọi API |
| `src/components/AuthForm/scheme.ts` | 2 zod schema |
| `src/components/AuthForm/index.tsx` | Link "Quên mật khẩu?" chỉ ở tab đăng nhập |
| `src/pages/Auth/index.tsx` | Dùng `AuthShell` thay vì khung tự viết |
| `src/App.tsx` | 2 route |

---

# PHẦN A — HẠ TẦNG BACKEND

## Task 1: Redis — lưu, tiêu thụ token và hai bộ hạn mức

**Files:**
- Modify: `backend/libs/redis/src/redis.service.ts`
- Test: `backend/libs/redis/src/redis.service.spec.ts`

**Interfaces:**
- Consumes: `REDIS_CLIENT` (ioredis) đã được inject sẵn trong `RedisService`.
- Produces:
  - `savePasswordResetToken(email: string, userId: string, tokenHash: string, ttlSeconds?: number): Promise<void>`
  - `peekPasswordResetToken(tokenHash: string): Promise<string | null>`
  - `consumePasswordResetToken(tokenHash: string): Promise<string | null>`
  - `clearPasswordResetIndex(email: string): Promise<void>`
  - `claimPasswordResetSlot(email: string, cooldownSeconds?: number): Promise<boolean>`
  - `claimPasswordResetIpSlot(ip: string, limit?: number, windowSeconds?: number): Promise<boolean>`

- [ ] **Step 1: Viết test trước**

Thêm khối `describe` mới vào **cuối** `libs/redis/src/redis.service.spec.ts`, ngang cấp với `describe('RedisService', ...)` sẵn có.

**Không** sửa `redisStub` của khối cũ: khối mới dưới đây tự mang stub riêng, nên thêm `getdel`/`incr`/`expire`/`pipeline` vào stub cũ chỉ tạo ra code chết.

```ts
describe('RedisService — token đặt lại mật khẩu', () => {
  let service: RedisService

  const pipelineStub = {
    del: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }
  const client = {
    get: jest.fn().mockResolvedValue(null),
    getdel: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn(() => pipelineStub),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    pipelineStub.del.mockReturnThis()
    pipelineStub.set.mockReturnThis()
    pipelineStub.exec.mockResolvedValue([])
    const module: TestingModule = await Test.createTestingModule({
      providers: [RedisService, { provide: 'REDIS_CLIENT', useValue: client }],
    }).compile()
    service = module.get<RedisService>(RedisService)
  })

  it('lưu token: ghi cả key tra cứu lẫn chỉ mục ngược, cùng TTL 900', async () => {
    await service.savePasswordResetToken('AN@Example.Test ', 'u1', 'hash-new')

    // Email phải được chuẩn hoá trước khi thành tên key.
    expect(client.get).toHaveBeenCalledWith('pwdreset:email:an@example.test')
    expect(pipelineStub.set).toHaveBeenCalledWith(
      'pwdreset:hash-new', 'u1', 'EX', 900,
    )
    expect(pipelineStub.set).toHaveBeenCalledWith(
      'pwdreset:email:an@example.test', 'hash-new', 'EX', 900,
    )
  })

  it('cấp token mới thì token cũ bị xoá ngay', async () => {
    client.get.mockResolvedValueOnce('hash-old')

    await service.savePasswordResetToken('an@example.test', 'u1', 'hash-new')

    expect(pipelineStub.del).toHaveBeenCalledWith('pwdreset:hash-old')
  })

  it('chưa từng có token thì không gọi DEL thừa', async () => {
    client.get.mockResolvedValueOnce(null)

    await service.savePasswordResetToken('an@example.test', 'u1', 'hash-new')

    expect(pipelineStub.del).not.toHaveBeenCalled()
  })

  it('tiêu thụ token dùng GETDEL — đọc và xoá trong một lệnh', async () => {
    client.getdel.mockResolvedValueOnce('u1')

    await expect(service.consumePasswordResetToken('h')).resolves.toBe('u1')

    expect(client.getdel).toHaveBeenCalledWith('pwdreset:h')
    // Tách thành GET rồi DEL sẽ để hở khe cho hai request cùng đi qua.
    expect(client.get).not.toHaveBeenCalled()
    expect(client.del).not.toHaveBeenCalled()
  })

  it('peek chỉ đọc, không tiêu thụ token', async () => {
    client.get.mockResolvedValueOnce('u1')

    await expect(service.peekPasswordResetToken('h')).resolves.toBe('u1')

    expect(client.get).toHaveBeenCalledWith('pwdreset:h')
    expect(client.getdel).not.toHaveBeenCalled()
  })

  it('cooldown theo email: lần đầu giành được, lần sau thua', async () => {
    client.set.mockResolvedValueOnce('OK')
    await expect(service.claimPasswordResetSlot('an@example.test')).resolves.toBe(true)
    expect(client.set).toHaveBeenCalledWith(
      'pwdreset:cooldown:an@example.test', '1', 'EX', 60, 'NX',
    )

    client.set.mockResolvedValueOnce(null)
    await expect(service.claimPasswordResetSlot('an@example.test')).resolves.toBe(false)
  })

  it('hạn mức IP: đặt EXPIRE đúng một lần, ở lần đếm đầu tiên', async () => {
    client.incr.mockResolvedValueOnce(1)
    await expect(service.claimPasswordResetIpSlot('1.2.3.4')).resolves.toBe(true)
    expect(client.expire).toHaveBeenCalledWith('pwdreset:ip:1.2.3.4', 3600)

    client.incr.mockResolvedValueOnce(2)
    await expect(service.claimPasswordResetIpSlot('1.2.3.4')).resolves.toBe(true)
    expect(client.expire).toHaveBeenCalledTimes(1)
  })

  it('hạn mức IP: vượt 10 lần thì từ chối', async () => {
    client.incr.mockResolvedValueOnce(11)
    await expect(service.claimPasswordResetIpSlot('1.2.3.4')).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend && npx jest libs/redis/src/redis.service.spec.ts
```

Kỳ vọng: FAIL — `service.savePasswordResetToken is not a function`.

- [ ] **Step 3: Cài đặt**

Thêm vào `libs/redis/src/redis.service.ts`, đặt ngay sau nhóm `claimOtpResendSlot` để các cơ chế cùng họ nằm cạnh nhau:

```ts
  /* ---------------- Token đặt lại mật khẩu ---------------- */

  /**
   * Token là KEY chứ không phải value.
   *
   * Khác luồng OTP (key là email, value là mã, nên phải so sánh): ở đây người
   * gọi không khai mình là ai, chỉ đưa token. Nên token vừa phải chứng minh
   * quyền vừa phải nói ra chủ nhân — một lần tra là xong cả hai, không có so
   * sánh chuỗi nào để rò thời gian.
   *
   * Chỉ bản băm nằm lại đây. Ai đọc được Redis qua dump, log hay backup cũng
   * không lần ngược ra được token thô để dùng.
   */
  private passwordResetKey(tokenHash: string): string {
    return `pwdreset:${tokenHash}`
  }

  private passwordResetIndexKey(email: string): string {
    return `pwdreset:email:${email.trim().toLowerCase()}`
  }

  private passwordResetCooldownKey(email: string): string {
    return `pwdreset:cooldown:${email.trim().toLowerCase()}`
  }

  private passwordResetIpKey(ip: string): string {
    return `pwdreset:ip:${ip}`
  }

  /**
   * Cấp token mới và giết token cũ của cùng địa chỉ.
   *
   * Không giết thì mỗi lần bấm "gửi lại" để lại thêm một chìa khoá còn sống
   * 15 phút nữa. Chỉ mục ngược tồn tại chỉ để làm được việc này: từ email tìm
   * ra bản băm đang hiệu lực.
   */
  async savePasswordResetToken(
    email: string,
    userId: string,
    tokenHash: string,
    ttlSeconds = 900,
  ): Promise<void> {
    const indexKey = this.passwordResetIndexKey(email)
    const previous = await this.redisClient.get(indexKey)

    const pipeline = this.redisClient.pipeline()
    if (previous) pipeline.del(this.passwordResetKey(previous))
    pipeline.set(this.passwordResetKey(tokenHash), userId, 'EX', ttlSeconds)
    pipeline.set(indexKey, tokenHash, 'EX', ttlSeconds)
    await pipeline.exec()
  }

  /** Chỉ đọc — dùng cho màn kiểm tra liên kết, không được tiêu thụ token. */
  async peekPasswordResetToken(tokenHash: string): Promise<string | null> {
    return await this.redisClient.get(this.passwordResetKey(tokenHash))
  }

  /**
   * Đọc và xoá trong MỘT lệnh.
   *
   * Tách thành GET rồi DEL là hở một khe: hai request mang cùng token có thể
   * cùng vượt qua bước GET trước khi DEL đầu tiên kịp chạy, và token "một lần"
   * dùng được hai lần. GETDEL (Redis 6.2+) đóng khe đó — đúng một caller nhận
   * được userId.
   */
  async consumePasswordResetToken(tokenHash: string): Promise<string | null> {
    return await this.redisClient.getdel(this.passwordResetKey(tokenHash))
  }

  /** Dọn chỉ mục sau khi token đã tiêu thụ. Sót lại cũng vô hại: nó tự hết hạn. */
  async clearPasswordResetIndex(email: string): Promise<void> {
    await this.redisClient.del(this.passwordResetIndexKey(email))
  }

  /**
   * Giành quyền gửi một mail đặt lại mật khẩu cho `email`.
   *
   * Trả `true` khi được gửi. Khác `claimOtpResendSlot` ở chỗ không trả số giây
   * còn lại: endpoint này luôn đáp 204, nên số giây đó không được phép rời
   * khỏi server — nó tiết lộ rằng địa chỉ vừa có người xin đặt lại mật khẩu.
   */
  async claimPasswordResetSlot(
    email: string,
    cooldownSeconds = 60,
  ): Promise<boolean> {
    const won = await this.redisClient.set(
      this.passwordResetCooldownKey(email),
      '1',
      'EX',
      cooldownSeconds,
      'NX',
    )
    return Boolean(won)
  }

  /**
   * Trần theo IP — thứ cooldown theo email không chặn được: một nguồn quét
   * hàng loạt địa chỉ khác nhau, mỗi địa chỉ đúng một lần.
   *
   * EXPIRE chỉ đặt ở lần đếm đầu tiên, nếu không mỗi request lại đẩy cửa sổ
   * lùi thêm một giờ và bộ đếm không bao giờ được reset.
   */
  async claimPasswordResetIpSlot(
    ip: string,
    limit = 10,
    windowSeconds = 3600,
  ): Promise<boolean> {
    const key = this.passwordResetIpKey(ip)
    const count = await this.redisClient.incr(key)
    if (count === 1) await this.redisClient.expire(key, windowSeconds)
    return count <= limit
  }
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

```bash
cd backend && npx jest libs/redis/src/redis.service.spec.ts
```

Kỳ vọng: PASS, 8 test mới.

- [ ] **Step 5: Commit**

```bash
git add backend/libs/redis/src/redis.service.ts backend/libs/redis/src/redis.service.spec.ts
git commit -m "feat(redis): add password reset token storage and rate limit slots"
```

---

## Task 2: Che email để hiển thị

**Files:**
- Create: `backend/apps/user/src/domain/mask-email.ts`
- Test: `backend/apps/user/src/domain/mask-email.spec.ts`

**Interfaces:**
- Produces: `maskEmail(email: string): string`

Màn đặt mật khẩu mới cần cho người dùng biết đang đổi cho tài khoản nào — nhiều người có vài địa chỉ. Ai cầm token thì đằng nào cũng sắp đổi được mật khẩu, nên che một phần là đủ.

- [ ] **Step 1: Viết test trước**

```ts
import { maskEmail } from './mask-email'

describe('maskEmail', () => {
  it('giữ 2 ký tự đầu và 2 ký tự cuối của phần trước @', () => {
    expect(maskEmail('ngminh4205@gmail.com')).toBe('ng******05@gmail.com')
  })

  it('tên ngắn không đủ để che thì thay toàn bộ bằng dấu sao', () => {
    // 4 ký tự trở xuống: giữ 2 đầu + 2 cuối là không che gì cả.
    expect(maskEmail('an@example.test')).toBe('**@example.test')
    expect(maskEmail('abcd@example.test')).toBe('****@example.test')
  })

  it('chuẩn hoá hoa thường và khoảng trắng thừa', () => {
    expect(maskEmail('  NgMinh4205@Gmail.com ')).toBe('ng******05@gmail.com')
  })

  it('chuỗi không phải email thì che sạch, không làm lộ gì', () => {
    expect(maskEmail('khong-phai-email')).toBe('****')
    expect(maskEmail('')).toBe('****')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend && npx jest apps/user/src/domain/mask-email.spec.ts
```

Kỳ vọng: FAIL — `Cannot find module './mask-email'`.

- [ ] **Step 3: Cài đặt**

```ts
/**
 * Che phần trước `@`, giữ 2 ký tự đầu và 2 ký tự cuối.
 *
 * Đủ để chủ tài khoản nhận ra địa chỉ của mình mà không đọc được hết nếu liên
 * kết rơi vào tay người khác. Tên quá ngắn thì che sạch: giữ 2 đầu + 2 cuối
 * của một chuỗi 4 ký tự là không che gì cả.
 */
export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return '****'

  const local = normalized.slice(0, at)
  const domain = normalized.slice(at)

  if (local.length <= 4) return `${'*'.repeat(local.length)}${domain}`

  const stars = '*'.repeat(local.length - 4)
  return `${local.slice(0, 2)}${stars}${local.slice(-2)}${domain}`
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

```bash
cd backend && npx jest apps/user/src/domain/mask-email.spec.ts
```

Kỳ vọng: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/user/src/domain/mask-email.ts backend/apps/user/src/domain/mask-email.spec.ts
git commit -m "feat(user): add maskEmail helper for reset password screen"
```

---

## Task 3: Hằng số RMQ, payload và publisher

**Files:**
- Modify: `backend/libs/constant/rmq/routing.ts`
- Modify: `backend/libs/constant/rmq/queue.ts`
- Modify: `backend/libs/constant/rmq/payload.ts`
- Modify: `backend/apps/user/src/rmq/publishers/user-events.publisher.ts`

**Interfaces:**
- Consumes: `EXCHANGE_RMQ.USER_EVENTS`, hàm `publish` riêng tư sẵn có của `UserEventsPublisher`.
- Produces:
  - `ROUTING_RMQ.USER_PASSWORD_RESET = 'user.passwordReset'`
  - `ROUTING_RMQ.USER_PASSWORD_CHANGED = 'user.passwordChanged'`
  - `QUEUE_RMQ.NOTIFICATION_USER_PASSWORD_RESET = 'notification_queue_user_password_reset'`
  - `QUEUE_RMQ.NOTIFICATION_USER_PASSWORD_CHANGED = 'notification_queue_user_password_changed'`
  - `interface UserPasswordResetPayload { email: string; username: string; token: string; expiresInMinutes: number }`
  - `interface UserPasswordChangedPayload { email: string; username: string; changedAt: string }`
  - `publishUserPasswordReset(payload: UserPasswordResetPayload): void`
  - `publishUserPasswordChanged(payload: UserPasswordChangedPayload): void`

Task này là khai báo kiểu và hằng số, không có hành vi riêng để test — nó được nghiệm thu qua typecheck và qua test của Task 6 và Task 5 vốn dùng tới nó.

- [ ] **Step 1: Thêm routing key**

Trong `libs/constant/rmq/routing.ts`, thêm ngay dưới `USER_REGISTER_OTP` để các sự kiện về tài khoản nằm cạnh nhau:

```ts
  USER_PASSWORD_RESET: 'user.passwordReset',
  USER_PASSWORD_CHANGED: 'user.passwordChanged',
```

- [ ] **Step 2: Thêm tên queue**

Trong `libs/constant/rmq/queue.ts`, thêm dưới `NOTIFICATION_USER_REGISTER_OTP`:

```ts
  NOTIFICATION_USER_PASSWORD_RESET: 'notification_queue_user_password_reset',
  NOTIFICATION_USER_PASSWORD_CHANGED:
    'notification_queue_user_password_changed',
```

- [ ] **Step 3: Thêm payload**

Trong `libs/constant/rmq/payload.ts`, thêm dưới `UserRegisterOtpPayload`:

```ts
/**
 * Token đi ở dạng THÔ trong payload; chỉ bản băm nằm lại trong Redis.
 *
 * URL do notification-service ghép chứ không phải user-service: `FRONTEND_URL`
 * chỉ được đọc trong `MailerService`, và user-service không import
 * `MailerModule`. Đây cũng đúng khuôn mẫu sẵn có — `sendRegistrationOtp` nhận
 * `email` rồi tự ghép `verifyUrl`.
 */
export interface UserPasswordResetPayload {
  email: string
  username: string
  token: string
  expiresInMinutes: number
}

export interface UserPasswordChangedPayload {
  email: string
  username: string
  /** ISO 8601 */
  changedAt: string
}
```

- [ ] **Step 4: Thêm publisher**

Trong `apps/user/src/rmq/publishers/user-events.publisher.ts`, bổ sung import:

```ts
  UserPasswordResetPayload,
  UserPasswordChangedPayload,
```

vào khối `from 'libs/constant/rmq/payload'`, rồi thêm hai phương thức dưới `publishUserRegisterOtp`:

```ts
  publishUserPasswordReset(payload: UserPasswordResetPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_PASSWORD_RESET,
      payload,
    )
  }

  publishUserPasswordChanged(payload: UserPasswordChangedPayload): void {
    this.publish(
      EXCHANGE_RMQ.USER_EVENTS,
      ROUTING_RMQ.USER_PASSWORD_CHANGED,
      payload,
    )
  }
```

- [ ] **Step 5: Typecheck và commit**

```bash
cd backend && npm run typecheck
```

Kỳ vọng: không lỗi.

```bash
git add backend/libs/constant/rmq backend/apps/user/src/rmq/publishers/user-events.publisher.ts
git commit -m "feat(rmq): add password reset and password changed events"
```

---

## Task 4: Hai template mail và hai phương thức gửi

**Files:**
- Create: `backend/libs/mailer/src/templates/password-reset.html`
- Create: `backend/libs/mailer/src/templates/password-changed.html`
- Modify: `backend/libs/mailer/src/mailer.service.ts`
- Test: `backend/libs/mailer/src/mailer.service.spec.ts`

**Interfaces:**
- Consumes: `render()`, `send()`, `buildFrontendUrl()` riêng tư sẵn có; biến chung `appUrl`, `appHost`, `settingsUrl`, `year` do `render()` tự bơm.
- Produces:
  - `sendPasswordReset(data: { email: string; username: string; token: string; expiresInMinutes: number }): Promise<void>`
  - `sendPasswordChanged(data: { email: string; username: string; changedAt: string }): Promise<void>`

- [ ] **Step 1: Viết test trước**

Trong `libs/mailer/src/mailer.service.spec.ts`, thêm vào hàm `sendAll()` sẵn có:

```ts
    await service.sendPasswordReset({
      email: 'an@example.test',
      username: 'an',
      token: 'kJ7-xQ2mN4pR8sT1vW3yZ5aB6cD9eF0gH2iJ4kL6mN8',
      expiresInMinutes: 15,
    })
    await service.sendPasswordChanged({
      email: 'an@example.test',
      username: 'an',
      changedAt: '2026-09-23T08:30:00.000Z',
    })
```

Rồi thêm khối test mới ở cuối file, bên trong `describe('MailerService', ...)`:

```ts
  describe('mail đặt lại mật khẩu', () => {
    it('ghép liên kết từ FRONTEND_URL và mang đúng token', async () => {
      await service.sendPasswordReset({
        email: 'an@example.test',
        username: 'an',
        token: 'kJ7-xQ2mN4pR8sT1vW3yZ5aB6cD9eF0gH2iJ4kL6mN8',
        expiresInMinutes: 15,
      })

      const mail = lastMail()
      expect(mail.to).toBe('an@example.test')
      expect(mail.html).toContain(
        'https://chat.example.test/reset-password?token=kJ7-xQ2mN4pR8sT1vW3yZ5aB6cD9eF0gH2iJ4kL6mN8',
      )
    })

    it('base64url đi qua encodeURIComponent nguyên vẹn, không sinh %2B %2F %3D', async () => {
      await service.sendPasswordReset({
        email: 'an@example.test',
        username: 'an',
        token: 'aB-_09zZ',
        expiresInMinutes: 15,
      })

      expect(lastMail().html).toContain('?token=aB-_09zZ')
      expect(lastMail().html).not.toContain('%2B')
      expect(lastMail().html).not.toContain('%2F')
    })

    it('nói rõ thời hạn để người nhận biết mình có bao lâu', async () => {
      await service.sendPasswordReset({
        email: 'an@example.test',
        username: 'an',
        token: 'tok',
        expiresInMinutes: 15,
      })

      expect(lastMail().html).toContain('15 phút')
    })

    it('mail cảnh báo mang mốc thời gian theo giờ Việt Nam', async () => {
      await service.sendPasswordChanged({
        email: 'an@example.test',
        username: 'an',
        changedAt: '2026-09-23T08:30:00.000Z',
      })

      const mail = lastMail()
      // 08:30 UTC = 15:30 giờ Việt Nam.
      expect(mail.html).toContain('15:30')
      expect(mail.html).toContain('23/09/2026')
    })

    it('không có placeholder {{...}} nào sót lại', async () => {
      await sendAll()
      for (const call of sendMail.mock.calls) {
        expect(call[0].html).not.toMatch(/\{\{\s*\w+\s*\}\}/)
      }
    })
  })
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend && npx jest libs/mailer/src/mailer.service.spec.ts
```

Kỳ vọng: FAIL — `service.sendPasswordReset is not a function`.

- [ ] **Step 3: Tạo `password-reset.html`**

Chép nguyên `libs/mailer/src/templates/register-otp.html` sang `password-reset.html`:

```bash
cd backend && cp libs/mailer/src/templates/register-otp.html libs/mailer/src/templates/password-reset.html
```

Rồi sửa trong bản chép:

1. Thay khối đoạn văn mở đầu (dòng chứa `Chào {{name}}, nhập mã dưới đây`) — giữ nguyên mọi thuộc tính `class` và `style`, chỉ đổi phần chữ thành:

```
Chào {{name}}, có người vừa yêu cầu đặt lại mật khẩu cho tài khoản DALN&nbsp;Chat của bạn. Bấm nút bên dưới để đặt mật khẩu mới.
```

2. Xoá toàn bộ khối hiển thị mã OTP — thẻ `<p class="otp t-code" ...>{{otp}}</p>` cùng hàng `<td>` bao quanh nó.

3. Thay `{{verifyUrl}}` bằng `{{resetUrl}}` ở **cả hai** chỗ: trong `<v:roundrect href="...">` (bản cho Outlook) và trong `<a href="...">`. Đổi chữ trên nút thành `Đặt lại mật khẩu`.

4. Ngay dưới nút, thêm một hàng mới cho thời hạn và bản URL dạng chữ — có ứng dụng mail chặn nút bấm:

```html
<tr>
  <td align="center" style="padding: 16px 0 0">
    <p class="t-muted" style="margin: 0 0 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 20px; color: #646878">Liên kết này hết hạn sau {{minutes}} phút và chỉ dùng được một lần.</p>
    <p class="t-muted" style="margin: 0; font-family: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; color: #646878; word-break: break-all">{{resetUrl}}</p>
  </td>
</tr>
```

5. Thay dòng chân trang `Email này được gửi tới {{email}} vì địa chỉ này vừa được dùng để đăng ký DALN&nbsp;Chat.` thành:

```
Email này được gửi tới {{email}} vì có yêu cầu đặt lại mật khẩu. Nếu không phải bạn, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.
```

- [ ] **Step 4: Tạo `password-changed.html`**

```bash
cd backend && cp libs/mailer/src/templates/password-reset.html libs/mailer/src/templates/password-changed.html
```

Sửa trong bản chép:

1. Đoạn mở đầu:

```
Chào {{name}}, mật khẩu tài khoản DALN&nbsp;Chat của bạn vừa được đổi lúc {{changedAt}}.
```

2. Nút: đổi `{{resetUrl}}` thành `{{appUrl}}` ở cả hai chỗ, chữ trên nút thành `Mở DALN Chat`.

3. Xoá hẳn hàng thời hạn + URL dạng chữ đã thêm ở Step 3 (mail này không có liên kết nào cần thời hạn).

4. Chân trang:

```
Nếu không phải bạn đổi mật khẩu, hãy đặt lại mật khẩu ngay và kiểm tra hộp thư {{email}}.
```

- [ ] **Step 5: Thêm hai phương thức vào `MailerService`**

Thêm vào cuối class `MailerService`, sau `sendRegistrationOtp`:

```ts
  /**
   * Mail mang liên kết đặt lại mật khẩu.
   *
   * URL ghép ở đây chứ không phải ở user-service: `FRONTEND_URL` chỉ sống
   * trong service này, và đây là khuôn mẫu `sendRegistrationOtp` đang dùng.
   *
   * `encodeURIComponent` để lại token base64url nguyên vẹn — bảng chữ cái của
   * nó (A–Z a–z 0–9 - _) không có ký tự nào cần mã hoá. Vẫn gọi để lỡ sau này
   * đổi cách sinh token thì URL không hỏng.
   */
  async sendPasswordReset(data: {
    email: string
    username: string
    token: string
    expiresInMinutes: number
  }) {
    const html = this.render('password-reset.html', {
      name: data.username,
      email: data.email,
      minutes: String(data.expiresInMinutes),
      resetUrl: this.buildFrontendUrl(
        `/reset-password?token=${encodeURIComponent(data.token)}`,
      ),
    })
    await this.send(data.email, 'Đặt lại mật khẩu DALN Chat', html)
  }

  /**
   * Mail này không phải trang trí: nó là kênh DUY NHẤT báo cho chủ tài khoản
   * biết có người vừa đặt lại mật khẩu của họ. Càng cần thiết khi phiên đăng
   * nhập cũ chưa bị thu hồi (xem §8.1 của spec).
   */
  async sendPasswordChanged(data: {
    email: string
    username: string
    changedAt: string
  }) {
    const html = this.render('password-changed.html', {
      name: data.username,
      email: data.email,
      changedAt: new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(data.changedAt)),
    })
    await this.send(data.email, 'Mật khẩu DALN Chat vừa được đổi', html)
  }
```

- [ ] **Step 6: Chạy test, xác nhận xanh**

```bash
cd backend && npx jest libs/mailer/src/mailer.service.spec.ts
```

Kỳ vọng: PASS. Nếu test mốc thời gian đỏ, in ra `lastMail().html` để xem `Intl` định dạng thành gì rồi chỉnh kỳ vọng cho khớp — **không** đổi múi giờ sang UTC.

- [ ] **Step 7: Commit**

```bash
git add backend/libs/mailer/src
git commit -m "feat(mailer): add password reset and password changed emails"
```

---

## Task 5: notification-service nhận và gửi

**Files:**
- Modify: `backend/apps/notification/src/rmq/subcribers/notification-subscribers.ts`
- Modify: `backend/apps/notification/src/notification.service.ts`
- Test: `backend/apps/notification/src/notification.service.spec.ts`

**Interfaces:**
- Consumes: `ROUTING_RMQ.USER_PASSWORD_RESET/CHANGED`, `QUEUE_RMQ.NOTIFICATION_USER_PASSWORD_RESET/CHANGED`, `UserPasswordResetPayload`, `UserPasswordChangedPayload` (Task 3); `MailerService.sendPasswordReset/sendPasswordChanged` (Task 4).
- Produces: `NotificationService.handleUserPasswordReset(data)`, `NotificationService.handleUserPasswordChanged(data)`

Hai mail này **không** đi qua `deliver()` như thông báo kết bạn: chúng là mail bảo mật bắt buộc, không phải thông báo người dùng được tắt trong phần cài đặt. Chúng đi thẳng tới `MailerService`, giống hệt `handleUserRegisterOtp`.

- [ ] **Step 1: Viết test trước**

Mở `apps/notification/src/notification.service.spec.ts`, xem cách file đang dựng `NotificationService` và stub `MailerService`, rồi thêm khối test theo đúng khuôn mẫu đó:

```ts
  describe('mail đặt lại mật khẩu', () => {
    it('chuyển thẳng payload sang MailerService, không qua cài đặt thông báo', async () => {
      await service.handleUserPasswordReset({
        email: 'an@example.test',
        username: 'an',
        token: 'tok',
        expiresInMinutes: 15,
      })

      expect(mailerService.sendPasswordReset).toHaveBeenCalledWith({
        email: 'an@example.test',
        username: 'an',
        token: 'tok',
        expiresInMinutes: 15,
      })
    })

    it('mail cảnh báo cũng đi thẳng — người dùng không tắt được nó', async () => {
      await service.handleUserPasswordChanged({
        email: 'an@example.test',
        username: 'an',
        changedAt: '2026-09-23T08:30:00.000Z',
      })

      expect(mailerService.sendPasswordChanged).toHaveBeenCalledTimes(1)
    })
  })
```

Bổ sung `sendPasswordReset: jest.fn()` và `sendPasswordChanged: jest.fn()` vào stub `MailerService` của file.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend && npx jest apps/notification/src/notification.service.spec.ts
```

Kỳ vọng: FAIL — `service.handleUserPasswordReset is not a function`.

- [ ] **Step 3: Thêm handler**

Trong `apps/notification/src/notification.service.ts`, thêm ngay dưới `handleUserRegisterOtp`:

```ts
  /**
   * Mail bảo mật, không phải thông báo: không đi qua `deliver()` và không đọc
   * cài đặt kênh. Người dùng tắt email thông báo vẫn phải nhận được liên kết
   * đặt lại mật khẩu, nếu không họ mất luôn đường vào tài khoản.
   */
  async handleUserPasswordReset(data: UserPasswordResetPayload) {
    await this.mailerService.sendPasswordReset(data)
  }

  async handleUserPasswordChanged(data: UserPasswordChangedPayload) {
    await this.mailerService.sendPasswordChanged(data)
  }
```

Thêm hai kiểu này vào khối import payload sẵn có ở đầu file.

- [ ] **Step 4: Thêm subscriber**

Trong `apps/notification/src/rmq/subcribers/notification-subscribers.ts`, thêm dưới `handleUserRegisterOtp`:

```ts
  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_PASSWORD_RESET,
    queue: QUEUE_RMQ.NOTIFICATION_USER_PASSWORD_RESET,
  })
  async handleUserPasswordReset(data: UserPasswordResetPayload): Promise<void> {
    await this.notificationService.handleUserPasswordReset(data)
  }

  @RabbitSubscribeWithRetry({
    exchange: EXCHANGE_RMQ.USER_EVENTS,
    routingKey: ROUTING_RMQ.USER_PASSWORD_CHANGED,
    queue: QUEUE_RMQ.NOTIFICATION_USER_PASSWORD_CHANGED,
  })
  async handleUserPasswordChanged(
    data: UserPasswordChangedPayload,
  ): Promise<void> {
    await this.notificationService.handleUserPasswordChanged(data)
  }
```

Bổ sung hai kiểu payload vào khối import của file.

- [ ] **Step 5: Chạy test, xác nhận xanh**

```bash
cd backend && npx jest apps/notification && npm run typecheck
```

Kỳ vọng: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/notification/src
git commit -m "feat(notification): consume password reset and changed events"
```

---

# PHẦN B — NGHIỆP VỤ BACKEND

## Task 6: `forgotPassword`

**Files:**
- Modify: `backend/apps/user/src/repositories/user.repository.ts`
- Modify: `backend/apps/user/src/errors/user.errors.ts`
- Modify: `backend/apps/user/src/user.service.ts`
- Test: `backend/apps/user/src/user.service.password-reset.spec.ts` (tạo mới)

**Interfaces:**
- Consumes: `RedisService.claimPasswordResetIpSlot / claimPasswordResetSlot / savePasswordResetToken` (Task 1); `UserEventsPublisher.publishUserPasswordReset` (Task 3).
- Produces:
  - `UserRepository.updatePasswordById(id: string, password: string)`
  - `UserErrors.passwordResetTokenInvalid(): never`
  - `UserService.forgotPassword(data: { email: string; ip?: string }): Promise<void>`

- [ ] **Step 1: Viết test trước**

Tạo `apps/user/src/user.service.password-reset.spec.ts`. Thứ tự tham số của constructor `UserService` là: `userRepo, friendRequestRepo, friendShipRepo, jwtService, utilService, eventsPublisher, s3StorageService, redisService, logger, prisma`.

```ts
import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { UserService } from './user.service'

const activeUser = {
  id: '6aa55a491bea4834e8549a01',
  email: 'an@example.test',
  username: 'an',
  password: 'hash-cu',
  isActive: true,
}

function setup(user: typeof activeUser | null = activeUser) {
  const userRepo = {
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    updatePasswordById: jest.fn().mockResolvedValue(user),
  }
  const utilService = {
    hashPassword: jest.fn().mockResolvedValue('hash-moi'),
  }
  const eventsPublisher = {
    publishUserPasswordReset: jest.fn(),
    publishUserPasswordChanged: jest.fn(),
  }
  const redisService = {
    claimPasswordResetIpSlot: jest.fn().mockResolvedValue(true),
    claimPasswordResetSlot: jest.fn().mockResolvedValue(true),
    savePasswordResetToken: jest.fn().mockResolvedValue(undefined),
    peekPasswordResetToken: jest.fn().mockResolvedValue(null),
    consumePasswordResetToken: jest.fn().mockResolvedValue(null),
    clearPasswordResetIndex: jest.fn().mockResolvedValue(undefined),
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  const service = new UserService(
    userRepo as never,
    {} as never,
    {} as never,
    {} as never,
    utilService as never,
    eventsPublisher as never,
    {} as never,
    redisService as never,
    logger as never,
    {} as never,
  )
  return { service, userRepo, utilService, eventsPublisher, redisService }
}

describe('UserService.forgotPassword', () => {
  it('đường hạnh phúc: lưu BẢN BĂM của token, phát sự kiện mang token THÔ', async () => {
    const { service, eventsPublisher, redisService } = setup()

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    const published = eventsPublisher.publishUserPasswordReset.mock.calls[0][0]
    expect(published.email).toBe('an@example.test')
    expect(published.username).toBe('an')
    expect(published.expiresInMinutes).toBe(15)
    expect(typeof published.token).toBe('string')

    const [email, userId, tokenHash] =
      redisService.savePasswordResetToken.mock.calls[0]
    expect(email).toBe('an@example.test')
    expect(userId).toBe(activeUser.id)
    // Redis chỉ được thấy bản băm, không bao giờ thấy token thô.
    expect(tokenHash).toBe(
      createHash('sha256').update(published.token).digest('hex'),
    )
    expect(tokenHash).not.toBe(published.token)
  })

  it('token có đủ entropy và an toàn trong URL', async () => {
    const { service, eventsPublisher } = setup()

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })
    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    const [a, b] = eventsPublisher.publishUserPasswordReset.mock.calls.map(
      (call) => call[0].token as string,
    )
    expect(a).not.toBe(b)
    expect(a).toHaveLength(43) // 32 byte base64url
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('email lạ: im lặng, không phát sự kiện, không ném lỗi', async () => {
    const { service, eventsPublisher } = setup(null)

    await expect(
      service.forgotPassword({ email: 'ai-do@example.test', ip: '1.2.3.4' }),
    ).resolves.toBeUndefined()

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })

  it('tài khoản chưa kích hoạt: không gửi — đó là việc của luồng verify-otp', async () => {
    const { service, eventsPublisher } = setup({ ...activeUser, isActive: false })

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })

  it('đang cooldown: im lặng, và KHÔNG tra cơ sở dữ liệu', async () => {
    const { service, userRepo, eventsPublisher, redisService } = setup()
    redisService.claimPasswordResetSlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
    // Claim trước khi tra: email có thật và không có thật phải đi qua cùng
    // số lượng thao tác, nếu không thời gian phản hồi tố cáo sự khác biệt.
    expect(userRepo.findByEmail).not.toHaveBeenCalled()
  })

  it('vượt hạn mức IP: im lặng, và không tiêu tốn cả slot cooldown', async () => {
    const { service, eventsPublisher, redisService } = setup()
    redisService.claimPasswordResetIpSlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
    expect(redisService.claimPasswordResetSlot).not.toHaveBeenCalled()
  })

  it('không xác định được IP thật thì bỏ qua hạn mức IP, không khoá người dùng', async () => {
    const { service, eventsPublisher, redisService } = setup()

    await service.forgotPassword({ email: 'an@example.test' })

    // Fail-open: đoán sai IP mà khoá cứng là tự chặn chính người dùng của mình.
    expect(redisService.claimPasswordResetIpSlot).not.toHaveBeenCalled()
    expect(eventsPublisher.publishUserPasswordReset).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend && npx jest apps/user/src/user.service.password-reset.spec.ts
```

Kỳ vọng: FAIL — `service.forgotPassword is not a function`.

- [ ] **Step 3: Thêm `updatePasswordById` vào repository**

Trong `apps/user/src/repositories/user.repository.ts`, thêm ngay dưới `activateByEmail`:

```ts
  async updatePasswordById(id: string, password: string) {
    return await this.prisma.user.update({
      where: { id },
      data: { password },
    })
  }
```

- [ ] **Step 4: Thêm lỗi mới**

Trong `apps/user/src/errors/user.errors.ts`, thêm dưới `otpInvalidOrExpired`:

```ts
  /**
   * Một thông điệp duy nhất cho cả token sai lẫn token hết hạn: phân biệt hai
   * trường hợp là nói cho người gọi biết token đó đã từng tồn tại.
   */
  static passwordResetTokenInvalid(): never {
    throw new BadRequestException(
      'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
    )
  }
```

- [ ] **Step 5: Cài đặt `forgotPassword`**

Ở đầu `apps/user/src/user.service.ts`, thêm import:

```ts
import { createHash, randomBytes } from 'node:crypto'
```

Thêm hằng số cạnh `SEARCH_LIMIT`:

```ts
/** Liên kết đặt lại mật khẩu sống bao lâu. Khớp TTL của key trong Redis. */
const PASSWORD_RESET_TTL_MINUTES = 15
```

Thêm interface cạnh các interface request khác:

```ts
interface ForgotPasswordRequest {
  email: string
  /** IP người gọi, nếu xác định được. Xem `forgotPassword`. */
  ip?: string
}
```

Thêm các phương thức sau vào class, đặt ngay dưới `resendRegistrationOtp` để cả họ "gửi lại thứ gì đó qua mail" nằm cạnh nhau:

```ts
  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /**
   * Sinh token đặt lại mật khẩu.
   *
   * `randomBytes` chứ không phải `Math.random`: cái sau không phải bộ sinh số
   * ngẫu nhiên mật mã — trạng thái nội bộ của nó khôi phục được từ vài giá trị
   * đầu ra, và đoán được trạng thái là đoán được mọi token sinh sau đó.
   *
   * `base64url` chứ không phải `hex` hay `base64`: bảng chữ cái của nó không có
   * ký tự nào `encodeURIComponent` phải mã hoá, nên token vào URL nguyên vẹn;
   * và 32 byte chỉ tốn 43 ký tự thay vì 64 như hex.
   */
  private generateResetToken(): string {
    return randomBytes(32).toString('base64url')
  }

  /**
   * Gửi liên kết đặt lại mật khẩu.
   *
   * KHÔNG BAO GIỜ ném lỗi và không bao giờ trả về gì khác nhau. Mọi nhánh —
   * email lạ, tài khoản chưa kích hoạt, đang cooldown, vượt hạn mức — đều kết
   * thúc bằng `return` im lặng, để người gọi không phân biệt được địa chỉ nào
   * có tài khoản.
   *
   * Thứ tự các bước là một phần của bảo đảm đó: claim trước, tra sau. Tra cơ
   * sở dữ liệu rồi mới claim thì hai nhánh tiêu tốn số thao tác khác nhau và
   * thời gian phản hồi tố cáo sự khác biệt.
   */
  async forgotPassword(data: ForgotPasswordRequest): Promise<void> {
    // Không dựng được IP nào thì bỏ qua lớp này thay vì chặn: cooldown theo
    // email mới là lớp bảo vệ chính và nó không phụ thuộc IP.
    //
    // Lưu ý: nhánh này KHÔNG cứu được trường hợp `trust proxy` cấu hình sai —
    // lúc đó mọi request đều mang cùng một IP nội bộ của Kong, `data.ip` vẫn
    // có giá trị, và hạn mức biến thành trần toàn cục 10 lần/giờ cho cả hệ
    // thống. Chỉ kiểm tra key `pwdreset:ip:*` sau khi triển khai mới phát hiện
    // được, nên đừng bỏ bước đó.
    if (data.ip && !(await this.redisService.claimPasswordResetIpSlot(data.ip))) {
      this.logger.warn('[user.forgot-password] ip rate limit hit', { ip: data.ip })
      return
    }

    if (!(await this.redisService.claimPasswordResetSlot(data.email))) return

    const user = await this.userRepo.findByEmail(data.email)

    // Tài khoản chưa kích hoạt thuộc về luồng verify-otp: gửi liên kết đặt lại
    // mật khẩu cho một tài khoản chưa bao giờ mở là vô nghĩa.
    if (!user || !user.isActive) return

    const token = this.generateResetToken()
    await this.redisService.savePasswordResetToken(
      user.email,
      user.id,
      this.hashResetToken(token),
    )

    this.eventsPublisher.publishUserPasswordReset({
      email: user.email,
      username: user.username,
      token,
      expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
    })
  }
```

- [ ] **Step 6: Chạy test, xác nhận xanh**

```bash
cd backend && npx jest apps/user/src/user.service.password-reset.spec.ts
```

Kỳ vọng: PASS, 7 test.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/user/src
git commit -m "feat(user): add forgotPassword with enumeration-safe rate limits"
```

---

## Task 7: `validatePasswordResetToken` và `resetPassword`

**Files:**
- Modify: `backend/apps/user/src/user.service.ts`
- Test: `backend/apps/user/src/user.service.password-reset.spec.ts`

**Interfaces:**
- Consumes: `maskEmail` (Task 2); `RedisService.peekPasswordResetToken / consumePasswordResetToken / clearPasswordResetIndex` (Task 1); `UserRepository.updatePasswordById`, `UserErrors.passwordResetTokenInvalid` (Task 6); `UserEventsPublisher.publishUserPasswordChanged` (Task 3).
- Produces:
  - `UserService.validatePasswordResetToken(token: string): Promise<{ valid: boolean; maskedEmail?: string }>`
  - `UserService.resetPassword(data: { token: string; password: string }): Promise<void>`

- [ ] **Step 1: Viết test trước**

Thêm vào `apps/user/src/user.service.password-reset.spec.ts`:

```ts
describe('UserService.validatePasswordResetToken', () => {
  it('token sống: trả valid và email đã che', async () => {
    const { service, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce(activeUser.id)

    await expect(service.validatePasswordResetToken('tok')).resolves.toEqual({
      valid: true,
      maskedEmail: '**@example.test',
    })
  })

  it('chỉ đọc — không được tiêu thụ token', async () => {
    const { service, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce(activeUser.id)

    await service.validatePasswordResetToken('tok')

    expect(redisService.consumePasswordResetToken).not.toHaveBeenCalled()
  })

  it('token chết: trả valid false, không kèm gì khác', async () => {
    const { service, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce(null)

    await expect(service.validatePasswordResetToken('tok')).resolves.toEqual({
      valid: false,
    })
  })

  it('token trỏ tới user đã biến mất: coi như chết', async () => {
    const { service, userRepo, redisService } = setup()
    redisService.peekPasswordResetToken.mockResolvedValueOnce('u-mo-coi')
    userRepo.findById.mockResolvedValueOnce(null)

    await expect(service.validatePasswordResetToken('tok')).resolves.toEqual({
      valid: false,
    })
  })
})

describe('UserService.resetPassword', () => {
  it('đường hạnh phúc: băm mật khẩu mới, ghi, dọn chỉ mục, phát cảnh báo', async () => {
    const { service, userRepo, utilService, eventsPublisher, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce(activeUser.id)

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })

    expect(utilService.hashPassword).toHaveBeenCalledWith('MatKhauMoi1!')
    expect(userRepo.updatePasswordById).toHaveBeenCalledWith(
      activeUser.id,
      'hash-moi',
    )
    expect(redisService.clearPasswordResetIndex).toHaveBeenCalledWith(
      'an@example.test',
    )
    expect(eventsPublisher.publishUserPasswordChanged).toHaveBeenCalledTimes(1)
  })

  it('tiêu thụ token TRƯỚC khi ghi mật khẩu', async () => {
    const { service, userRepo, redisService } = setup()
    const order: string[] = []
    redisService.consumePasswordResetToken.mockImplementationOnce(() => {
      order.push('consume')
      return Promise.resolve(activeUser.id)
    })
    userRepo.updatePasswordById.mockImplementationOnce(() => {
      order.push('write')
      return Promise.resolve(activeUser)
    })

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })

    // Ghi trước rồi mới tiêu thụ là mở lại đúng khe hở mà GETDEL vừa đóng.
    expect(order).toEqual(['consume', 'write'])
  })

  it('token chết: ném 400 và không đụng tới mật khẩu', async () => {
    const { service, userRepo, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce(null)

    await expect(
      service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' }),
    ).rejects.toThrow('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')

    expect(userRepo.updatePasswordById).not.toHaveBeenCalled()
  })

  it('dùng lại đúng token lần hai: lần đầu qua, lần sau ném lỗi', async () => {
    const { service, redisService } = setup()
    redisService.consumePasswordResetToken
      .mockResolvedValueOnce(activeUser.id)
      .mockResolvedValueOnce(null)

    await service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' })
    await expect(
      service.resetPassword({ token: 'tok', password: 'MatKhauMoi2!' }),
    ).rejects.toThrow('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')
  })

  it('token trỏ tới user đã biến mất: ném 400', async () => {
    const { service, userRepo, redisService } = setup()
    redisService.consumePasswordResetToken.mockResolvedValueOnce('u-mo-coi')
    userRepo.findById.mockResolvedValueOnce(null)

    await expect(
      service.resetPassword({ token: 'tok', password: 'MatKhauMoi1!' }),
    ).rejects.toThrow('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend && npx jest apps/user/src/user.service.password-reset.spec.ts
```

Kỳ vọng: FAIL — `service.validatePasswordResetToken is not a function`.

- [ ] **Step 3: Cài đặt**

Thêm import ở đầu `apps/user/src/user.service.ts`:

```ts
import { maskEmail } from './domain/mask-email'
```

Thêm interface cạnh `ForgotPasswordRequest`:

```ts
interface ResetPasswordRequest {
  token: string
  password: string
}
```

Thêm hai phương thức ngay sau `forgotPassword`:

```ts
  /**
   * Kiểm tra liên kết còn sống không, KHÔNG tiêu thụ nó.
   *
   * Tồn tại để trang đặt lại mật khẩu phân biệt được liên kết hỏng trước khi
   * bắt người dùng gõ xong mật khẩu rồi mới báo lỗi.
   *
   * Trả về email đã che: ai cầm token thì đằng nào cũng sắp đổi được mật khẩu,
   * nên che một phần là đủ — mà vẫn cho họ biết đang đặt lại cho tài khoản nào.
   */
  async validatePasswordResetToken(
    token: string,
  ): Promise<{ valid: boolean; maskedEmail?: string }> {
    const userId = await this.redisService.peekPasswordResetToken(
      this.hashResetToken(token),
    )
    if (!userId) return { valid: false }

    const user = await this.userRepo.findById(userId)
    if (!user) return { valid: false }

    return { valid: true, maskedEmail: maskEmail(user.email) }
  }

  /**
   * Đặt mật khẩu mới.
   *
   * Token được tiêu thụ TRƯỚC khi ghi. `consumePasswordResetToken` dùng GETDEL
   * nên đúng một caller nhận được `userId`; ghi trước rồi mới tiêu thụ là mở
   * lại khe hở cho hai request cùng token cùng đổi được mật khẩu.
   *
   * Cố ý KHÔNG chặn đặt lại trùng mật khẩu cũ: người quên mật khẩu rồi chợt
   * nhớ ra không có lý do gì bị chặn.
   */
  async resetPassword(data: ResetPasswordRequest): Promise<void> {
    const userId = await this.redisService.consumePasswordResetToken(
      this.hashResetToken(data.token),
    )
    if (!userId) UserErrors.passwordResetTokenInvalid()

    const user = await this.userRepo.findById(userId)
    if (!user) UserErrors.passwordResetTokenInvalid()

    const hashedPassword = await this.utilService.hashPassword(data.password)
    await this.userRepo.updatePasswordById(user.id, hashedPassword)

    // Chỉ mục ngược chỉ là chỉ mục: xoá hụt cũng vô hại, nó tự hết hạn.
    await this.redisService.clearPasswordResetIndex(user.email)

    this.logger.info('[user.reset-password] password changed', {
      userId: user.id,
    })

    // Kênh DUY NHẤT báo cho chủ tài khoản biết có người vừa đặt lại mật khẩu
    // của họ — càng cần thiết khi phiên đăng nhập cũ chưa bị thu hồi.
    this.eventsPublisher.publishUserPasswordChanged({
      email: user.email,
      username: user.username,
      changedAt: new Date().toISOString(),
    })
  }
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

```bash
cd backend && npx jest apps/user/src/user.service.password-reset.spec.ts
```

Kỳ vọng: PASS, 16 test (7 của Task 6 + 9 mới).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/user/src
git commit -m "feat(user): add reset token validation and password reset"
```

---

## Task 8: DTO, ba endpoint và `trust proxy`

**Files:**
- Modify: `backend/apps/user/src/http/user-http.dto.ts`
- Modify: `backend/apps/user/src/http/user-http.controller.ts`
- Modify: `backend/apps/user/src/main.ts`
- Test: `backend/apps/user/src/http/user-http.dto.spec.ts`

**Interfaces:**
- Consumes: `UserService.forgotPassword / validatePasswordResetToken / resetPassword` (Task 6, 7).
- Produces: `ForgotPasswordDto`, `ResetPasswordDto`, `ValidateResetTokenQueryDto` và ba route HTTP.

**Vì sao phải đụng `main.ts`:** nginx đặt `X-Forwarded-For $proxy_add_x_forwarded_for` rồi Kong thêm một hop nữa, nên chuỗi tới user-service là `client, nginx` với socket là Kong. Express mặc định **không** tin proxy, nên `req.ip` sẽ là IP container của Kong cho *mọi* request — bộ đếm IP sẽ gộp toàn thế giới vào một xô và khoá tất cả sau 10 lần. `trust proxy = 2` bóc đúng hai hop tin cậy đó.

- [ ] **Step 1: Viết test trước cho DTO**

Xem `user-http.dto.spec.ts` để theo đúng khuôn mẫu `plainToInstance` + `validate` của file, rồi thêm:

```ts
describe('ForgotPasswordDto', () => {
  it('chuẩn hoá email về chữ thường và cắt khoảng trắng', async () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: '  NgMinh4205@Gmail.com ',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
    expect(dto.email).toBe('ngminh4205@gmail.com')
  })

  it('email sai định dạng thì không qua', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: 'khong-phai' })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})

describe('ResetPasswordDto', () => {
  it('mật khẩu 6 ký tự là ngắn nhất được chấp nhận', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: '123456',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('5 ký tự thì bị từ chối', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: '12345',
    })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it('21 ký tự thì bị từ chối — khớp đúng ràng buộc của RegisterUserDto', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: 'a'.repeat(21),
    })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it('thiếu token thì bị từ chối', async () => {
    const dto = plainToInstance(ResetPasswordDto, { password: '123456' })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})
```

Bổ sung `ForgotPasswordDto`, `ResetPasswordDto` vào khối import của file spec.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend && npx jest apps/user/src/http/user-http.dto.spec.ts
```

Kỳ vọng: FAIL — không import được `ForgotPasswordDto`.

- [ ] **Step 3: Thêm DTO**

Trong `apps/user/src/http/user-http.dto.ts`, thêm dưới `ResendOtpDto`:

```ts
export class ForgotPasswordDto {
  @Transform(toNormalizedEmail)
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string
}

export class ValidateResetTokenQueryDto {
  @IsNotEmpty()
  @IsString()
  token: string
}

/**
 * Ràng buộc mật khẩu phải khớp ĐÚNG `RegisterUserDto`: hai đường vào cùng một
 * trường thì không được có hai luật khác nhau.
 */
export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  token: string

  @IsNotEmpty()
  @MaxLength(20, {
    message: 'Password is too long. Maximum length is $constraint1 characters',
  })
  @MinLength(6, {
    message: 'Password is too short. Minimum length is $constraint1 characters',
  })
  password: string
}
```

- [ ] **Step 4: Thêm ba endpoint**

Trong `apps/user/src/http/user-http.controller.ts`, thêm `HttpCode`, `HttpStatus`, `Ip` vào import từ `@nestjs/common`, và ba DTO mới vào import từ `./user-http.dto`. Thêm ba route ngay dưới `resendOtp`:

```ts
  /**
   * Luôn trả 204, không ngoại lệ nào.
   *
   * Kể cả khi đang trong cooldown — khác `resend-otp` vốn trả 429 kèm số giây
   * còn lại. Ở luồng đăng ký, người dùng vừa tự tay xin mã và đang chờ nên con
   * số đó có ích cho chính họ; ở đây nó nói cho người gọi biết "địa chỉ này vừa
   * có người xin đặt lại mật khẩu". Countdown chuyển hẳn sang client.
   */
  @Post('forgot-password')
  @WithoutLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    await this.userService.forgotPassword({ email: dto.email, ip })
  }

  @Get('reset-password/validate')
  @WithoutLogin()
  validateResetToken(@Query() query: ValidateResetTokenQueryDto) {
    return this.userService.validatePasswordResetToken(query.token)
  }

  @Post('reset-password')
  @WithoutLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.userService.resetPassword(dto)
  }
```

- [ ] **Step 5: Bật `trust proxy`**

Trong `apps/user/src/main.ts`, đổi dòng tạo app và thêm cấu hình:

```ts
import { NestExpressApplication } from '@nestjs/platform-express'
```

```ts
  const app = await NestFactory.create<NestExpressApplication>(UserModule)

  // Chuỗi proxy thật: client → nginx (thêm IP client vào X-Forwarded-For) →
  // Kong (thêm IP nginx) → service. Không bật thì req.ip là IP container của
  // Kong cho MỌI request, và hạn mức theo IP sẽ khoá toàn bộ người dùng chung
  // một xô. Chạy trực tiếp lúc dev không có X-Forwarded-For nên vẫn đúng.
  app.set('trust proxy', 2)
```

- [ ] **Step 6: Chạy test và typecheck**

```bash
cd backend && npx jest apps/user && npm run typecheck && npm run lint:check
```

Kỳ vọng: PASS, không lỗi.

- [ ] **Step 7: Xác minh IP thật lấy được đúng**

Chạy stack rồi gọi qua Kong và kiểm tra log:

```bash
cd backend && docker compose up -d
curl -i -X POST http://localhost:8080/user/forgot-password \
  -H 'Content-Type: application/json' \
  -H 'X-Forwarded-For: 203.0.113.9' \
  -d '{"email":"khong-ton-tai@example.test"}'
```

Kỳ vọng: `HTTP/1.1 204 No Content`, thân rỗng.

Rồi kiểm tra key trong Redis mang đúng IP giả lập, không phải IP nội bộ của Kong:

```bash
docker compose exec redis redis-cli KEYS 'pwdreset:ip:*'
```

Kỳ vọng: thấy `pwdreset:ip:203.0.113.9`. Nếu thấy một IP dạng `172.x.x.x`, `trust proxy` đang sai số hop — chỉnh lại và chạy lại bước này.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/user/src
git commit -m "feat(user): expose forgot-password, validate and reset endpoints"
```

---

## Task 9: Kiểm tra liên thông toàn backend

**Files:** không sửa file nào — đây là cổng nghiệm thu của Phần A và B.

- [ ] **Step 1: Chạy toàn bộ cổng CI của backend**

```bash
cd backend && npm run typecheck && npm run lint:check && npm test
```

Kỳ vọng: tất cả xanh, không test nào cũ bị vỡ.

- [ ] **Step 2: Chạy thử luồng thật đầu–cuối**

```bash
cd backend && docker compose up -d
```

Tạo một tài khoản đã kích hoạt (hoặc dùng tài khoản sẵn có), rồi:

```bash
curl -i -X POST http://localhost:8080/user/forgot-password \
  -H 'Content-Type: application/json' -d '{"email":"<email-that>"}'
```

Kỳ vọng: 204. Lấy token thô từ mail nhận được (hoặc từ log của notification-service), rồi:

```bash
TOKEN='<token-tu-email>'
curl -s "http://localhost:8080/user/reset-password/validate?token=$TOKEN"
```

Kỳ vọng: `{"valid":true,"maskedEmail":"..."}`.

```bash
curl -i -X POST http://localhost:8080/user/reset-password \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"MatKhauMoi1\"}"
```

Kỳ vọng: 204, và nhận được mail "Mật khẩu DALN Chat vừa được đổi".

- [ ] **Step 3: Xác minh token chỉ dùng được một lần**

Gọi lại đúng lệnh `reset-password` vừa rồi.

Kỳ vọng: `400` với thông điệp `Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn`.

- [ ] **Step 4: Xác minh đăng nhập bằng mật khẩu mới**

```bash
curl -i -X POST http://localhost:8080/user/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<email-that>","password":"MatKhauMoi1"}'
```

Kỳ vọng: 200. Rồi thử lại với mật khẩu cũ — kỳ vọng: 401.

- [ ] **Step 5: Xác minh cấp liên kết mới giết liên kết cũ**

Xin liên kết lần 1, giữ token A. Chờ hơn 60 giây, xin lần 2, giữ token B. Gọi `validate` với A.

Kỳ vọng: `{"valid":false}`. Gọi `validate` với B — kỳ vọng `valid: true`.

- [ ] **Step 6: Commit (nếu có chỉnh sửa phát sinh)**

```bash
git add -A backend
git commit -m "test(user): verify end-to-end password reset flow"
```

---

# PHẦN C — FRONTEND

## Task 10: Lớp gọi API và zod schema

**Files:**
- Modify: `frontend/src/apis/user.ts`
- Modify: `frontend/src/components/AuthForm/scheme.ts`

**Interfaces:**
- Consumes: `api` và `normalizeEmail` sẵn có.
- Produces:
  - `forgotPasswordAPI(data: { email: string })`
  - `validateResetTokenAPI(token: string)` → `{ valid: boolean; maskedEmail?: string }`
  - `resetPasswordAPI(data: { token: string; password: string })`
  - `forgotPasswordScheme`, `resetPasswordScheme`

Frontend không có test runner; task này nghiệm thu bằng typecheck.

- [ ] **Step 1: Thêm ba hàm API**

Trong `frontend/src/apis/user.ts`, thêm ngay dưới `resendOtpAPI`:

```ts
/**
 * Luôn nhận 204 — kể cả email không tồn tại hay đang trong cooldown. Đừng suy
 * ra bất cứ điều gì về tài khoản từ phản hồi này; đó là chủ đích của server.
 * `skipErrorToast` để lỗi mạng không bật toast đè lên màn "đã gửi".
 */
export const forgotPasswordAPI = (data: { email: string }) =>
  api.post(
    "/user/forgot-password",
    { email: normalizeEmail(data.email) },
    { skipErrorToast: true },
  );

export const validateResetTokenAPI = (token: string) =>
  api.get<{ valid: boolean; maskedEmail?: string }>(
    `/user/reset-password/validate?token=${encodeURIComponent(token)}`,
    { skipErrorToast: true },
  );

export const resetPasswordAPI = (data: { token: string; password: string }) =>
  api.post("/user/reset-password", data, { skipErrorToast: true });
```

Chữ ký đã xác minh trong `src/utils/authorizeAxios.ts`: `api.get<T>(url, config?)` và `api.post<T = void>(url, body?, config?)`, cả hai trả thẳng `response.data`. Nên `validateResetTokenAPI` trả về `Promise<{ valid: boolean; maskedEmail?: string }>`, không phải một `AxiosResponse`.

- [ ] **Step 2: Thêm hai schema**

Trong `frontend/src/components/AuthForm/scheme.ts`, thêm trước dòng `export`:

```ts
const forgotPasswordScheme = z.object({
  email: z.string().min(1, "Vui lòng nhập email").email("Email không hợp lệ"),
});

/** Cùng luật với đăng ký — hai đường vào một trường không được khác luật. */
const resetPasswordScheme = z
  .object({
    password: z
      .string()
      .min(6, "Mật khẩu phải có ít nhất 6 ký tự")
      .max(20, "Mật khẩu tối đa 20 ký tự"),
    confirmPassword: z
      .string()
      .min(6, "Mật khẩu xác nhận phải có ít nhất 6 ký tự"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirmPassword"],
  });
```

Và sửa dòng export cuối file thành:

```ts
export {
  formLoginScheme,
  formRegisterScheme,
  forgotPasswordScheme,
  resetPasswordScheme,
};
```

- [ ] **Step 3: Typecheck và commit**

```bash
cd frontend && npm run typecheck && npm run lint
```

```bash
git add frontend/src/apis/user.ts frontend/src/components/AuthForm/scheme.ts
git commit -m "feat(fe): add password reset APIs and validation schemas"
```

---

## Task 11: Khung `AuthShell` và hook đếm ngược

**Files:**
- Create: `frontend/src/layouts/AuthShell.tsx`
- Create: `frontend/src/hooks/useResendCountdown.ts`
- Modify: `frontend/src/pages/Auth/index.tsx`

**Interfaces:**
- Produces:
  - `AuthShell({ children }: { children: React.ReactNode })`
  - `useResendCountdown(key: string, storagePrefix: string)` → `{ seconds: number; start: (seconds?: number) => void }`

`storagePrefix` là tham số chứ không hardcode: Task 17 chuyển `VerifyOtp` sang hook này, và trang đó đang lưu mốc dưới tiền tố `daln:otp-resend-until`. Hardcode một tiền tố duy nhất sẽ khiến người đang chờ dở ở màn OTP lúc triển khai thấy nút "Gửi lại" mở khoá trong khi server vẫn chặn 429.

Ba trang xác thực dùng chung một khung; đó đúng là lúc nên tách. Tách xong `AuthPage` phải trông **y hệt** trước đó.

- [ ] **Step 1: Tạo `AuthShell`**

`frontend/src/pages/Auth/index.tsx` hiện dài 108 dòng. Chuyển sang `AuthShell.tsx`:

- **dòng 1–7** — nguyên khối import, bỏ dòng `import { AuthForm }`
- **dòng 9–26** — nguyên mảng `HIGHLIGHTS`
- **dòng 29–107** — nguyên phần `return (...)` của `AuthPage`, đổi đúng một thứ: thẻ `<AuthForm />` (trong cột form, gần cuối) thành `{children}`

Không đổi một class Tailwind nào, không đổi `staggerStyle`, không đổi thứ tự phần tử — mọi thay đổi ngoài việc thay `<AuthForm />` đều là lỗi ở task này.

```tsx
import { MessagesSquare, ShieldCheck, Sparkles } from "@/components/icons";

import { BrandLockup, BrandMark } from "@/components/Brand";
import { ModeToggle } from "@/components/ModeToggle";
import { staggerStyle } from "@/lib/motion";

const HIGHLIGHTS = [ /* giữ nguyên nội dung mảng đang có trong pages/Auth */ ];

/**
 * Khung chung của mọi trang xác thực: đăng nhập, quên mật khẩu, đặt lại mật
 * khẩu. Ba trang dùng chung một khung nên khung thuộc về layout, không thuộc
 * về trang nào cả.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    /* dán nguyên khối JSX cũ vào đây, chỉ thay <AuthForm /> bằng {children} */
  );
}
```

- [ ] **Step 2: Rút gọn `pages/Auth/index.tsx`**

```tsx
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/layouts/AuthShell";

export default function AuthPage() {
  return (
    <AuthShell>
      <AuthForm />
    </AuthShell>
  );
}
```

- [ ] **Step 3: Xác minh `/auth` không đổi gì về mặt hình ảnh**

```bash
cd frontend && npm run dev
```

Mở `http://localhost:5174/auth`, so sánh với ảnh trong `docs/ui-screenshots/01-auth-login-light.png` và `01-auth-login-dark.png`. Kiểm tra cả hai chế độ sáng/tối và cả bề rộng điện thoại.

Kỳ vọng: giống hệt — panel trái, nút đổi chế độ góc phải trên, animation vào trang, chuyển tab đăng nhập/đăng ký vẫn mượt.

- [ ] **Step 4: Tạo hook đếm ngược**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Đếm ngược theo MỐC THỜI GIAN TUYỆT ĐỐI, không phải bộ đếm giảm dần.
 *
 * Bộ đếm sống trong state React sẽ về 0 khi tải lại trang, tức là bỏ qua được
 * thời gian chờ. Mốc thời gian lưu trong localStorage thì không. Đây vẫn chỉ
 * là phép lịch sự — server mới là nơi thật sự chặn.
 *
 * Mốc lưu theo từng `key` (thường là địa chỉ email) để đổi tài khoản không
 * thừa hưởng thời gian chờ của tài khoản trước. `storagePrefix` là tham số vì
 * mỗi luồng có không gian key riêng — đổi tiền tố của một luồng đang chạy sẽ
 * làm mất thời gian chờ của người đang đợi dở.
 */
export function useResendCountdown(key: string, storagePrefix: string) {
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<number | null>(null);

  const storageKey = key ? `${storagePrefix}:${key}` : "";

  const left = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

  const run = useCallback((until: number) => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    setSeconds(left(until));
    if (left(until) <= 0) return;

    timerRef.current = window.setInterval(() => {
      const remaining = left(until);
      setSeconds(remaining);
      if (remaining <= 0 && timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 500);
  }, []);

  const start = useCallback(
    (duration = 60) => {
      const until = Date.now() + duration * 1000;
      try {
        if (storageKey) window.localStorage.setItem(storageKey, String(until));
      } catch {
        /* chế độ riêng tư: mất phép lịch sự, server vẫn chặn */
      }
      run(until);
    },
    [run, storageKey],
  );

  // Nhặt lại mốc sau khi tải lại trang.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const until = raw ? Number(raw) : 0;
      if (Number.isFinite(until) && until > Date.now()) run(until);
    } catch {
      /* không đọc được thì coi như chưa từng chờ */
    }
  }, [run, storageKey]);

  // Interval bị rò khi component unmount giữa nhịp tick.
  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  return { seconds, start };
}
```

- [ ] **Step 5: Typecheck, lint, build, commit**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

```bash
git add frontend/src/layouts/AuthShell.tsx frontend/src/hooks/useResendCountdown.ts frontend/src/pages/Auth/index.tsx
git commit -m "refactor(fe): extract AuthShell and resend countdown hook"
```

---

## Task 12: Trang `/forgot-password`

**Files:**
- Create: `frontend/src/pages/ForgotPassword/index.tsx`

**Interfaces:**
- Consumes: `AuthShell`, `useResendCountdown` (Task 11); `forgotPasswordAPI`, `forgotPasswordScheme` (Task 10); `Form*`, `Input`, `Button` sẵn có; icon từ `@/components/icons`.
- Produces: default export `ForgotPasswordPage`

Mockup tham chiếu: [`docs/design/forgot-password-ui.html`](../../design/forgot-password-ui.html) màn 1 và màn 2.

- [ ] **Step 1: Viết trang**

```tsx
import { useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { forgotPasswordAPI } from "@/apis";
import { forgotPasswordScheme } from "@/components/AuthForm/scheme";
import { AuthShell } from "@/layouts/AuthShell";
import { useResendCountdown } from "@/hooks/useResendCountdown";
import { ArrowLeft, Loader2, MailCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type Values = z.infer<typeof forgotPasswordScheme>;

/**
 * Hai trạng thái trong CÙNG một khung.
 *
 * Màn "đã gửi" hiện ra kể cả khi email không tồn tại — server trả 204 bất kể
 * thế nào. Vì vậy câu chữ phải là "Nếu địa chỉ này có tài khoản", không được
 * khẳng định là đã gửi đi.
 */
export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordScheme),
    defaultValues: { email: "" },
  });

  // Khoá theo giá trị ĐANG GÕ, không theo `sentTo`.
  //
  // `start()` chạy ngay sau `setSentTo()`, lúc đó state chưa kịp cập nhật — lấy
  // key từ `sentTo` thì hook vẫn đang giữ chuỗi rỗng, mốc thời gian không được
  // ghi xuống đâu cả, và đếm ngược mất sạch sau mỗi lần tải lại trang.
  const typedEmail = form.watch("email").trim().toLowerCase();
  const { seconds, start } = useResendCountdown(
    typedEmail,
    "daln:pwdreset-resend-until",
  );

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await forgotPasswordAPI(values);
      setSentTo(values.email.trim().toLowerCase());
      start(60);
    } finally {
      setSubmitting(false);
    }
  });

  const resend = async () => {
    if (!sentTo || seconds > 0) return;
    await forgotPasswordAPI({ email: sentTo });
    start(60);
  };

  return (
    <AuthShell>
      {sentTo ? (
        <div className="space-y-6">
          <span className="flex size-13 items-center justify-center rounded-full bg-success/12 text-success-text">
            <MailCheck className="size-6.5" aria-hidden="true" />
          </span>
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Kiểm tra hộp thư của bạn
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Nếu địa chỉ này có tài khoản, chúng tôi vừa gửi tới đó một liên
              kết đặt lại mật khẩu.
            </p>
          </div>
          <p className="inline-flex rounded-full bg-muted px-3 py-1.5 font-mono text-sm font-medium">
            {sentTo}
          </p>
          <p className="text-sm text-muted-foreground">
            Không thấy thư? Hãy kiểm tra mục spam. Liên kết hết hạn sau 15 phút.
          </p>
          <div className="space-y-1.5">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={seconds > 0}
              onClick={resend}
            >
              <span role="status">
                {seconds > 0 ? `Gửi lại sau ${seconds} giây` : "Gửi lại"}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setSentTo(null)}
            >
              Dùng email khác
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <Link
            to="/auth"
            className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-(--motion-fast) hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Quay lại đăng nhập
          </Link>
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Quên mật khẩu?
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Nhập email của tài khoản. Chúng tôi sẽ gửi cho bạn một liên kết để
              đặt lại mật khẩu.
            </p>
          </div>
          <Form {...form}>
            <form noValidate onSubmit={submit} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="ban@vidu.com"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Gửi liên kết đặt lại
              </Button>
            </form>
          </Form>
          <p className="text-center text-sm text-muted-foreground">
            Liên kết có hiệu lực trong 15 phút.
          </p>
        </div>
      )}
    </AuthShell>
  );
}
```

Đã xác minh trong `src/components/ui/button.tsx`: cả `outline` lẫn `ghost` đều có sẵn, và `MailCheck`, `ArrowLeft`, `Loader2` đều đã được export từ `src/components/icons.tsx` — không cần thêm gì.

- [ ] **Step 2: Typecheck và lint**

```bash
cd frontend && npm run typecheck && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ForgotPassword
git commit -m "feat(fe): add forgot password page"
```

---

## Task 13: Trang `/reset-password`

**Files:**
- Create: `frontend/src/pages/ResetPassword/index.tsx`

**Interfaces:**
- Consumes: `AuthShell` (Task 11); `validateResetTokenAPI`, `resetPasswordAPI`, `resetPasswordScheme` (Task 10); `PasswordField`, `PasswordStrength` sẵn có.
- Produces: default export `ResetPasswordPage`

Mockup tham chiếu: màn 3, 4, 5.

- [ ] **Step 1: Viết trang**

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";

import { resetPasswordAPI, validateResetTokenAPI } from "@/apis";
import { resetPasswordScheme } from "@/components/AuthForm/scheme";
import {
  PasswordField,
  PasswordStrength,
} from "@/components/AuthForm/PasswordField";
import { AuthShell } from "@/layouts/AuthShell";
import { AlertCircle, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { getErrorMessage } from "@/utils/getErrorMessage";

type Values = z.infer<typeof resetPasswordScheme>;
type Status =
  | { kind: "checking" }
  | { kind: "invalid" }
  | { kind: "ready"; maskedEmail?: string };

/**
 * Kiểm tra token NGAY khi vào trang, trước khi hiện form.
 *
 * Nếu không, người dùng gõ xong mật khẩu rồi mới biết liên kết đã chết — và
 * phải gõ lại từ đầu sau khi xin liên kết mới.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(resetPasswordScheme),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus({ kind: "invalid" });
      return;
    }
    validateResetTokenAPI(token)
      .then((result) => {
        if (cancelled) return;
        setStatus(
          result.valid
            ? { kind: "ready", maskedEmail: result.maskedEmail }
            : { kind: "invalid" },
        );
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await resetPasswordAPI({ token, password: values.password });
      toast.success("Đặt lại mật khẩu thành công. Hãy đăng nhập lại.");
      navigate("/auth");
    } catch (error) {
      // Token có thể chết giữa lúc người dùng đang gõ.
      form.setError("password", { message: getErrorMessage(error) });
      setSubmitting(false);
    }
  });

  if (status.kind === "checking") {
    return (
      <AuthShell>
        <div className="space-y-6" aria-busy="true">
          <div className="size-13 animate-pulse rounded-full bg-muted" />
          <div className="space-y-3">
            <div className="h-6 w-3/4 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-11/12 animate-pulse rounded-lg bg-muted" />
          </div>
          <div className="space-y-4">
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
            <div className="h-11 animate-pulse rounded-lg bg-muted" />
          </div>
          <p
            className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Đang kiểm tra liên kết…
          </p>
        </div>
      </AuthShell>
    );
  }

  if (status.kind === "invalid") {
    return (
      <AuthShell>
        <div className="space-y-6">
          <span className="flex size-13 items-center justify-center rounded-full bg-destructive/12 text-destructive-text">
            <AlertCircle className="size-6.5" aria-hidden="true" />
          </span>
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Liên kết không còn hiệu lực
            </h1>
            {/* Gọi tên đúng nguyên nhân: xin liên kết mới sẽ giết liên kết cũ,
                nên người vừa bấm "Gửi lại" rất dễ rơi vào đây khi họ mở nhầm
                email đầu tiên. "Liên kết không hợp lệ" trống không sẽ khiến họ
                tưởng hệ thống hỏng. */}
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Liên kết đặt lại mật khẩu chỉ dùng được một lần và hết hạn sau 15
              phút. Có thể bạn đã dùng nó rồi, hoặc đã yêu cầu một liên kết mới
              hơn.
            </p>
          </div>
          <div className="space-y-1.5">
            <Button
              type="button"
              className="w-full"
              onClick={() => navigate("/forgot-password")}
            >
              Xin liên kết mới
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate("/auth")}
            >
              Quay lại đăng nhập
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
            Đặt mật khẩu mới
          </h1>
          {status.maskedEmail && (
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Cho tài khoản{" "}
              <strong className="font-semibold text-foreground">
                {status.maskedEmail}
              </strong>
              .
            </p>
          )}
        </div>
        <Form {...form}>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mật khẩu mới</FormLabel>
                  <FormControl>
                    {/* autoComplete="new-password" và cho phép dán: chặn dán là
                        vi phạm WCAG 2.2 Accessible Authentication — nó buộc
                        người dùng trình quản lý mật khẩu gõ tay chuỗi ngẫu nhiên. */}
                    <PasswordField {...field} autoComplete="new-password" />
                  </FormControl>
                  <PasswordStrength value={field.value} />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Xác nhận mật khẩu</FormLabel>
                  <FormControl>
                    <PasswordField {...field} autoComplete="new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              Đặt lại mật khẩu
            </Button>
          </form>
        </Form>
      </div>
    </AuthShell>
  );
}
```

`AlertCircle` và `Loader2` đã có sẵn trong `src/components/icons.tsx` (dòng 139 và 154) — `VerifyOtp` đang import đúng hai icon này. Không cần thêm gì vào barrel.

- [ ] **Step 2: Typecheck, lint, commit**

```bash
cd frontend && npm run typecheck && npm run lint
```

```bash
git add frontend/src/pages/ResetPassword
git commit -m "feat(fe): add reset password page with token pre-check"
```

---

## Task 14: Link "Quên mật khẩu?" và hai route

**Files:**
- Modify: `frontend/src/components/AuthForm/index.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `ForgotPasswordPage` (Task 12), `ResetPasswordPage` (Task 13).

**Điểm dễ sai:** `useFieldMorph` bản thân đối xứng, nhưng `AuthForm` đang tính `showExtras = !isLogin || leaving`, nên `data-extra` trên thực tế mang nghĩa "của tab đăng ký". Nhét link vào `data-extra` sẵn có sẽ làm nó hiện ở **cả tab đăng ký**. Cần một cờ thứ hai đối xứng.

- [ ] **Step 1: Thêm cờ cho phần chỉ-đăng-nhập**

Trong `frontend/src/components/AuthForm/index.tsx`, ngay dưới dòng `const showExtras = ...`:

```tsx
  // Đối xứng với showExtras: phần chỉ tab đăng nhập có, vẫn nằm trên màn hình
  // trong lúc nó rời đi để useFieldMorph kịp diễn hoạt.
  const showLoginExtras = isLogin || leaving;
```

- [ ] **Step 2: Thêm link vào hàng nhãn mật khẩu**

Tìm `FormField` của trường `password` trong file. Thay phần tử `<FormLabel>Mật khẩu</FormLabel>` bằng một hàng có cả nhãn lẫn link:

```tsx
<div className="flex items-center justify-between gap-2">
  <FormLabel>Mật khẩu</FormLabel>
  {showLoginExtras && (
    <Link
      to="/forgot-password"
      className="text-sm font-medium text-brand hover:underline"
    >
      Quên mật khẩu?
    </Link>
  )}
</div>
```

Thêm `import { Link } from "react-router";` vào đầu file.

- [ ] **Step 3: Thêm hai route**

Trong `frontend/src/App.tsx`, thêm vào mảng `createBrowserRouter` ngay sau mục `/verify-otp`:

```tsx
  {
    path: "/forgot-password",
    element: <ForgotPasswordPage />,
  },
  {
    path: "/reset-password",
    element: <ResetPasswordPage />,
  },
```

Thêm import tương ứng ở đầu file, theo đúng cách file đang import `AuthPage` và `VerifyOtpPage`.

- [ ] **Step 4: Ghim chính sách `Referer` (spec §8.3)**

Token nằm trong URL nên về lý thuyết rò được qua header `Referer` nếu trang đặt lại mật khẩu nhúng tài nguyên từ tên miền khác.

Thực tế: trình duyệt hiện đại đã mặc định `strict-origin-when-cross-origin`, tức là request sang tên miền khác chỉ gửi origin chứ không gửi đường dẫn và query — token **đã** được che sẵn. Thêm thẻ meta không đổi hành vi, mà để **ghim** mặc định đó lại, để một trình duyệt cũ hoặc một thay đổi cấu hình sau này không âm thầm làm hỏng nó.

Trong `frontend/index.html`, thêm ngay dưới thẻ `<meta name="viewport" ...>`:

```html
<!-- Ghim mặc định của trình duyệt: request sang tên miền khác chỉ mang origin,
     không mang đường dẫn và query. Trang /reset-password để token trên URL nên
     đây là thứ giữ token không rò qua Referer. -->
<meta name="referrer" content="strict-origin-when-cross-origin" />
```

Ràng buộc đi kèm, cần nhớ khi sửa hai trang mới: **`/reset-password` không được nhúng tài nguyên từ tên miền khác** — không font ngoài, không script phân tích, không ảnh từ CDN lạ.

- [ ] **Step 5: Xác minh token không rò qua Referer**

Mở `http://localhost:5174/reset-password?token=thu-nghiem` với tab Network của DevTools đang mở. Kiểm tra từng request đi ra ngoài origin.

Kỳ vọng: không request nào mang header `Referer` chứa `thu-nghiem`.

- [ ] **Step 6: Typecheck, lint, build**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AuthForm/index.tsx frontend/src/App.tsx frontend/index.html
git commit -m "feat(fe): link forgot password from login tab and register routes"
```

---

## Task 15: QC trên trình duyệt

**Files:** không sửa file nào — cổng nghiệm thu của Phần C.

Backend đang chạy sẵn; khởi động frontend:

```bash
cd frontend && npm run dev
```

- [ ] **Step 1: Link chỉ hiện ở tab đăng nhập**

Mở `http://localhost:5174/auth`. Kỳ vọng: thấy "Quên mật khẩu?" bên phải nhãn *Mật khẩu*. Chuyển sang tab **Đăng ký** — kỳ vọng: link **biến mất**, và hiệu ứng chuyển tab vẫn mượt như trước. Chuyển lại — link quay về.

- [ ] **Step 2: Luồng gửi liên kết**

Bấm link → nhập email tài khoản thật → *Gửi liên kết đặt lại*. Kỳ vọng: chuyển sang màn "Kiểm tra hộp thư", hiện đúng địa chỉ, nút *Gửi lại* bị khoá kèm đếm ngược.

- [ ] **Step 3: Đếm ngược sống qua reload**

Ở màn "đã gửi", tải lại trang khi còn khoảng 40 giây.

Kỳ vọng: sau reload quay về màn nhập email (state trong bộ nhớ đã mất) — nhập lại đúng email đó và gửi. Kỳ vọng: đếm ngược tiếp tục từ số giây còn lại, **không** quay về 60.

- [ ] **Step 4: Email lạ vẫn ra màn "đã gửi"**

Nhập một địa chỉ chắc chắn không có tài khoản. Kỳ vọng: vẫn sang màn "Kiểm tra hộp thư", không có lỗi nào — và không nhận được mail nào.

- [ ] **Step 5: Ba trạng thái của trang đặt lại**

Mở `http://localhost:5174/reset-password?token=bia-dat` → kỳ vọng: sau một nhịp kiểm tra, hiện màn "Liên kết không còn hiệu lực" với nút *Xin liên kết mới*.

Mở liên kết thật từ email → kỳ vọng: hiện form kèm email đã che dạng `ng****05@gmail.com`.

- [ ] **Step 6: Xác nhận không khớp và đặt lại thành công**

Gõ hai mật khẩu khác nhau → kỳ vọng: lỗi "Mật khẩu xác nhận không khớp" ngay dưới ô xác nhận. Sửa cho khớp → gửi. Kỳ vọng: chuyển về `/auth` kèm toast, và đăng nhập được bằng mật khẩu mới.

- [ ] **Step 7: Dán được vào ô mật khẩu**

Sao chép một chuỗi rồi dán vào ô *Mật khẩu mới*. Kỳ vọng: dán được. Chặn dán là vi phạm WCAG 2.2 AA.

- [ ] **Step 8: Chế độ tối và bề rộng điện thoại**

Bật chế độ tối bằng nút góc phải trên, xem lại cả hai trang. Thu cửa sổ xuống 375px. Kỳ vọng: khớp mockup `docs/design/forgot-password-ui.html`, không có thanh cuộn ngang, không chữ nào tràn.

- [ ] **Step 9: Điều hướng bằng bàn phím**

Tab qua toàn bộ hai trang. Kỳ vọng: mọi phần tử tương tác đều nhận được viền focus rõ ràng, kể cả nút hiện/ẩn mật khẩu và các link.

- [ ] **Step 10: Chụp ảnh màn hình bổ sung vào bộ có sẵn**

Lưu vào `docs/ui-screenshots/` theo đúng quy ước đặt tên đang dùng, cả sáng lẫn tối:
`19-forgot-password-light.png`, `19-forgot-password-dark.png`,
`20-reset-password-light.png`, `20-reset-password-dark.png`.

```bash
git add docs/ui-screenshots
git commit -m "docs: add forgot password screenshots"
```

---

# PHẦN D — DỌN DẸP VÀ SIẾT THÊM

## Task 16: Trần 5 lần mỗi giờ theo email

Cooldown 60 giây chặn được *tần suất* nhưng không chặn *tổng số*: một người biết email của bạn có thể gửi 60 mail đặt lại mật khẩu vào hộp thư đó mỗi giờ, mỗi phút một cái. Hạn mức IP chặn một nguồn, nhưng không chặn kẻ đổi IP.

**Files:**
- Modify: `backend/libs/redis/src/redis.service.ts` + `.spec.ts`
- Modify: `backend/apps/user/src/user.service.ts` + `user.service.password-reset.spec.ts`

- [ ] **Step 1: Test**

```ts
  it('trần theo email: quá 5 lần trong một giờ thì từ chối', async () => {
    client.incr.mockResolvedValueOnce(6)
    await expect(
      service.claimPasswordResetHourlySlot('an@example.test'),
    ).resolves.toBe(false)
  })
```

Và trong `user.service.password-reset.spec.ts`:

```ts
  it('vượt trần theo giờ: im lặng, không phát sự kiện', async () => {
    const { service, eventsPublisher, redisService } = setup()
    redisService.claimPasswordResetHourlySlot.mockResolvedValueOnce(false)

    await service.forgotPassword({ email: 'an@example.test', ip: '1.2.3.4' })

    expect(eventsPublisher.publishUserPasswordReset).not.toHaveBeenCalled()
  })
```

Thêm `claimPasswordResetHourlySlot: jest.fn().mockResolvedValue(true)` vào stub `redisService` của hàm `setup()`.

- [ ] **Step 2: Cài đặt trong `RedisService`**

```ts
  /** Trần tổng số mail gửi tới một địa chỉ trong một giờ, bất kể từ IP nào. */
  async claimPasswordResetHourlySlot(
    email: string,
    limit = 5,
    windowSeconds = 3600,
  ): Promise<boolean> {
    const key = `pwdreset:hourly:${email.trim().toLowerCase()}`
    const count = await this.redisClient.incr(key)
    if (count === 1) await this.redisClient.expire(key, windowSeconds)
    return count <= limit
  }
```

- [ ] **Step 3: Gắn vào `forgotPassword`**

Ngay SAU `claimPasswordResetSlot` (cooldown), không phải trước. Cooldown chặn
trước nghĩa là mọi request đến bước này đều sắp thật sự thành một lần gửi (nếu
tài khoản tồn tại) — nên bộ đếm giờ đếm đúng *số mail*, đúng như tên hàm
`claimPasswordResetHourlySlot` hứa hẹn. Đặt trước cooldown (bản đầu tiên của
kế hoạch này làm vậy — đã sửa lại ở nhánh vá lỗi sau đó) khiến một request bị
cooldown chặn, không gửi mail nào, vẫn tiêu một slot của trần theo giờ:

```ts
    if (!(await this.redisService.claimPasswordResetSlot(data.email))) return

    if (!(await this.redisService.claimPasswordResetHourlySlot(data.email))) return
```

- [ ] **Step 4: Test, typecheck, commit**

```bash
cd backend && npx jest libs/redis apps/user && npm run typecheck
```

```bash
git add backend
git commit -m "feat(user): cap password reset emails per address per hour"
```

---

## Task 17: Chuyển `VerifyOtp` sang `useResendCountdown`

`pages/VerifyOtp/index.tsx` đang có bản sao của đúng cơ chế đếm ngược mà Task 11 vừa tách ra hook. Trang đó **đang chạy tốt và không có test nào che**, nên đây là việc dọn dẹp riêng, không đi kèm tính năng.

- [ ] **Step 1: Thay phần đếm ngược**

Xoá `resendDeadlineKey`, `readResendDeadline`, `writeResendDeadline`, `secondsLeft`, `runCountdownUntil`, `startResendCountdown`, `intervalRef`, `resendCountdown` khỏi `VerifyOtp`. Thay bằng:

```tsx
const { seconds: resendCountdown, start: startResendCountdown } =
  useResendCountdown(
    form.watch("email").trim().toLowerCase(),
    // Giữ nguyên tiền tố cũ của trang này: đổi sang tiền tố khác sẽ bỏ rơi mốc
    // thời gian của những người đang chờ dở lúc triển khai, và họ sẽ thấy nút
    // "Gửi lại" mở khoá trong khi server vẫn chặn 429.
    "daln:otp-resend-until",
  );
```

`VerifyOtp` hiện lưu mốc dưới key `daln:otp-resend-until:<email>` và chuẩn hoá email bằng `.trim().toLowerCase()` — giữ đúng cả hai thì thời gian chờ đang lưu vẫn đọc được sau khi triển khai.

- [ ] **Step 2: QC trên trình duyệt**

Đăng ký một tài khoản mới, tới màn OTP, kiểm tra: đếm ngược chạy, tải lại trang không reset, bấm "Gửi lại" khi hết giờ thì nhận được mã mới.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/VerifyOtp frontend/src/hooks/useResendCountdown.ts
git commit -m "refactor(fe): reuse resend countdown hook in VerifyOtp"
```

---

## Tổng kết

| Phần | Task | Kết quả |
|---|---|---|
| A — Hạ tầng | 1–5 | Redis, maskEmail, RMQ, mail, notification-service |
| B — Nghiệp vụ | 6–9 | 3 phương thức service, 3 endpoint, trust proxy, nghiệm thu đầu–cuối |
| C — Giao diện | 10–15 | API, AuthShell, 2 trang, link, QC trình duyệt |
| D — Siết thêm | 16–17 | Trần theo giờ, dọn trùng lặp ở VerifyOtp |

Sau Task 15, tính năng đã đủ chạy. Task 16–17 siết thêm bảo mật và dọn trùng lặp; xong cả 17 task thì mở PR vào `develop`.

**Còn nợ, đã ghi trong spec §8.1:** đổi mật khẩu **không** vô hiệu hoá phiên đăng nhập cũ. Kẻ chiếm tài khoản vẫn thao tác được tối đa 7 ngày sau khi chủ tài khoản đặt lại mật khẩu. Cách vá là thêm `passwordChangedAt` vào model `User` và so `payload.iat` trong `AuthGuard` — khoảng 30 dòng, nên là một PR riêng.
