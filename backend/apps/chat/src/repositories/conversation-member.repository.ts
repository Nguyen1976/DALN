import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import type { Prisma } from 'apps/chat/src/generated'
import { RedisService } from '@app/redis'
import { isObjectId } from '../domain/object-id'
import { buildMemberRow } from '../domain/member-row'
import { date, oid, rawUpdate } from './raw-ejson'
import type { MemberProfile } from 'libs/constant/member-profile'

/** An active member as the rest of the service needs them (and as cached). */
const MEMBER_SELECT = {
  userId: true,
  role: true,
  username: true,
  fullName: true,
  avatar: true,
} as const

export type MemberRow = Prisma.conversationMemberGetPayload<{
  select: typeof MEMBER_SELECT
}>

/** Danh sách thành viên của một cuộc trò chuyện. */
const membersKey = (conversationId: string) => `conv:members:${conversationId}`

/**
 * TTL an toàn. Mọi thay đổi thành viên đều invalidate tường minh, TTL chỉ là
 * lưới đỡ cho trường hợp có đường ghi nào đó bị bỏ sót.
 */
const MEMBERS_TTL_SECONDS = 300

/** Dòng thành viên chưa đọc tới `seq` (hoặc chưa từng đọc). */
const readBefore = (seq: number) => ({
  $or: [{ lastReadSeq: { $lt: seq } }, { lastReadSeq: null }],
})

/**
 * Phần `$set` (pipeline) tắt badge nhắc khi mốc đọc mới đã tới/qua lượt nhắc
 * cuối. Trong một stage `$set`, mọi biểu thức đọc giá trị CŨ của document.
 */
const clearMentionsUpTo = (seq: number) => {
  const past = { $lte: [{ $ifNull: ['$lastMentionSeq', 0] }, seq] }
  return {
    unreadMentionCount: { $cond: [past, 0, '$unreadMentionCount'] },
    lastMentionMessageId: { $cond: [past, null, '$lastMentionMessageId'] },
  }
}

/** ObjectId hex -> chữ thường; không phải ObjectId hợp lệ -> null. */
const normalizeObjectId = (value: unknown): string | null =>
  isObjectId(value) ? value.toLowerCase() : null

