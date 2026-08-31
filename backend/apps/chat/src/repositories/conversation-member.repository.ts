import { Inject, Injectable, Logger } from '@nestjs/common'
import { Member } from '../http/chat-http.dto'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { conversationType } from 'apps/chat/src/generated'
import { RedisService } from '@app/redis'

type CachedMember = {
  userId: string
  role: string | null
  username: string | null
  fullName: string | null
  avatar: string | null
  joinedAt: string | null
}

/** Danh sách thành viên của một cuộc trò chuyện. */
const membersKey = (conversationId: string) => `conv:members:${conversationId}`

/**
 * TTL an toàn. Mọi thay đổi thành viên đều invalidate tường minh, TTL chỉ là
 * lưới đỡ cho trường hợp có đường ghi nào đó bị bỏ sót.
 */
const MEMBERS_TTL_SECONDS = 300

@Injectable()
export class ConversationMemberRepository {
  private readonly logger = new Logger(ConversationMemberRepository.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private participantRoleBackfilled = false
  private unreadCountBackfilled = false
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

  private async forceBackfillUnreadCount() {
    await this.prisma.$runCommandRaw({
      update: 'conversationMember',
      updates: [
        {
          q: {
            $or: [{ unreadCount: null }, { unreadCount: { $exists: false } }],
          },
          u: [
            {
              $set: {
                unreadCount: 0,
              },
            },
          ],
          multi: true,
        },
      ],
    })
  }

  private async ensureUnreadCountInitialized() {
    if (this.unreadCountBackfilled) return
    await this.forceBackfillUnreadCount()
    this.unreadCountBackfilled = true
  }

  private async forceBackfillParticipantRole() {
    await this.prisma.$runCommandRaw({
      update: 'conversationMember',
      updates: [
        {
          q: {
            $or: [
              { role: null },
              { role: { $exists: false } },
              { role: 'member' },
              { role: 'admin' },
              { role: 'owner' },
            ],
          },
          u: [
            {
              $set: {
                role: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$role', 'admin'] }, then: 'ADMIN' },
                      { case: { $eq: ['$role', 'owner'] }, then: 'OWNER' },
                      { case: { $eq: ['$role', 'member'] }, then: 'MEMBER' },
                    ],
                    default: 'MEMBER',
                  },
                },
              },
            },
          ],
          multi: true,
        },
      ],
    })
  }

  private async ensureParticipantRoleNormalized() {
    if (this.participantRoleBackfilled) return
    await this.forceBackfillParticipantRole()
    this.participantRoleBackfilled = true
  }

  private async withRoleRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      const message = String((error as any)?.message || '')
      const isParticipantRoleError =
        message.includes(
          "Value 'member' not found in enum 'participantRole'",
        ) ||
        message.includes("Value 'admin' not found in enum 'participantRole'") ||
        message.includes("Value 'owner' not found in enum 'participantRole'")

      if (!isParticipantRoleError) {
        throw error
      }

      await this.forceBackfillParticipantRole()
      return await fn()
    }
  }

  async createMany(
    conversationId: string,
    members: Member[],
    createrId: string,
    type: conversationType,
  ) {
    const result = await this.prisma.conversationMember.createMany({
      data: members.map((member: Member) => ({
        ...member,
        conversationId,
        userId: member.userId,
        role:
          type === conversationType.GROUP && createrId === member.userId
            ? 'ADMIN'
            : 'MEMBER',
        isActive: true,
        unreadCount: 0,
        lastReadMessageId: null,
        lastMessageAt: new Date(),
      })),
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
  async findByConversationId(conversationId: string) {
    const key = membersKey(conversationId)

    try {
      const cached = await this.redisService.get(key)
      if (cached) {
        const rows = JSON.parse(cached) as CachedMember[]
        return rows.map((row) => ({
          ...row,
          joinedAt: row.joinedAt ? new Date(row.joinedAt) : null,
        }))
      }
    } catch (error) {
      // Redis lỗi hoặc JSON hỏng -> rơi xuống đọc Mongo, không ném ra ngoài.
      this.logger.warn(
        `Đọc cache thành viên thất bại (${conversationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const members = await this.withRoleRetry(() =>
      this.prisma.conversationMember.findMany({
        where: {
          conversationId,
          ...this.activeMemberFilter,
        },
        select: {
          userId: true,
          role: true,
          username: true,
          fullName: true,
          avatar: true,
          joinedAt: true,
        },
      }),
    )

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

  async updateLastMessageAt(conversationId: string, lastMessageAt: Date) {
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
      },
      data: {
        lastMessageAt: lastMessageAt,
      },
    })
  }

  async updateUnreadCount(
    conversationId: string,
    senderId: string,
    unreadCount: number,
  ) {
    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId: {
          not: senderId,
        },
        ...this.activeMemberFilter,
      },
      data: {
        unreadCount: {
          increment: unreadCount,
        },
      },
    })
  }

  async findByConversationIdAndUserIds(
    conversationId: string,
    userIds: string[],
  ) {
    await this.ensureParticipantRoleNormalized()
    await this.ensureUnreadCountInitialized()

    return await this.withRoleRetry(() =>
      this.prisma.conversationMember.findMany({
        where: {
          conversationId,
          userId: { in: userIds },
          ...this.activeMemberFilter,
        },
        select: { userId: true },
      }),
    )
  }

  async findByConversationIdAndUserId(conversationId: string, userId: string) {
    await this.ensureParticipantRoleNormalized()
    await this.ensureUnreadCountInitialized()

    return await this.withRoleRetry(() =>
      this.prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
          ...this.activeMemberFilter,
        },
      }),
    )
  }

  async addMembers(
    conversationId: string,
    members: Array<{
      userId: string
      username?: string
      fullName?: string
      avatar?: string
    }>,
  ) {
    let changedCount = 0

    for (const member of members) {
      const existing = await this.prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId: member.userId,
        },
        select: {
          isActive: true,
        },
      })

      const updated = await this.prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: member.userId,
        },
        data: {
          role: 'MEMBER',
          isActive: true,
          username: member.username || null,
          fullName: member.fullName || null,
          avatar: member.avatar || null,
          lastMessageAt: new Date(),
        },
      })

      if (updated.count > 0) {
        if (!existing?.isActive) {
          changedCount += 1
        }
        continue
      }

      await this.prisma.conversationMember.create({
        data: {
          conversationId,
          userId: member.userId,
          username: member.username || null,
          fullName: member.fullName || null,
          avatar: member.avatar || null,
          role: 'MEMBER',
          isActive: true,
          unreadCount: 0,
          lastMessageAt: new Date(),
        },
      })

      changedCount += 1
    }

    await this.invalidateMembersCache(conversationId)
    return changedCount
  }

  async updateLastRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ) {
    if (!/^[a-f\d]{24}$/i.test(lastReadMessageId)) {
      return { count: 0 }
    }

    await this.ensureUnreadCountInitialized()

    // A read marker may only ever move forward. The client emits one read per
    // change to its message list, and those arrive out of order often enough
    // to matter — a late event carrying an older id used to overwrite a newer
    // one, so the sender's "đã xem" marker silently rolled back to an earlier
    // message (or disappeared). Mongo ObjectIds start with a timestamp and sort
    // in creation order, so comparing them is enough to tell newer from older.
    const current = await this.prisma.conversationMember.findFirst({
      where: { conversationId, userId },
      select: { lastReadMessageId: true },
    })

    if (
      current?.lastReadMessageId &&
      current.lastReadMessageId >= lastReadMessageId
    ) {
      return { count: 0 }
    }

    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        lastReadAt: new Date(),
        lastReadMessageId,
        unreadCount: 0,
      },
    })
  }

  async clearHistoryForMember(
    conversationId: string,
    userId: string,
    clearedHistoryAt: Date,
  ) {
    await this.ensureUnreadCountInitialized()

    return await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        clearedHistoryAt,
        unreadCount: 0,
        lastReadAt: clearedHistoryAt,
        lastReadMessageId: null,
      },
    })
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

  // async findUserProfileById(userId: string) {
  //   return await this.prisma.user.findUnique({
  //     where: {
  //       id: userId,
  //     },
  //     select: {
  //       username: true,
  //       fullName: true,
  //       avatar: true,
  //     },
  //   })
  // }

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
