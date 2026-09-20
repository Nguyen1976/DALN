import type Redis from 'ioredis'
import { randomUUID } from 'crypto'

/**
 * Phiên gọi nhóm trong Redis.
 *
 * Khác cuộc gọi 1-1 (khoá theo `callId` sinh lúc đổ chuông), gọi nhóm khoá theo
 * `conversationId`: một hội thoại nhóm chỉ có đúng một phòng đang mở, nên ai bấm
 * gọi khi phòng đã mở thì rơi vào chính phòng đó (vào muộn/vào lại đều đúng chỗ).
 *
 * Nguồn sự thật cuối về "ai đang trong cuộc" là webhook LiveKit (participant_*),
 * không phải client — nên `participants` chỉ được cập nhật từ webhook, còn handler
 * socket chỉ đọc để phát `group_call.state`.
 *
 * Lưu trữ tách làm ba để các webhook đồng thời không ghi đè lẫn nhau (trước đây
 * cả phiên là một blob JSON đọc-sửa-ghi, hai participant_joined sát nhau làm mất
 * roster):
 *   - `groupcall:<conv>`               JSON các trường tĩnh (callId, room, members…)
 *   - `groupcall:<conv>:participants`  HASH userId -> member đang trong phòng
 *   - `groupcall:<conv>:seen`          SET userId từng vào (để đếm "N người")
 * Con trỏ `groupcall:call:<callId>` -> conversationId cho accept/leave tra ngược.
 */

export type GroupCallType = 'audio' | 'video'

export interface GroupCallMember {
  id: string
  username: string
}

/** Các trường tĩnh của phiên — không đổi sau khi mở phòng. */
interface GroupCallStatic {
  callId: string
  roomName: string
  conversationId: string
  /** userId của người bấm gọi đầu tiên (mở phòng). */
  startedBy: string
  /** Unix ms — lúc mở phòng; dùng để tính thời lượng khi room_finished. */
  startedAt: number
  /** Loại cuộc gọi được khởi tạo; mặc định audio để tương thích payload cũ. */
  callType: GroupCallType
  /** Thành viên hội thoại tại lúc mở phòng — đích để phát state/ended. */
  members: GroupCallMember[]
}

export interface GroupCallSession extends GroupCallStatic {
  /** Ai đang thực sự trong phòng (theo webhook LiveKit), khoá theo userId. */
  participants: Record<string, GroupCallMember>
  /** userId từng vào phòng ít nhất một lần — để đếm "N người" khi ghi log. */
  seen: string[]
}

/** roomName ổn định theo hội thoại: vào lại/vào muộn đều rơi đúng phòng. */
export function roomNameFor(conversationId: string): string {
  return `conv_${conversationId}`
}

/** Ngược lại `roomNameFor`: webhook chỉ có roomName, cần lần ra conversationId. */
export function conversationIdFromRoom(roomName: string): string | null {
  if (typeof roomName !== 'string' || !roomName.startsWith('conv_')) return null
  const conversationId = roomName.slice('conv_'.length)
  return conversationId || null
}

/** callId do gateway sinh bằng randomUUID; chặn key rác từ client. */
const CALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isGroupCallId(value: unknown): value is string {
  return typeof value === 'string' && CALL_ID_PATTERN.test(value)
}

export class GroupCallStore {
  /** Phòng nhóm có thể mở lâu; 12h là lưới dọn rác, không phải hạn cuộc gọi. */
  private readonly ttlSeconds = 12 * 60 * 60

  constructor(private readonly redisClient: Redis) {}

  private key(conversationId: string) {
    return `groupcall:${conversationId}`
  }

  /** Con trỏ callId -> conversationId để accept/leave (chỉ có callId) tra ngược. */
  private callKey(callId: string) {
    return `groupcall:call:${callId}`
  }

  private participantsKey(conversationId: string) {
    return `groupcall:${conversationId}:participants`
  }

  private seenKey(conversationId: string) {
    return `groupcall:${conversationId}:seen`
  }

  private async getStatic(
    conversationId: string,
  ): Promise<GroupCallStatic | null> {
    const raw = await this.redisClient.get(this.key(conversationId))
    if (!raw) return null

    try {
      return JSON.parse(raw) as GroupCallStatic
    } catch {
      // Dữ liệu hỏng thì coi như không có phiên; sự kiện bị bỏ, không nổ.
      return null
    }
  }

  /** Ghép phần tĩnh với participants (hash) + seen (set) thành phiên đầy đủ. */
  private async assemble(stat: GroupCallStatic): Promise<GroupCallSession> {
    const [rawParticipants, seen] = await Promise.all([
      this.redisClient.hgetall(this.participantsKey(stat.conversationId)),
      this.redisClient.smembers(this.seenKey(stat.conversationId)),
    ])

    const participants: Record<string, GroupCallMember> = {}
    for (const [id, value] of Object.entries(rawParticipants || {})) {
      try {
        participants[id] = JSON.parse(value) as GroupCallMember
      } catch {
        // Bỏ qua bản ghi hỏng thay vì làm hỏng cả roster.
      }
    }

    return {
      ...stat,
      participants,
      seen: Array.isArray(seen) ? seen : [],
    }
  }

