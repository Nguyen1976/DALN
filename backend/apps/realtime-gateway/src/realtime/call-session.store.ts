/**
 * Phiên cuộc gọi trong Redis.
 *
 * Trước đây gateway không nhớ gì về cuộc gọi: nó chuyển mọi sự kiện `call.*`
 * tới đúng `targetUserId` mà client gửi lên, nên bất kỳ ai cũng làm người lạ đổ
 * chuông được, và `conversationId` ghi vào dòng trò chuyện cũng do client đặt.
 *
 * Phiên giải quyết cả hai: gateway tự tìm người nhận một lần lúc đổ chuông, lưu
 * lại, rồi mọi sự kiện sau đó chỉ cần mang `callId` — người gửi phải thuộc phiên
 * đó, còn người nhận và hội thoại lấy từ phiên chứ không tin client nữa.
 */

export type CallSessionStatus = 'ringing' | 'connected'

export type CallType = 'audio' | 'video'

export interface CallSession {
  callId: string
  callerId: string
  calleeId: string
  conversationId: string
  status: CallSessionStatus
  /** Loại cuộc gọi được khởi tạo; mặc định audio để tương thích payload cũ. */
  callType: CallType
  /** Unix ms — lúc bắt đầu đổ chuông. */
  startedAt: number
  /** Unix ms — lúc người nhận bấm nghe; chưa nghe thì không có. */
  connectedAt?: number
}

/** callId do gateway sinh bằng randomUUID; chặn luôn key rác từ client. */
const CALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isCallId(value: unknown): value is string {
  return typeof value === 'string' && CALL_ID_PATTERN.test(value)
}

export class CallSessionStore {
  /** Đổ chuông tối đa 30 giây ở frontend; 60 giây là biên an toàn gấp đôi. */
  private readonly ringingTtlSeconds = 60
  /** Đã nghe máy thì phiên phải sống hết cuộc gọi — TTL chỉ là lưới dọn rác. */
  private readonly connectedTtlSeconds = 4 * 60 * 60

  constructor(private readonly redisClient: any) {}

  private key(callId: string) {
    return `call:${callId}`
  }

  /** Khoá "socket nào đã bắt máy" — chống hai tab của người nhận cùng accept. */
  private acceptKey(callId: string) {
    return `callaccept:${callId}`
  }

  /**
   * Giành quyền bắt máy cho đúng MỘT socket. Trả true cho socket thắng (SET NX),
   * hoặc true nếu chính socket này đã giành trước đó (idempotent khi client retry);
   * false khi một tab khác đã bắt máy — tab thua phải đóng chuông, không relay answer.
   */
  async claimAccept(callId: string, socketId: string): Promise<boolean> {
    if (!isCallId(callId)) return false
    const won = await this.redisClient.set(
      this.acceptKey(callId),
      socketId,
      'EX',
      this.connectedTtlSeconds,
      'NX',
    )
    if (won) return true
    const current = await this.redisClient.get(this.acceptKey(callId))
    return current === socketId
  }

  async create(session: CallSession): Promise<void> {
    await this.redisClient.set(
      this.key(session.callId),
      JSON.stringify(session),
      'EX',
      this.ringingTtlSeconds,
    )
  }

  async get(callId: string): Promise<CallSession | null> {
    if (!isCallId(callId)) return null

    const raw = await this.redisClient.get(this.key(callId))
    if (!raw) return null

    try {
      return JSON.parse(raw) as CallSession
    } catch {
      // Dữ liệu hỏng thì coi như không có phiên; sự kiện bị bỏ, không nổ.
      return null
    }
  }

  /** Gia hạn khi người nhận bấm nghe, và ghi mốc để tính thời lượng thật. */
  async markConnected(
    session: CallSession,
    nowMs: number = Date.now(),
  ): Promise<CallSession> {
    const connected: CallSession = {
      ...session,
      status: 'connected',
      connectedAt: session.connectedAt ?? nowMs,
    }

    await this.redisClient.set(
      this.key(connected.callId),
      JSON.stringify(connected),
      'EX',
      this.connectedTtlSeconds,
    )

    return connected
  }

  /**
   * Đóng phiên. Trả về true CHỈ cho lời gọi đầu tiên — cả hai bên đều phát
   * `call.ended` khi cúp máy, nên đây là chốt để kết quả cuộc gọi chỉ được ghi
   * vào dòng trò chuyện một lần.
   */
  async end(callId: string): Promise<boolean> {
    if (!isCallId(callId)) return false

    const removed = await this.redisClient.del(this.key(callId))
    // Dọn luôn khoá accept; return vẫn dựa trên DEL của session để "ghi kết quả
    // đúng một lần" không đổi.
    await this.redisClient.del(this.acceptKey(callId))
    return Number(removed) > 0
  }

  static isParticipant(session: CallSession, userId: string): boolean {
    return session.callerId === userId || session.calleeId === userId
  }

  static peerOf(session: CallSession, userId: string): string {
    return session.callerId === userId ? session.calleeId : session.callerId
  }
}