@Injectable()
export class ConversationMemberRepository {
  private readonly logger = new Logger(ConversationMemberRepository.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  // role chữ thường của dữ liệu cũ do migrations/chat/0002 chuẩn hoá một lần
  // lúc deploy — repository không còn backfill runtime.
  private readonly activeMemberFilter = {
    isActive: true,
  }

  /** Xoá cache thành viên của một hoặc nhiều cuộc trò chuyện. */
  async invalidateMembersCache(...conversationIds: string[]): Promise<void> {
    const ids = conversationIds.filter(Boolean)
    if (!ids.length) return
    try {
      await this.redisService.delMany(ids.map(membersKey))
    } catch (error) {
      // Cache hỏng không được làm hỏng nghiệp vụ; TTL sẽ tự dọn.
      this.logger.warn(
        `invalidateMembersCache thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Xoá cache mọi cuộc trò chuyện mà user tham gia.
   * Chỉ dùng khi hồ sơ user đổi (avatar/fullName được phi chuẩn hoá vào
   * conversationMember) — thao tác hiếm nên một query tra cứu là chấp nhận được.
   */
  private async invalidateMembersCacheByUserId(userId: string): Promise<void> {
    const rows = await this.prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    })
    await this.invalidateMembersCache(...rows.map((r) => r.conversationId))
  }

  /** A new conversation's members; `ownerId` owns a group. */
  async createMany(
    conversationId: string,
    profiles: MemberProfile[],
    { type, ownerId }: { type: 'DIRECT' | 'GROUP'; ownerId?: string },
  ) {
    const result = await this.prisma.conversationMember.createMany({
      data: profiles.map((profile) =>
        buildMemberRow(conversationId, profile, {
          type,
          role:
            type === 'GROUP' && profile.userId === ownerId ? 'OWNER' : 'MEMBER',
          members: profiles,
        }),
      ),
    })

    await this.invalidateMembersCache(conversationId)
    return result
  }

  /**
   * Danh sách thành viên — có cache Redis.
   *
   * Đây là điểm nóng nhất của hệ thống: sendMessage() gọi nó cho MỌI tin nhắn
   * để kiểm tra người gửi có trong nhóm và lấy thông tin hiển thị. Ở peak
   * 1000 msg/s là 1000 read Mongo/giây, trong khi thành phần nhóm gần như
   * không đổi. Cache cắt gần trọn lượng đọc đó.
   */
  async findByConversationId(conversationId: string): Promise<MemberRow[]> {
    const key = membersKey(conversationId)

    try {
      const cached = await this.redisService.get(key)
      if (cached) return JSON.parse(cached) as MemberRow[]
    } catch (error) {
      // Redis lỗi hoặc JSON hỏng -> rơi xuống đọc Mongo, không ném ra ngoài.
      this.logger.warn(
        `Đọc cache thành viên thất bại (${conversationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const members = await this.prisma.conversationMember.findMany({
      where: {
        conversationId,
        ...this.activeMemberFilter,
      },
      select: MEMBER_SELECT,
    })

    try {
      await this.redisService.setEx(
        key,
        JSON.stringify(members),
        MEMBERS_TTL_SECONDS,
      )
    } catch {
      /* ghi cache thất bại thì bỏ qua, lần sau thử lại */
    }

    return members
  }

  /**
   * Tin mới nhất đã lan tới mọi dòng thành viên — do cron gọi, mỗi hội thoại
   * một lần cho cả lô tin trong 5 giây. `$max` nên lệnh đến trễ không kéo lùi,
   * chạy lại bao nhiêu lần cũng vậy: không cần transaction.
   */
  async advanceMembers(
    conversationId: string,
    latest: { lastMessageAt: Date; seq: number },
  ) {
    return await rawUpdate(this.prisma, 'conversationMember', [
      {
        q: { conversationId: oid(conversationId) },
        u: {
          $max: {
            lastMessageAt: date(latest.lastMessageAt),
            latestSeq: latest.seq,
          },
        },
        multi: true,
      },
    ])
  }

  /**
   * Người gửi đã đọc tới tin của chính mình: tin của mình không bao giờ là
   * "chưa đọc" (unreadCount = latestSeq − lastReadSeq). Gửi tin sau lượt nhắc
   * cũng là đã đọc qua lượt nhắc đó.
   */
  async advanceReadOfSenders(
    conversationId: string,
    senders: { senderId: string; seq: number }[],
  ) {
    return await rawUpdate(
      this.prisma,
      'conversationMember',
      senders.map(({ senderId, seq }) => ({
        q: {
          conversationId: oid(conversationId),
          userId: oid(senderId),
          ...this.activeMemberFilter,
        },
        u: [
          {
            $set: {
              lastReadSeq: { $max: [{ $ifNull: ['$lastReadSeq', 0] }, seq] },
              ...clearMentionsUpTo(seq),
            },
          },
        ],
      })),
    )
  }

  /**
   * Đánh dấu `userIds` đã đọc tới `seq` (chỉ tiến lên): người vừa được thêm vào
   * nhóm không bị tính tin hệ thống báo chính việc họ được thêm.
   */
  async markReadUpTo(conversationId: string, userIds: string[], seq: number) {
    if (!userIds.length) return 0
    // Cùng một seq cho mọi người: MỘT câu multi, không phải một câu mỗi người.
    return await rawUpdate(this.prisma, 'conversationMember', [
      {
        q: {
          conversationId: oid(conversationId),
          userId: { $in: userIds.map(oid) },
          ...this.activeMemberFilter,
        },
        u: [
          {
            $set: {
              lastReadSeq: { $max: [{ $ifNull: ['$lastReadSeq', 0] }, seq] },
              ...clearMentionsUpTo(seq),
            },
          },
        ],
        multi: true,
      },
    ])
  }

  /**
   * Nhắc tên: MỘT lệnh cho cả nhóm. Bỏ qua người đã đọc tới/qua tin này — họ
   * đang mở hội thoại và đọc trước khi lệnh này kịp chạy, cộng nữa là badge ảo
   * không bao giờ tắt (lần đọc sau không còn "tiến lên").
   */
  async markMention(
    conversationId: string,
    userIds: string[],
    messageId: string,
    seq: number,
  ) {
    if (!userIds.length) return
    await rawUpdate(this.prisma, 'conversationMember', [
      {
        q: {
          conversationId: oid(conversationId),
          userId: { $in: userIds.map(oid) },
          ...this.activeMemberFilter,
          ...readBefore(seq),
        },
        u: [
          {
            $set: {
              unreadMentionCount: {
                $add: [{ $ifNull: ['$unreadMentionCount', 0] }, 1],
              },
              lastMentionSeq: {
                $max: [{ $ifNull: ['$lastMentionSeq', 0] }, seq],
              },
              lastMentionMessageId: {
                $cond: [
                  { $gt: [seq, { $ifNull: ['$lastMentionSeq', 0] }] },
                  oid(messageId),
                  '$lastMentionMessageId',
                ],
              },
            },
          },
        ],
        multi: true,
      },
    ])
  }

  async clearMentions(conversationId: string, userId: string) {
    const count = await rawUpdate(this.prisma, 'conversationMember', [
      {
        q: {
          conversationId: oid(conversationId),
          userId: oid(userId),
          ...this.activeMemberFilter,
        },
        u: { $set: { unreadMentionCount: 0, lastMentionMessageId: null } },
      },
    ])
    return { count }
  }

  async findByConversationIdAndUserId(conversationId: string, userId: string) {
    return await this.prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
      },
    })
  }

  /**
   * Add (or bring back) people to a group; returns how many changed.
   *
   * A fixed number of commands whatever the number of people: one read of who
   * is already there, one raw update bringing back those who had left, one
   * insert for the rest. It used to be 2–3 commands per person, each Prisma
   * `updateMany` a transaction of its own on MongoDB.
   *
   * Everyone joins having read everything so far (`lastReadSeq = lastSeq`): a
   * newcomer's badge is 0, not the conversation's history, and someone coming
   * back is not charged for what was said while they were gone.
   */
  async addMembers(conversationId: string, members: MemberProfile[]) {
    if (!members.length) return 0
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lastSeq: true },
    })
    const seq = conversation?.lastSeq ?? 0

