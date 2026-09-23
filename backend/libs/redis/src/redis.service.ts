import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'

/** What the recommendation feature cache holds per user (setUserFeaturesBatch). */
export interface CachedFeatures {
  bio: string | null
  location: unknown
  interests: string[]
}

/** Set chỉ mục các user đang online — phải khớp với UserStatusStore. */
const ONLINE_USERS_KEY = 'online:users'

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  private getKey(userId: string) {
    return `user:${userId}:sockets`
  }

  async isOnline(userId: string): Promise<boolean> {
    const userKey = this.getKey(userId)
    const sockets = await this.redisClient.smembers(userKey)

    if (!sockets.length) return false

    // Gộp N lệnh EXISTS vào 1 pipeline: 1 round-trip thay vì N.
    const res = await this.pipeline(
      sockets.map((id) => ['exists', `socket:${id}`]),
    )

    const dead = sockets.filter((_, i) => !res[i]?.[1])
    if (dead.length) await this.redisClient.srem(userKey, ...dead)

    if (dead.length === sockets.length) {
      await this.redisClient
        .multi()
        .del(userKey)
        .srem(ONLINE_USERS_KEY, userId)
        .exec()
      return false
    }

    return true
  }

  /**
   * Bản theo lô của isOnline: 2 round-trip cho N user, bất kể N lớn đến đâu.
   * Dùng cho các luồng quét nhiều user (digest sweep) thay vì gọi isOnline()
   * trong vòng lặp — vốn tốn 1 + K round-trip cho MỖI user.
   */
  async isOnlineBatch(userIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>(userIds.map((id) => [id, false]))
    if (!userIds.length) return result

    const sets = await this.pipeline(
      userIds.map((id) => ['smembers', this.getKey(id)]),
    )

    const probes: { userId: string; socketId: string }[] = []
    userIds.forEach((userId, i) => {
      for (const socketId of (sets[i]?.[1] as string[] | undefined) ?? []) {
        probes.push({ userId, socketId })
      }
    })
    if (!probes.length) return result

    const alive = await this.pipeline(
      probes.map((p) => ['exists', `socket:${p.socketId}`]),
    )

    probes.forEach((p, i) => {
      if (alive[i]?.[1]) result.set(p.userId, true)
    })

    return result
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!members.length) return 0
    return await this.redisClient.sadd(key, ...members)
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (!members.length) return 0
    return await this.redisClient.srem(key, ...members)
  }

  async smembers(key: string): Promise<string[]> {
    return await this.redisClient.smembers(key)
  }

  /**
   * Lấy tối đa `count` phần tử ra khỏi set, nguyên tử.
   * Dùng làm hàng đợi việc: nhiều bản sao service cùng pop sẽ không xử lý trùng.
   */
  async spop(key: string, count: number): Promise<string[]> {
    const res = await this.redisClient.spop(key, count)
    if (!res) return []
    return Array.isArray(res) ? res : [res]
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key)
  }

  /** Xoá nhiều key trong một lệnh thay vì N lần round-trip. */
  async delMany(keys: string[]): Promise<void> {
    if (!keys.length) return
    await this.redisClient.del(...keys)
  }

  async set(key: string, value: string): Promise<void> {
    await this.redisClient.set(key, value)
  }

  /** SET kèm TTL (giây). */
  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redisClient.set(key, value, 'EX', ttlSeconds)
  }

  /**
   * Gom nhiều lệnh vào một round-trip. Trả về mảng [error, result] theo thứ tự
   * lệnh, giống ioredis.
   */
  async pipeline(
    commands: (string | number)[][],
  ): Promise<[Error | null, unknown][]> {
    if (!commands.length) return []
    return (await this.redisClient.pipeline(commands).exec()) ?? []
  }

  /**
   * Chạy một Lua script (EVAL). Cả script chạy nguyên tử trên Redis: không lệnh
   * nào của client khác chen vào giữa. Mọi key script đụng tới phải truyền qua
   * `keys`, không tự ghép tên key bên trong script.
   */
  async eval(
    script: string,
    keys: string[],
    args: (string | number)[] = [],
  ): Promise<unknown> {
    return await this.redisClient.eval(script, keys.length, ...keys, ...args)
  }

  private getRegistrationOtpKey(email: string): string {
    return `otp:reg:${email.trim().toLowerCase()}`
  }

  async saveOTP(email: string, otp: string, ttl = 300): Promise<void> {
    const key = this.getRegistrationOtpKey(email)
    await this.redisClient.set(key, otp, 'EX', ttl)
  }

  async getOTP(email: string): Promise<string | null> {
    const key = this.getRegistrationOtpKey(email)
    return await this.redisClient.get(key)
  }

  async deleteOTP(email: string): Promise<void> {
    const key = this.getRegistrationOtpKey(email)
    await this.redisClient.del(key)
  }

  private getOtpResendKey(email: string): string {
    return `otp:resend:${email.trim().toLowerCase()}`
  }

  /**
   * Claim the right to send one registration OTP for `email`.
   *
   * Returns 0 when the caller may send, or the number of seconds still left on
   * the cooldown when it may not. The claim is a single atomic SET NX EX, so
   * two concurrent requests cannot both win it. Enforcing this server side is
   * the point: the countdown in the browser is a courtesy, not a control.
   */
  async claimOtpResendSlot(
    email: string,
    cooldownSeconds = 30,
  ): Promise<number> {
    const key = this.getOtpResendKey(email)
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

  /**
   * Giành quyền xử lý một lần cho `key` bằng SET NX EX nguyên tử.
   *
   * Trả `true` khi caller là người đầu tiên đặt được key (chưa từng tồn tại), và
   * `false` khi key đã có — dùng làm chốt idempotency: hai lần gọi trùng (webhook
   * gửi lại) chỉ một lần thắng. Key tự hết hạn sau `ttlSeconds` giây.
   */
  async claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const won = await this.redisClient.set(key, '1', 'EX', ttlSeconds, 'NX')
    return Boolean(won)
  }

  async get(key: string): Promise<string | null> {
    return await this.redisClient.get(key)
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
    return await this.claimOnce(
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

  // Feature Hydration Cache methods
  private getFeaturesKey(userId: string): string {
    return `user:${userId}:features`
  }

  async getUserFeaturesBatch(
    userIds: string[],
  ): Promise<Record<string, CachedFeatures>> {
    try {
      const keys = userIds.map((id) => this.getFeaturesKey(id))
      const results = await this.redisClient.mget(...keys)

      const featuresByUserId: Record<string, CachedFeatures> = {}
      for (let i = 0; i < userIds.length; i++) {
        const data = results[i]
        if (!data) continue
        try {
          featuresByUserId[userIds[i]] = JSON.parse(data) as CachedFeatures
        } catch {
          // Unreadable entry: treat as a cache miss.
        }
      }
      return featuresByUserId
    } catch (err) {
      console.error(`[RedisService] Error getting features batch:`, err)
      return {}
    }
  }

  async setUserFeaturesBatch(
    profiles: Array<{
      id: string
      bio?: string | null
      location?: unknown
      interests?: string[]
    }>,
    ttl = 86400,
  ): Promise<void> {
    try {
      const pipeline = this.redisClient.pipeline()
      for (const p of profiles) {
        const key = this.getFeaturesKey(p.id)
        const serialized = JSON.stringify({
          bio: p.bio ?? null,
          location: p.location ?? null,
          interests: p.interests ?? [],
        })
        pipeline.set(key, serialized, 'EX', ttl)
      }
      await pipeline.exec()
    } catch (err) {
      console.error(`[RedisService] Error setting features batch:`, err)
    }
  }
}
