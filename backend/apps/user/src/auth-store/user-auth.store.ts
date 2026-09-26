import { createHash, timingSafeEqual } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { RedisService } from '@app/redis/redis.service'

/**
 * Ba khoá Redis của một luồng OTP: mã, bộ đếm lần thử sai, khe chống gửi lại.
 *
 * Mỗi luồng khai riêng để hai luồng không bao giờ đọc trúng mã của nhau — mã
 * kích hoạt tài khoản không được dùng để đổi mật khẩu và ngược lại.
 */
interface OtpNamespace {
  code: (subject: string) => string
  attempts: (subject: string) => string
  resend: (subject: string) => string
}

/**
 * Trạng thái Redis của các luồng xác thực: OTP đăng ký, OTP đổi mật khẩu, khoá
 * tài khoản sau nhiều lần sai, token và hạn mức đặt lại mật khẩu.
 *
 * Chỉ service user dùng, nên nó sống ở đây chứ không trong libs/redis: nằm ở
 * lib thì mỗi lần sửa một luồng OTP, bundle của cả 5 service dùng RedisService
 * đều đổi và cả 5 bị deploy lại. Khoá, TTL và thứ tự lệnh giữ nguyên từng chữ
 * so với bản cũ trong RedisService, nên dữ liệu đang sống trên Redis vẫn đọc
 * được sau deploy.
 */