    const existing = await this.prisma.conversationMember.findMany({
      where: { conversationId, userId: { in: members.map((m) => m.userId) } },
      select: { userId: true, isActive: true },
    })
    const known = new Map(existing.map((row) => [row.userId, row.isActive]))
    const returning = members.filter((m) => known.get(m.userId) === false)
    const fresh = members.filter((m) => !known.has(m.userId))
    const now = new Date()

    await rawUpdate(
      this.prisma,
      'conversationMember',
      returning.map((member) => ({
        q: { conversationId: oid(conversationId), userId: oid(member.userId) },
        u: {
          $set: {
            role: 'MEMBER',
            isActive: true,
            username: member.username || null,
            fullName: member.fullName || null,
            avatar: member.avatar || null,
            lastMessageAt: date(now),
            lastReadSeq: seq,
            latestSeq: seq,
            unreadMentionCount: 0,
            lastMentionMessageId: null,
          },
        },
      })),
    )
    if (fresh.length) {
      await this.prisma.conversationMember.createMany({
        data: fresh.map((member) =>
          buildMemberRow(conversationId, member, {
            type: 'GROUP',
            members,
            seq,
          }),
        ),
      })
    }

    await this.invalidateMembersCache(conversationId)
    return returning.length + fresh.length
  }

  /**
   * Ghi nhận user đã đọc tới tin `lastReadMessageId`: MỘT lệnh, chỉ khi mốc tiến
   * lên (sự kiện đọc đến lệch thứ tự rất thường — client bắn một lần mỗi khi
   * danh sách tin đổi). Không còn đếm lại: unreadCount = latestSeq − lastReadSeq.
   * Đọc qua lượt nhắc cuối thì tắt luôn badge nhắc.
   *
   * Trả `{ count }` = số dòng có mốc tiến lên (0 hoặc 1), như trước.
   */
  async updateLastRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ) {
    const messageId = normalizeObjectId(lastReadMessageId)
    if (!messageId) return { count: 0 }

    // Tin phải thuộc CHÍNH hội thoại này. Id đến từ client: trước đây một id
    // giả thật lớn đẩy được marker lên "tương lai" và chặn mọi lần đọc sau đó.
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { seq: true },
    })
    if (typeof message?.seq !== 'number') return { count: 0 }
    const seq = message.seq

    const count = await rawUpdate(this.prisma, 'conversationMember', [
      {
        q: {
          conversationId: oid(conversationId),
          userId: oid(userId),
          ...this.activeMemberFilter,
          ...readBefore(seq),
        },
        u: [
          {
            $set: {
              lastReadSeq: seq,
              ...clearMentionsUpTo(seq),
            },
          },
        ],
      },
    ])
    return { count }
  }

  /** Xoá lịch sử phía mình: ẩn mọi tin tới hiện tại, coi như đã đọc hết. */
  async clearHistoryForMember(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lastSeq: true },
    })
    const lastSeq = conversation?.lastSeq ?? 0
    const count = await rawUpdate(this.prisma, 'conversationMember', [
      {
        q: { conversationId: oid(conversationId), userId: oid(userId) },
        u: {
          $set: { clearedHistorySeq: lastSeq, lastReadSeq: lastSeq },
        },
      },
    ])
    return { count }
  }

  async updateByUserId(
    userId: string,
    data: {
      avatar?: string
      fullName?: string
    },
  ) {
    const result = await this.prisma.conversationMember.updateMany({
      where: {
        userId,
      },
      data: {
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
      },
    })

    // Đối phương của người khác chính là user này -> phải cập nhật cả bản phi
    // chuẩn hoá `peer*` trên dòng membership của họ, nếu không danh sách hội
    // thoại của họ sẽ hiện tên/avatar cũ mãi (danh sách không đọc `members`
    // nữa nên không có đường tự sửa).
    await this.prisma.conversationMember.updateMany({
      where: { peerUserId: userId },
      data: {
        ...(data.avatar !== undefined ? { peerAvatar: data.avatar } : {}),
        ...(data.fullName !== undefined ? { peerFullName: data.fullName } : {}),
      },
    })

    // avatar/fullName nằm trong bản cache -> phải dọn mọi cuộc trò chuyện của
    // user này. Đổi hồ sơ là thao tác hiếm nên một query tra cứu là xứng đáng.
    await this.invalidateMembersCacheByUserId(userId)
    return result
  }

  async removeMember(conversationId: string, userId: string) {
    const existing = await this.prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
      },
      select: {
        isActive: true,
      },
    })

    if (!existing?.isActive) {
      return false
    }

    await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        isActive: false,
      },
    })

    await this.invalidateMembersCache(conversationId)
    return true
  }

  async promoteToOwner(conversationId: string, userId: string) {
    const result = await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
      },
      data: {
        role: 'OWNER',
      },
    })

    await this.invalidateMembersCache(conversationId)
    return result
  }

  async promoteToAdmin(conversationId: string, userId: string) {
    const result = await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
        ...this.activeMemberFilter,
      },
      data: {
        role: 'ADMIN',
      },
    })

    await this.invalidateMembersCache(conversationId)
    return result
  }
}
