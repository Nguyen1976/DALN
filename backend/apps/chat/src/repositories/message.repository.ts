import { Inject, Injectable } from '@nestjs/common'
import { messageType, Prisma } from 'apps/chat/src/generated'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { MessageBatchWriter } from '../services/message-batch-writer.service'
import { olderThanCursor, type KeysetCursor } from '@app/util'
import { isUniqueConstraintError } from '@app/saga'
import type { MessageMediaInput } from 'libs/constant/rmq/payload'

const SENDER_SELECT = {
  select: { userId: true, username: true, fullName: true, avatar: true },
} as const

/** What a message row brings along when it is shown in a thread. */
const MESSAGE_INCLUDE = {
  senderMember: SENDER_SELECT,
  medias: { orderBy: { sortOrder: 'asc' } },
  poll: true,
} satisfies Prisma.messageInclude

@Injectable()
export class MessageRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly batchWriter: MessageBatchWriter,
  ) {}

  async create(data: {
    conversationId: string
    senderId: string
    type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'POLL'
    content?: string | null
    replyToMessageId?: string | null
    pollId?: string | null
    medias?: MessageMediaInput[]
    isSystem?: boolean
    mentionUserIds?: string[]
    mentions?: unknown
  }) {
    // Đường nóng: tin nhắn thuần văn bản, không media, không poll — chiếm đại
    // đa số lưu lượng. Gom lô qua createMany thay vì mỗi tin một create().
    // Tin có media/poll cần nested write + quan hệ nên giữ nguyên đường cũ;
    // chúng hiếm nên không ảnh hưởng thông lượng.
    if (!data.medias?.length && !data.pollId) {
      return await this.batchWriter.enqueue({
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: data.type,
        content: data.content,
        replyToMessageId: data.replyToMessageId,
        isSystem: data.isSystem,
        mentionUserIds: data.mentionUserIds,
        mentions: data.mentions,
      })
    }

    // Ghi dữ liệu & trả về trong 1 nhịp duy nhất (nested writes)
    const created = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: data.type,
        content: data.content || null,
        replyToMessageId: data.replyToMessageId || null,
        pollId: data.pollId || null,
        mentionUserIds: data.mentionUserIds || [],
        mentions: (data.mentions ?? undefined) as Prisma.InputJsonValue,

        // Khởi tạo Medias luôn (Prisma tự động làm Transaction ngầm)
        medias: data.medias?.length
          ? {
              create: data.medias.map((media, index) => ({
                mediaType: media.mediaType,
                objectKey: media.objectKey,
                url: media.url,
                mimeType: media.mimeType,
                size: BigInt(media.size),
                width: media.width ?? null,
                height: media.height ?? null,
                duration: media.duration ?? null,
                thumbnailUrl: media.thumbnailUrl ?? null,
                fileName: media.fileName ?? null,
                sortOrder: media.sortOrder ?? index,
              })),
            }
          : undefined,
      },
      // Chỉ include quan hệ khi tin nhắn THỰC SỰ có quan hệ đó. Prisma bắn
      // một truy vấn riêng cho mỗi relation trong `include` — profile Mongo
      // cho thấy 341 lệnh `messageMedia` cho 340 tin nhắn TEXT thuần, tức mỗi
      // tin nhắn văn bản đang trả tiền cho một truy vấn luôn rỗng.
      include: {
        ...(data.medias?.length
          ? { medias: { orderBy: { sortOrder: 'asc' as const } } }
          : {}),
        ...(data.pollId ? { poll: true as const } : {}),
      },
    })

    // Giữ nguyên hình dạng trả về để bên gọi không phải đổi.
    const loaded = created as Partial<
      Prisma.messageGetPayload<{ include: { medias: true; poll: true } }>
    >
    return {
      ...created,
      medias: loaded.medias ?? [],
      poll: loaded.poll ?? null,
    }
  }

  /**
   * Ghi một tin tổng kết cuộc gọi (type=CALL) kèm `callInfo` có cấu trúc để client
   * render thẻ "Cuộc gọi" + nút Gọi lại/Tham gia lại. Ghi THẲNG (không qua batch
   * writer vốn chỉ nhận TEXT) vì tin gọi hiếm, cần chắc chắn có mặt.
   */
  async createCallLog(data: {
    conversationId: string
    senderId: string
    content: string
    callInfo: Record<string, unknown>
  }) {
    const created = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: messageType.CALL,
        content: data.content,
        callInfo: data.callInfo as Prisma.InputJsonObject,
        isSystem: true,
      },
    })
    return { ...created, medias: [], poll: null }
  }

  async findById(id: string, conversationId: string) {
    return await this.prisma.message.findFirst({
      where: {
        id,
        conversationId,
      },
    })
  }

  /**
   * A page of the thread as `userId` sees it: nothing from before they
   * cleared their history, nothing they deleted for themselves.
   */
  async findByConversationIdPaginatedForUser(
    conversationId: string,
    userId: string,
    take: number,
    cursor: KeysetCursor | null,
    clearedHistoryAt: Date | null,
  ) {
    const batchSize = Math.max(take * 3, 30)
    const messages: Prisma.messageGetPayload<{
      include: typeof MESSAGE_INCLUDE
    }>[] = []
    let nextCursor: KeysetCursor | null = cursor

    while (messages.length < take) {
      // Both the cursor and the cleared-history mark constrain `createdAt`.
      // They used to be spread in as two separate `createdAt` keys, so the
      // second overwrote the first: a user who had cleared their history lost
      // the cursor entirely and "load older" kept returning the same newest
      // page for ever. Collecting them into one AND keeps both in force.
      const bounds: Prisma.messageWhereInput[] = []
      if (nextCursor) bounds.push(olderThanCursor('createdAt', nextCursor))
      if (clearedHistoryAt) {
        bounds.push({ createdAt: { gt: clearedHistoryAt } })
      }

      const batch = await this.prisma.message.findMany({
        where: {
          conversationId,
          ...(bounds.length ? { AND: bounds } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: batchSize,
        include: MESSAGE_INCLUDE,
      })

      if (!batch.length) break

      // Only this batch's delete-for-me marks: a user's marks across every
      // conversation can be many more than one page.
      const deletedMessageIds = new Set(
        (
          await this.prisma.deleteMessage.findMany({
            where: { userId, messageId: { in: batch.map((m) => m.id) } },
            select: { messageId: true },
          })
        ).map((item) => item.messageId),
      )

      for (const message of batch) {
        if (deletedMessageIds.has(message.id)) continue
        messages.push(message)

        if (messages.length === take) break
      }

      if (batch.length < batchSize) break

      const last = batch[batch.length - 1]
      if (!last?.createdAt) break
      nextCursor = { at: last.createdAt, id: last.id }
    }

    return messages.slice(0, take)
  }

  async createDeleteMessage(messageId: string, userId: string) {
    try {
      return await this.prisma.deleteMessage.create({
        data: {
          messageId,
          userId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return null
      }

      throw error
    }
  }

  async revokeMessage(
    messageId: string,
    conversationId: string,
    userId: string,
  ) {
    return await this.prisma.message.updateMany({
      where: {
        id: messageId,
        conversationId,
        senderId: userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
        content: '',
      },
    })
  }

  /**
   * Minimal shape of the messages other messages quote.
   *
   * Fetched in one bulk query per page rather than through a Prisma `include`:
   * an include fires a separate query for every message, and the overwhelming
   * majority of messages are not replies.
   */
  async findQuotedByIds(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return []

    return await this.prisma.message.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        type: true,
        isRevoked: true,
        isDeleted: true,
        createdAt: true,
        senderMember: SENDER_SELECT,
        medias: { select: { mediaType: true, fileName: true }, take: 1 },
      },
    })
  }

  async findConversationAssets(
    conversationId: string,
    kind: 'MEDIA' | 'LINK' | 'DOC',
    take: number,
    cursor?: KeysetCursor | null,
  ) {
    // Which messages count as this kind of asset.
    const kindWhere = {
      MEDIA: {
        OR: [
          { type: { in: ['IMAGE', 'VIDEO'] } },
          { medias: { some: { mediaType: { in: ['IMAGE', 'VIDEO'] } } } },
        ],
      },
      DOC: {
        OR: [{ type: 'FILE' }, { medias: { some: { mediaType: 'FILE' } } }],
      },
      LINK: {
        OR: [
          { content: { contains: 'http' } },
          { content: { contains: 'www.' } },
        ],
      },
    } satisfies Record<typeof kind, Prisma.messageWhereInput>

    return await this.prisma.message.findMany({
      where: {
        conversationId,
        isDeleted: false,
        // Both filters are an OR of their own, so they meet under AND.
        // Spreading the cursor in and then assigning `where.OR` for the kind
        // overwrote the cursor's OR: every "next page" came back as the first
        // page again.
        AND: [
          // Same tie-safe cursor as the message list: several attachments sent
          // together share a timestamp, and a bare `lt` drops the ones that
          // fell on the page boundary.
          olderThanCursor('createdAt', cursor ?? null),
          kindWhere[kind],
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: MESSAGE_INCLUDE,
    })
  }
}