@Injectable()
export class UserAuthStore {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    private readonly redis: RedisService,
  ) {}

  /**
   * Một luồng OTP = một bộ ba khoá tách biệt.
   *
   * Vì sao là object chứ không phải chuỗi tiền tố ghép tay: luồng đăng ký đã
   * chạy trên production với khuôn khoá `otp:attempts:<email>` (không có tên
   * luồng ở giữa). Ép nó vào một khuôn "đẹp hơn" sẽ làm mọi mã và mọi bộ đếm
   * đang sống mất dấu ngay lúc deploy. Mỗi luồng tự khai khoá của mình, nên
   * luồng mới sạch sẽ mà luồng cũ không phải đổi gì.
   */
  private static readonly REGISTRATION_OTP: OtpNamespace = {
    code: (subject) => `otp:reg:${subject.trim().toLowerCase()}`,
    attempts: (subject) => `otp:attempts:${subject.trim().toLowerCase()}`,
    resend: (subject) => `otp:resend:${subject.trim().toLowerCase()}`,
  }

  /** Khoá theo userId — hành động của người đã đăng nhập, không theo email. */
  private static readonly CHANGE_PASSWORD_OTP: OtpNamespace = {
    code: (subject) => `otp:chpw:${subject.trim()}`,
    attempts: (subject) => `otp:chpw:attempts:${subject.trim()}`,
    resend: (subject) => `otp:chpw:resend:${subject.trim()}`,
  }

  /**
   * Lưu BẢN BĂM của OTP, không lưu mã thô.
   *
   * Trước đây mã 6 số nằm cleartext trong Redis — trong khi token đặt lại mật
   * khẩu ngay dưới đây đã được băm, kèm cả comment giải thích vì sao. Cùng một
   * hệ thống, cùng một loại bí mật, hai chuẩn khác nhau.
   */
  private async saveOtpIn(
    ns: OtpNamespace,
    subject: string,
    otp: string,
    ttl: number,
  ): Promise<void> {
    await this.redisClient.set(ns.code(subject), this.hashOtp(otp), 'EX', ttl)
    await this.redisClient.del(ns.attempts(subject))
  }

  /**
   * So khớp OTP người dùng gửi, theo thời gian hằng định.
   *
   * `!==` trên chuỗi thoát ngay ở ký tự đầu khác nhau. Với mã 6 số thì việc đo
   * được thời gian đó qua mạng là khó, nhưng repo đã có `timingSafeEqual` sẵn
   * cho token nội bộ — dùng chuẩn cao hơn không tốn gì.
   */
  private async verifyOtpIn(
    ns: OtpNamespace,
    subject: string,
    otp: string,
  ): Promise<boolean> {
    const stored = await this.redisClient.get(ns.code(subject))
    if (!stored) return false

    const a = Buffer.from(stored, 'hex')
    const b = Buffer.from(this.hashOtp(otp), 'hex')
    if (a.length !== b.length || a.length === 0) return false
    return timingSafeEqual(a, b)
  }

  private async deleteOtpIn(ns: OtpNamespace, subject: string): Promise<void> {
    await this.redisClient.del(ns.code(subject), ns.attempts(subject))
  }

  /**
   * Đếm một lần thử OTP sai. Trả `true` nếu đã vượt hạn và mã bị TIÊU HUỶ.
   *
   * Không có bước này thì toàn bộ không gian 10^6 mở trong 5 phút, và một lần
   * đoán sai không mất gì cả: mã vẫn nằm đó cho lần đoán tiếp theo.
   */
  private async claimOtpAttemptIn(
    ns: OtpNamespace,
    subject: string,
    limit: number,
  ): Promise<boolean> {
    const attempts = Number(
      await this.redisClient.eval(
        `local n = redis.call('INCR', KEYS[1])
         if n == 1 then redis.call('EXPIRE', KEYS[1], 900) end
         return n`,
        1,
        ns.attempts(subject),
      ),
    )

    if (attempts >= limit) {
      await this.deleteOtpIn(ns, subject)
      return true
    }
    return false
  }

  /** Khe gửi lại: 0 nghĩa là được gửi, số dương là số giây còn phải chờ. */
  private async claimOtpResendSlotIn(
    ns: OtpNamespace,
    subject: string,
    cooldownSeconds: number,
  ): Promise<number> {
    const key = ns.resend(subject)
    const won = await this.redisClient.set(
      key,
      '1',
      'EX',
      cooldownSeconds,
      'NX',
    )
    if (won) return 0
    const ttl = await this.redisClient.ttl(key)
    return ttl > 0 ? ttl : cooldownSeconds
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp.trim()).digest('hex')
  }

  // --- OTP kích hoạt tài khoản (khoá theo email) ---

  async saveOTP(email: string, otp: string, ttl = 300): Promise<void> {
    await this.saveOtpIn(UserAuthStore.REGISTRATION_OTP, email, otp, ttl)
  }

  async verifyOTP(email: string, otp: string): Promise<boolean> {
    return await this.verifyOtpIn(UserAuthStore.REGISTRATION_OTP, email, otp)
  }

  async deleteOTP(email: string): Promise<void> {
    await this.deleteOtpIn(UserAuthStore.REGISTRATION_OTP, email)
  }

  async claimOtpAttempt(email: string, limit = 5): Promise<boolean> {
    return await this.claimOtpAttemptIn(
      UserAuthStore.REGISTRATION_OTP,
      email,
      limit,
    )
  }

  async claimOtpResendSlot(
    email: string,
    cooldownSeconds = 30,
  ): Promise<number> {
    return await this.claimOtpResendSlotIn(
      UserAuthStore.REGISTRATION_OTP,
      email,
      cooldownSeconds,
    )
  }

  // --- OTP đổi mật khẩu (khoá theo userId) ---

  async saveChangePasswordOtp(
    userId: string,
    otp: string,
    ttl = 300,
  ): Promise<void> {
    await this.saveOtpIn(UserAuthStore.CHANGE_PASSWORD_OTP, userId, otp, ttl)
  }

  async verifyChangePasswordOtp(userId: string, otp: string): Promise<boolean> {
    return await this.verifyOtpIn(
      UserAuthStore.CHANGE_PASSWORD_OTP,
      userId,
      otp,
    )
  }

  async deleteChangePasswordOtp(userId: string): Promise<void> {
    await this.deleteOtpIn(UserAuthStore.CHANGE_PASSWORD_OTP, userId)
  }

  async claimChangePasswordOtpAttempt(
    userId: string,
    limit = 5,
  ): Promise<boolean> {
    return await this.claimOtpAttemptIn(
      UserAuthStore.CHANGE_PASSWORD_OTP,
      userId,
      limit,
    )
  }

  /**
   * Khe gửi lại 60s — dài gấp đôi luồng đăng ký.
   *
   * Người đăng ký đang đứng chờ để vào được tài khoản; người đổi mật khẩu thì
   * không, và mỗi lần bấm là một lá thư vào hộp thư của chính họ.
   */
  async claimChangePasswordOtpResendSlot(
    userId: string,
    cooldownSeconds = 60,
  ): Promise<number> {
    return await this.claimOtpResendSlotIn(
      UserAuthStore.CHANGE_PASSWORD_OTP,
      userId,
      cooldownSeconds,
    )
  }

  /* ---------------- Khoá tài khoản sau nhiều lần sai ---------------- */

  private loginFailureKey(email: string): string {
    return `login:fail:${email.trim().toLowerCase()}`
  }

  /**
   * Cộng một lần đăng nhập sai và trả về tổng trong cửa sổ hiện tại.
   *
   * Đếm theo TÀI KHOẢN, không theo IP: tấn công thật là nhiều IP dội vào một
   * tài khoản, nên bộ đếm theo IP không thấy gì cả. OWASP cũng khuyến nghị
   * đúng chiều này.
   *
   * INCR + EXPIRE trong một Lua để không có khe: hai request cùng thấy n==1
   * rồi cùng đặt hạn, hoặc một request tăng bộ đếm rồi chết trước khi đặt hạn
   * — để lại bộ đếm không bao giờ hết hạn, khoá tài khoản vĩnh viễn.
   */
  async countLoginFailure(email: string, windowSeconds = 900): Promise<number> {
    const result = await this.redisClient.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
       return n`,
      1,
      this.loginFailureKey(email),
      String(windowSeconds),
    )
    return Number(result) || 0
  }

  /** Số lần sai hiện tại, KHÔNG làm tăng bộ đếm. */
  async loginFailureCount(email: string): Promise<number> {
    const value = await this.redisClient.get(this.loginFailureKey(email))
    return Number(value) || 0
  }

  /** Đăng nhập đúng thì xoá bộ đếm — người dùng thật không bị tích luỹ. */
  async clearLoginFailures(email: string): Promise<void> {
    await this.redisClient.del(this.loginFailureKey(email))
  }

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

  private passwordResetHourlyKey(email: string): string {
    return `pwdreset:hourly:${email.trim().toLowerCase()}`
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
    return await this.redis.claimOnce(
      this.passwordResetCooldownKey(email),
      cooldownSeconds,
    )
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

  /**
   * Trần tổng số mail đặt lại mật khẩu gửi tới MỘT địa chỉ trong một giờ, bất
   * kể đến từ IP nào — cooldown theo email chặn được tần suất (60s/lần) nhưng
   * không chặn tổng số, và hạn mức theo IP không chặn được kẻ đổi IP.
   *
   * Cùng khuôn với claimPasswordResetIpSlot: EXPIRE chỉ đặt ở lần đếm đầu
   * tiên, nếu không mỗi request lại đẩy cửa sổ lùi thêm một giờ và bộ đếm
   * không bao giờ được reset.
   */
  async claimPasswordResetHourlySlot(
    email: string,
    limit = 5,
    windowSeconds = 3600,
  ): Promise<boolean> {
    const key = this.passwordResetHourlyKey(email)
    const count = await this.redisClient.incr(key)
    if (count === 1) await this.redisClient.expire(key, windowSeconds)
    return count <= limit
  }
}