  async getByConversationId(
    conversationId: string,
  ): Promise<GroupCallSession | null> {
    const stat = await this.getStatic(conversationId)
    if (!stat) return null
    return this.assemble(stat)
  }

  async getByCallId(callId: string): Promise<GroupCallSession | null> {
    if (!isGroupCallId(callId)) return null

    const conversationId = await this.redisClient.get(this.callKey(callId))
    if (!conversationId) return null

    const session = await this.getByConversationId(conversationId)
    // Con trỏ có thể trỏ tới phiên đã bị thay bằng cuộc gọi mới hơn.
    if (!session || session.callId !== callId) return null

    return session
  }

  /**
   * Lấy phòng đang mở của hội thoại, hoặc mở phòng mới. Một hội thoại chỉ một
   * phòng: người bấm gọi khi phòng đã mở nhận lại đúng phiên cũ.
   *
   * Tạo bằng `SET NX` để hai người bấm gọi cùng lúc không sinh hai callId — kẻ
   * thua NX đọc lại đúng phiên của kẻ thắng.
   */
  async getOrCreate(input: {
    conversationId: string
    startedBy: string
    members: GroupCallMember[]
    callType?: GroupCallType
  }): Promise<GroupCallSession> {
    const stat: GroupCallStatic = {
      callId: randomUUID(),
      roomName: roomNameFor(input.conversationId),
      conversationId: input.conversationId,
      startedBy: input.startedBy,
      startedAt: Date.now(),
      callType: input.callType ?? 'audio',
      members: input.members,
    }

    const won = await this.redisClient.set(
      this.key(input.conversationId),
      JSON.stringify(stat),
      'EX',
      this.ttlSeconds,
      'NX',
    )

    if (won) {
      await this.redisClient.set(
        this.callKey(stat.callId),
        input.conversationId,
        'EX',
        this.ttlSeconds,
      )
      return { ...stat, participants: {}, seen: [] }
    }

    const existing = await this.getByConversationId(input.conversationId)
    if (existing) return existing

    // Hiếm: key tồn tại lúc NX nhưng hỏng/biến mất khi đọc lại — chiếm lại phòng.
    await this.redisClient.set(
      this.key(input.conversationId),
      JSON.stringify(stat),
      'EX',
      this.ttlSeconds,
    )
    await this.redisClient.set(
      this.callKey(stat.callId),
      input.conversationId,
      'EX',
      this.ttlSeconds,
    )
    return { ...stat, participants: {}, seen: [] }
  }

  async addParticipant(
    conversationId: string,
    member: GroupCallMember,
  ): Promise<GroupCallSession | null> {
    const stat = await this.getStatic(conversationId)
    if (!stat) return null

    // HSET + SADD nguyên tử theo từng field: hai webhook đồng thời không mất nhau.
    await this.redisClient.hset(
      this.participantsKey(conversationId),
      member.id,
      JSON.stringify(member),
    )
    await this.redisClient.sadd(this.seenKey(conversationId), member.id)

    // Phòng còn hoạt động thì gia hạn lưới dọn rác cho cả ba key.
    await this.redisClient.expire(this.key(conversationId), this.ttlSeconds)
    await this.redisClient.expire(
      this.participantsKey(conversationId),
      this.ttlSeconds,
    )
    await this.redisClient.expire(this.seenKey(conversationId), this.ttlSeconds)

    return this.assemble(stat)
  }

  async removeParticipant(
    conversationId: string,
    userId: string,
  ): Promise<GroupCallSession | null> {
    const stat = await this.getStatic(conversationId)
    if (!stat) return null

    await this.redisClient.hdel(this.participantsKey(conversationId), userId)

    return this.assemble(stat)
  }

  /**
   * Đóng phiên đúng MỘT lần. room_finished của LiveKit có thể tới trùng hoặc đảo
   * thứ tự; chỉ lời gọi xoá được key chính mới trả về phiên (để ghi log tổng kết),
   * các lời gọi sau nhận `null`. Trả phiên đã ghép sẵn `seen` để đếm "N người".
   */
  async finish(conversationId: string): Promise<GroupCallSession | null> {
    const session = await this.getByConversationId(conversationId)
    if (!session) return null

    const removed = await this.redisClient.del(this.key(conversationId))
    if (Number(removed) === 0) return null

    await this.redisClient.del(
      this.callKey(session.callId),
      this.participantsKey(conversationId),
      this.seenKey(conversationId),
    )

    return session
  }

  /** Dọn toàn bộ key của phiên (phần tĩnh, con trỏ, participants, seen). */
  async delete(conversationId: string): Promise<void> {
    const stat = await this.getStatic(conversationId)
    await this.redisClient.del(this.key(conversationId))
    await this.redisClient.del(this.participantsKey(conversationId))
    await this.redisClient.del(this.seenKey(conversationId))
    if (stat) await this.redisClient.del(this.callKey(stat.callId))
  }

  static isMember(session: GroupCallSession, userId: string): boolean {
    return session.members.some((member) => member.id === userId)
  }

  static participantList(session: GroupCallSession): GroupCallMember[] {
    return Object.values(session.participants)
  }
}
