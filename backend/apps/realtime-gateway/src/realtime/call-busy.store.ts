/**
 * Khoá "đang bận" theo người dùng: một người chỉ ở trong MỘT cuộc gọi tại một thời
 * điểm (dù 1-1 hay nhóm, dù mở ở nhiều tab).
 *
 * Trước đây không có chốt này: một người đang gọi vẫn bị đổ chuông cuộc khác, và
 * hai tab có thể cùng bắt máy một cuộc. Khoá là một key Redis `callbusy:<userId>`
 * giữ callId đang chiếm — acquire bằng SET NX (nguyên tử), release bằng Lua so
 * khớp callId để không lỡ mở khoá của cuộc gọi khác.
 */

export class CallBusyStore {
  /** Ringing ~30-60s; connected có thể dài. TTL chỉ là lưới dọn rác khi client chết. */
  private readonly ringingTtlSeconds = 60
  private readonly connectedTtlSeconds = 4 * 60 * 60

  constructor(private readonly redisClient: any) {}

  private key(userId: string) {
    return `callbusy:${userId}`
  }

  /**
   * Chiếm khoá cho `userId` gắn với `callId`. Trả true nếu chiếm được HOẶC khoá
   * đã là của chính callId này (idempotent — cùng cuộc gọi gọi lại vẫn ok). Trả
   * false khi người này đang bận với một callId khác.
   */
  async acquire(
    userId: string,
    callId: string,
    ttlSeconds: number = this.ringingTtlSeconds,
  ): Promise<boolean> {
    const won = await this.redisClient.set(
      this.key(userId),
      callId,
      'EX',
      ttlSeconds,
      'NX',
    )
    if (won) return true
    const current = await this.redisClient.get(this.key(userId))
    return current === callId
  }

  /** Người này có đang bận với một cuộc gọi KHÁC `exceptCallId` không. */
  async isBusy(userId: string, exceptCallId?: string): Promise<boolean> {
    const current = await this.redisClient.get(this.key(userId))
    return !!current && current !== exceptCallId
  }

  /** Gia hạn khoá lên TTL dài khi cuộc gọi đã kết nối — chỉ khi vẫn là của callId này. */
  async refresh(
    userId: string,
    callId: string,
    ttlSeconds: number = this.connectedTtlSeconds,
  ): Promise<void> {
    // Lua CAS: chỉ expire khi giá trị đúng callId, tránh giữ khoá hộ cuộc khác.
    await this.redisClient.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      this.key(userId),
      callId,
      String(ttlSeconds),
    )
  }

  /** Mở khoá — chỉ khi khoá đang thuộc đúng `callId` (Lua so khớp rồi mới DEL). */
  async release(userId: string, callId: string): Promise<void> {
    await this.redisClient.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      this.key(userId),
      callId,
    )
  }
}
