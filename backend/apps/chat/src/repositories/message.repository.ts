import { Inject, Injectable } from '@nestjs/common'
import { messageType, Prisma } from 'apps/chat/src/generated'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { MessageBatchWriter } from '../services/message-batch-writer.service'
import { isUniqueConstraintError } from '@app/saga'
import type { MessageMediaInput } from 'libs/constant/rmq/payload'
import { findStoredBySenderClientIds } from './message-raw.queries'
import { reserveSeq } from './seq-allocator'
import { facetsOf } from '../domain/message-facets'

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

  async create(
    data: {
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
      /** Khoá chống trùng do client sinh; tin poll/hệ thống không có. */
      clientMessageId?: string
    },
    /**
     * Gọi khi thứ tự của tin đã chốt: tin văn bản vào lô là đã có id và
     * createdAt. Tin media/poll lấy createdAt lúc ghi nên không gọi.
     */
    onQueued?: () => void,
  ) {
    // Đường nóng: tin nhắn thuần văn bản, không media, không poll — chiếm đại
    // đa số lưu lượng. Gom lô qua createMany thay vì mỗi tin một create().
    // Tin có media/poll cần nested write + quan hệ nên giữ nguyên đường cũ;
    // chúng hiếm nên không ảnh hưởng thông lượng.
    if (!data.medias?.length && !data.pollId) {
      const written = this.batchWriter.enqueue({
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: data.type,
        content: data.content,
        replyToMessageId: data.replyToMessageId,
        isSystem: data.isSystem,
        mentionUserIds: data.mentionUserIds,
        mentions: data.mentions,
        clientMessageId: data.clientMessageId,
      })
      onQueued?.()
      return await written
    }

    try {
      return await this.createWithRelations(data)
    } catch (error) {
      // Tin gửi lại (broker giao lại, client gửi lại) chạm unique index
      // (senderId, clientMessageId): trả bản đã lưu thay vì nhân bản.
      if (!data.clientMessageId || !isUniqueConstraintError(error)) throw error
      // Tra id qua partial index bằng find thô (qua Prisma nó quét cả
      // collection), rồi đọc đủ quan hệ theo _id.
      const [stored] = await findStoredBySenderClientIds(this.prisma, [
        { senderId: data.senderId, clientMessageId: data.clientMessageId },
      ])
      const existing = stored
        ? await this.prisma.message.findUnique({
            where: { id: stored.id },
            include: { medias: { orderBy: { sortOrder: 'asc' } }, poll: true },
          })
        : null
      if (!existing) throw error
      return { ...existing, replayed: true as const }
    }
  }

  private async createWithRelations(
    data: Parameters<MessageRepository['create']>[0],
  ) {
    // Số thứ tự giữ chỗ TRƯỚC khi ghi. Ghi lỗi (kể cả trùng clientMessageId)
    // thì số đó thành lỗ trong dãy — được phép, xem seq-allocator.
    const seq = await reserveSeq(this.prisma, data.conversationId, 1)
    const facets = facetsOf(
      data.type,
      (data.medias ?? []).map((media) => media.mediaType),
      data.content,
    )
    // Ghi dữ liệu & trả về trong 1 nhịp duy nhất (nested writes)
    const created = await this.prisma.message.create({
      data: {
        seq,
        ...facets,
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: data.type,
        content: data.content || null,
        replyToMessageId: data.replyToMessageId || null,
        pollId: data.pollId || null,
        mentionUserIds: data.mentionUserIds || [],
        mentions: (data.mentions ?? undefined) as Prisma.InputJsonValue,
        clientMessageId: data.clientMessageId,

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
    const seq = await reserveSeq(this.prisma, data.conversationId, 1)
    const created = await this.prisma.message.create({
      data: {
        seq,
        ...facetsOf(messageType.CALL, [], data.content),
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
   *
   * Ordered by `seq`, the conversation's own numbering: `beforeSeq` pages back
   * through history (newest first), `afterSeq` fetches what came after a seq
   * the client already has (oldest first) — the resync after a reconnect or a
   * gap. `seq < X` inside Prisma's `$expr` still gets index bounds on
   * (conversationId, seq).
   */
  async findByConversationIdPaginatedForUser(
    conversationId: string,
    userId: string,
    take: number,
    range: {
      beforeSeq: number | null
      afterSeq: number | null
      clearedHistorySeq: number | null
    },
  ) {
    const ascending = range.afterSeq !== null
    const batchSize = Math.max(take * 3, 30)
    const messages: Prisma.messageGetPayload<{
      include: typeof MESSAGE_INCLUDE
    }>[] = []
    let bound = ascending ? range.afterSeq : range.beforeSeq

    while (messages.length < take) {
      const bounds: Prisma.messageWhereInput[] = []
      if (bound !== null) {
        bounds.push({ seq: ascending ? { gt: bound } : { lt: bound } })
      }
      if (range.clearedHistorySeq !== null) {
        bounds.push({ seq: { gt: range.clearedHistorySeq } })
      }

      const batch = await this.prisma.message.findMany({
        where: {
          conversationId,
          ...(bounds.length ? { AND: bounds } : {}),
        },
        orderBy: { seq: ascending ? 'asc' : 'desc' },
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
      if (typeof last?.seq !== 'number') break
      bound = last.seq
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
        createdAt: true,
        senderMember: SENDER_SELECT,
        // The first attachment only — a reply bubble shows one thumbnail.
        // Ordered, because `take: 1` on an unordered relation picked an
        // arbitrary image out of a multi-photo message.
        medias: {
          select: {
            mediaType: true,
            fileName: true,
            url: true,
            mimeType: true,
            thumbnailUrl: true,
          },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
      },
    })
  }

  async findConversationAssets(
    conversationId: string,
    kind: 'MEDIA' | 'LINK' | 'DOC',
    take: number,
    beforeSeq: number | null,
  ) {
    // Which messages count as this kind of asset: a flag stored when the
    // message is written (domain/message-facets). Filtering on the relation
    // made Prisma `$lookup` the media of EVERY message of the conversation
    // before filtering — 7 s on a 305,800-message thread.
    const flag = {
      MEDIA: { hasMedia: true },
      DOC: { hasFile: true },
      LINK: { hasLink: true },
    }[kind]

    return await this.prisma.message.findMany({
      where: {
        conversationId,
        ...flag,
        // Thu hồi với mọi người mà bức ảnh vẫn nằm trong tab Ảnh/Video và mở
        // được đầy màn hình thì không phải là thu hồi.
        isRevoked: false,
        ...(beforeSeq !== null ? { seq: { lt: beforeSeq } } : {}),
      },
      orderBy: { seq: 'desc' },
      take,
      include: MESSAGE_INCLUDE,
    })
  }
}
