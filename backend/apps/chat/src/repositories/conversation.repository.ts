import { Inject, Injectable } from '@nestjs/common'
import { conversationType, type Prisma } from 'apps/chat/src/generated'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { RedisService } from '@app/redis'
import { olderThanCursor, type KeysetCursor } from '@app/util'
import { date, oid, rawUpdate } from './raw-ejson'

/**
 * A conversation as a row of the caller's list, read off their membership.
 * The DIRECT peer comes from the membership row itself, not from an
 * `include: { members }`: that include grows with the member count (measured
 * 2 -> 1.56ms, 500 -> 6.10ms) while these fields keep the query flat (0.85ms)
 * however big a group is.
 */
const LIST_ROW_SELECT = {
  unreadMentionCount: true,
  // unreadCount = latestSeq − lastReadSeq (ConversationMapper).
  lastReadSeq: true,
  latestSeq: true,
  lastMentionMessageId: true,
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
  lastMessageAt: true,
  unreadMentionCount: true,
  lastMentionMessageId: true,
  lastReadSeq: true,
  latestSeq: true,
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
        // Bộ đếm seq có ngay từ đầu: seq-allocator từ chối hội thoại thiếu nó.
        lastSeq: 0,
      },
    })
  }

  /** Null for a conversation that is deleted and waiting to be purged. */
  async findById(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    })
    return conversation?.deletedAt ? null : conversation
  }

  /** A conversation with its active members, as detail views and events need. */
  async findByIdWithMembers(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        members: { where: this.activeMemberWhere, select: MEMBER_VIEW_SELECT },
      },
    })
    return conversation?.deletedAt ? null : conversation
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

  /**
   * The last-message snapshot the conversation list shows — only when `seq` is
   * newer than the one already shown. Written unconditionally, a reply (held
   * back while its quote was looked up) landing after the plain message sent
   * right behind it made the list show the older one (10/10 trials). A raw
   * update: Prisma's `update` is fine, but the condition is not a unique key.
   */
  async saveLastMessage(
    conversationId: string,
    data: {
      seq: number
      lastMessageId?: string | null
      lastMessageAt?: Date
      lastMessageText?: string | null
      lastMessageSenderId?: string | null
      lastMessageSenderName?: string | null
      lastMessageSenderAvatar?: string | null
    },
  ) {
    const { seq, ...fields } = data
    const set: Record<string, unknown> = {
      updatedAt: date(new Date()),
      lastMessageSeq: seq,
    }
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue
      set[key] =
        value instanceof Date
          ? date(value)
          : key === 'lastMessageId' && typeof value === 'string'
            ? oid(value)
            : value
    }
    return await rawUpdate(this.prisma, 'conversation', [
      {
        q: {
          _id: oid(conversationId),
          $or: [{ lastMessageSeq: null }, { lastMessageSeq: { $lt: seq } }],
        },
        u: { $set: set },
      },
    ])
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

  /**
   * Delete = hide now, purge later. The conversation is marked `deletedAt`
   * (seq-allocator then refuses new messages into it) and every member row is
   * deactivated, which is what takes it out of every list, search and send
   * check at once. `ConversationPurgeCron` removes the messages in batches.
   *
   * It used to load every message id and delete everything in ONE transaction
   * with a `$in` of all of them — at 300,000 messages that is past what a
   * MongoDB transaction allows, so the delete failed and failed again.
   */
  async deleteConversationById(conversationId: string) {
    await rawUpdate(this.prisma, 'conversation', [
      {
        q: { _id: oid(conversationId) },
        u: { $set: { deletedAt: date(new Date()) } },
      },
    ])
    await rawUpdate(this.prisma, 'conversationMember', [
      {
        q: { conversationId: oid(conversationId) },
        u: { $set: { isActive: false } },
        multi: true,
      },
    ])

    // Cuộc trò chuyện đã biến mất -> dọn cache thành viên kèm theo.
    await this.redisService.delMany([`conv:members:${conversationId}`])
  }
}
