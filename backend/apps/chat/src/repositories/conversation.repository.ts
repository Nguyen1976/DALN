import { Inject, Injectable } from '@nestjs/common'
import { conversationType, type Prisma } from 'apps/chat/src/generated'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { RedisService } from '@app/redis'
import { olderThanCursor, type KeysetCursor } from '@app/util'

/**
 * A conversation as a row of the caller's list, read off their membership.
 * The DIRECT peer comes from the membership row itself, not from an
 * `include: { members }`: that include grows with the member count (measured
 * 2 -> 1.56ms, 500 -> 6.10ms) while these fields keep the query flat (0.85ms)
 * however big a group is.
 */
const LIST_ROW_SELECT = {
  unreadCount: true,
  unreadMentionCount: true,
  lastMentionMessageId: true,
  lastReadAt: true,
  lastMessageAt: true,
  peerUserId: true,
  peerUsername: true,
  peerFullName: true,
  peerAvatar: true,
  conversation: true,
} as const

/** What a member row brings to a conversation's detail. */
const MEMBER_VIEW_SELECT = {
  userId: true,
  role: true,
  username: true,
  fullName: true,
  avatar: true,
  lastReadAt: true,
  lastReadMessageId: true,
  lastMessageAt: true,
  unreadCount: true,
  unreadMentionCount: true,
  lastMentionMessageId: true,
} as const

const toListRow = ({
  conversation,
  ...membership
}: Prisma.conversationMemberGetPayload<{
  select: typeof LIST_ROW_SELECT
}>) => ({
  ...conversation,
  ...membership,
})

@Injectable()
export class ConversationRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  // Dữ liệu cũ (updatedAt null, role chữ thường) do migrations/chat/0001, 0002
  // chuẩn hoá một lần lúc deploy — repository không còn backfill lúc runtime.
  private readonly activeMemberWhere = {
    isActive: true,
  }

  async findConversationByFriendId(friendId: string, userId: string) {
    return await this.prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        members: {
          some: { userId, ...this.activeMemberWhere },
          every: {
            OR: [
              { userId, ...this.activeMemberWhere },
              { userId: friendId, ...this.activeMemberWhere },
            ],
          },
        },
      },
      include: {
        members: { where: this.activeMemberWhere, select: MEMBER_VIEW_SELECT },
      },
    })
  }

  private normalizeString(str: string) {
    return str
      .normalize('NFD') // tách ký tự + dấu
      .replace(/[\u0300-\u036f]/g, '') // xóa dấu
      .replace(/đ/g, 'd') // xử lý riêng đ
      .replace(/Đ/g, 'D')
      .toLowerCase()
  }

  async create(data: {
    type: conversationType
    groupName?: string
    groupAvatar?: string
    memberCount?: number
  }) {
    return await this.prisma.conversation.create({
      data: {
        type: data.type,
        groupName: data.groupName || null,
        groupNameSearch: data.groupName
          ? this.normalizeString(data.groupName)
          : null,
        groupAvatar: data.groupAvatar || null,
        memberCount: data.memberCount ?? 0,
      },
    })
  }

  async findById(id: string) {
    return await this.prisma.conversation.findUnique({
      where: { id },
    })
  }

  /** A conversation with its active members, as detail views and events need. */
  async findByIdWithMembers(id: string) {
    return await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        members: { where: this.activeMemberWhere, select: MEMBER_VIEW_SELECT },
      },
    })
  }

  async findByUserIdPaginated(
    userId: string,
    cursor: KeysetCursor | null,
    take: number,
  ) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: {
        userId,
        ...this.activeMemberWhere,
        // Ordering by lastMessageAt alone dropped every conversation that
        // shared the boundary timestamp — the friendship saga stamps several
        // at once, so this was reachable in normal use.
        // Ties break on conversationId: that is the id each row goes out
        // with, so it is the id the next cursor carries back. Breaking them
        // on the membership row's own id compared ids from two collections.
        ...olderThanCursor('lastMessageAt', cursor, 'conversationId'),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { conversationId: 'desc' }],
      take,
      select: LIST_ROW_SELECT,
    })
    return memberships.map(toListRow)
  }

  /**
   * The caller's groups whose name starts with `keyword` (accents ignored),
   * as list rows. Direct conversations are found from the friend list, not
   * here.
   */
  async searchGroups(userId: string, keyword: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: {
        userId,
        ...this.activeMemberWhere,
        conversation: {
          is: {
            type: 'GROUP',
            groupNameSearch: { startsWith: this.normalizeString(keyword) },
          },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { conversationId: 'desc' }],
      take: 20,
      select: LIST_ROW_SELECT,
    })
    return memberships.map(toListRow)
  }

  /** The last-message snapshot the conversation list shows. */
  async saveLastMessage(
    conversationId: string,
    data?: {
      lastMessageId?: string | null
      lastMessageAt?: Date
      lastMessageText?: string | null
      lastMessageSenderId?: string | null
      lastMessageSenderName?: string | null
      lastMessageSenderAvatar?: string | null
    },
  ) {
    return await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        ...(data?.lastMessageId !== undefined
          ? { lastMessageId: data.lastMessageId }
          : {}),
        ...(data?.lastMessageAt ? { lastMessageAt: data.lastMessageAt } : {}),
        ...(data?.lastMessageText !== undefined
          ? { lastMessageText: data.lastMessageText }
          : {}),
        ...(data?.lastMessageSenderId !== undefined
          ? { lastMessageSenderId: data.lastMessageSenderId }
          : {}),
        ...(data?.lastMessageSenderName !== undefined
          ? { lastMessageSenderName: data.lastMessageSenderName }
          : {}),
        ...(data?.lastMessageSenderAvatar !== undefined
          ? { lastMessageSenderAvatar: data.lastMessageSenderAvatar }
          : {}),
      },
    })
  }

  async incrementMemberCount(conversationId: string, delta: number) {
    if (!delta) return null

    return await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        memberCount: {
          increment: delta,
        },
      },
    })
  }

  async deleteConversationById(conversationId: string) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      select: { id: true, pollId: true },
    })

    const messageIds = messages.map((message) => message.id)
    const pollIds = messages
      .map((message) => message.pollId)
      .filter((pollId): pollId is string => Boolean(pollId))

    await this.prisma.$transaction(async (transaction) => {
      if (messageIds.length > 0) {
        await transaction.messageMedia.deleteMany({
          where: {
            messageId: {
              in: messageIds,
            },
          },
        })

        await transaction.deleteMessage.deleteMany({
          where: {
            messageId: {
              in: messageIds,
            },
          },
        })

        if (pollIds.length > 0) {
          await transaction.pollVote.deleteMany({
            where: {
              pollId: {
                in: pollIds,
              },
            },
          })

          await transaction.poll.deleteMany({
            where: {
              id: {
                in: pollIds,
              },
            },
          })
        }
      }

      await transaction.message.deleteMany({
        where: { conversationId },
      })

      await transaction.conversationMember.deleteMany({
        where: { conversationId },
      })

      await transaction.conversation.delete({
        where: { id: conversationId },
      })
    })

    // Cuộc trò chuyện đã biến mất -> dọn cache thành viên kèm theo.
    await this.redisService.delMany([`conv:members:${conversationId}`])
  }
}
