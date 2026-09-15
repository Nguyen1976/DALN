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
 */

export interface GroupCallMember {
  id: string
  username: string
}

export interface GroupCallSession {
  callId: string
  roomName: string
  conversationId: string
  /** userId của người bấm gọi đầu tiên (mở phòng). */
  startedBy: string
  /** Unix ms — lúc mở phòng; dùng để tính thời lượng khi room_finished. */
  startedAt: number
  /** Thành viên hội thoại tại lúc mở phòng — đích để phát state/ended. */
  members: GroupCallMember[]
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

  constructor(private readonly redisClient: any) {}

  private key(conversationId: string) {
    return `groupcall:${conversationId}`
  }

  /** Con trỏ callId -> conversationId để accept/leave (chỉ có callId) tra ngược. */
  private callKey(callId: string) {
    return `groupcall:call:${callId}`
  }

  private async save(session: GroupCallSession): Promise<GroupCallSession> {
    await this.redisClient.set(
      this.key(session.conversationId),
      JSON.stringify(session),
      'EX',
      this.ttlSeconds,
    )
    await this.redisClient.set(
      this.callKey(session.callId),
      session.conversationId,
      'EX',
      this.ttlSeconds,
    )
    return session
  }

  async getByConversationId(
    conversationId: string,
  ): Promise<GroupCallSession | null> {
    const raw = await this.redisClient.get(this.key(conversationId))
    if (!raw) return null

    try {
      return JSON.parse(raw) as GroupCallSession
    } catch {
      // Dữ liệu hỏng thì coi như không có phiên; sự kiện bị bỏ, không nổ.
      return null
    }
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
   */
  async getOrCreate(input: {
    conversationId: string
    startedBy: string
    members: GroupCallMember[]
  }): Promise<GroupCallSession> {
    const existing = await this.getByConversationId(input.conversationId)
    if (existing) return existing

    return this.save({
      callId: randomUUID(),
      roomName: roomNameFor(input.conversationId),
      conversationId: input.conversationId,
      startedBy: input.startedBy,
      startedAt: Date.now(),
      members: input.members,
      participants: {},
      seen: [],
    })
  }

  async addParticipant(
    conversationId: string,
    member: GroupCallMember,
  ): Promise<GroupCallSession | null> {
    const session = await this.getByConversationId(conversationId)
    if (!session) return null

    session.participants[member.id] = member
    if (!session.seen.includes(member.id)) session.seen.push(member.id)

    return this.save(session)
  }

  async removeParticipant(
    conversationId: string,
    userId: string,
  ): Promise<GroupCallSession | null> {
    const session = await this.getByConversationId(conversationId)
    if (!session) return null

    delete session.participants[userId]

    return this.save(session)
  }

  /** Dọn cả phiên lẫn con trỏ callId khi room_finished. */
  async delete(conversationId: string): Promise<void> {
    const session = await this.getByConversationId(conversationId)
    await this.redisClient.del(this.key(conversationId))
    if (session) await this.redisClient.del(this.callKey(session.callId))
  }

  static isMember(session: GroupCallSession, userId: string): boolean {
    return session.members.some((member) => member.id === userId)
  }

  static participantList(session: GroupCallSession): GroupCallMember[] {
    return Object.values(session.participants)
  }
}
