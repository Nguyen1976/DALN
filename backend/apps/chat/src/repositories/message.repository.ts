import { Inject, Injectable } from '@nestjs/common'
import { messageType, Prisma } from 'apps/chat/src/generated'
import { PrismaService } from 'apps/chat/prisma/prisma.service'
import { MessageBatchWriter } from '../services/message-batch-writer.service'
import { olderThanCursor, type KeysetCursor } from '@app/util'

type MediaInput = {
  mediaType: 'IMAGE' | 'VIDEO' | 'FILE'
  objectKey: string
  url: string
  mimeType: string
  size: string
  width?: number
  height?: number
  duration?: number
  thumbnailUrl?: string
  fileName?: string
  sortOrder?: number
}

@Injectable()
export class MessageRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly batchWriter: MessageBatchWriter,
  ) {}

  private readonly defaultMessageInclude = {
    senderMember: {
      select: {
        userId: true,
        username: true,
        fullName: true,
        avatar: true,
      },
    },
    medias: {
      orderBy: {
        sortOrder: 'asc' as const,
      },
    },
    poll: true,
  }

  async create(data: {
    conversationId: string
    senderId: string
    type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'POLL'
    content?: string | null
    replyToMessageId?: string | null
    pollId?: string | null
    medias?: MediaInput[]
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
      })
    }

    // Ghi dữ liệu & trả về trong 1 nhịp duy nhất (nested writes)
    const created = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: data.type as any, // Ép kiểu messageType
        content: data.content || null,
        replyToMessageId: data.replyToMessageId || null,
        pollId: data.pollId || null,

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

    return {
      ...created,
      // Giữ nguyên hình dạng trả về để bên gọi không phải đổi.
      medias: (created as { medias?: unknown[] }).medias ?? [],
      poll: (created as { poll?: unknown }).poll ?? null,
    }
  }

  async findById(id: string, conversationId: string) {
    return await this.prisma.message.findFirst({
      where: {
        id,
        conversationId,
      },
    })
  }

  async findLatestByConversationIds(conversationIds: string[]) {
    if (!conversationIds.length) return []

    const latestMessages = await Promise.all(
      conversationIds.map((conversationId) =>
        this.prisma.message.findFirst({
          where: {
            conversationId,
            isDeleted: false,
            isRevoked: false,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            senderMember: {
              select: {
                userId: true,
                username: true,
                fullName: true,
                avatar: true,
              },
            },
            poll: true,
          },
        }),
      ),
    )

    return latestMessages.filter(Boolean)
  }

  async findByConversationIdPaginated(
    conversationId: string,
    take: number,
    cursor?: Date | null,
  ) {
    return await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(cursor && {
          createdAt: { lt: cursor },
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        senderMember: {
          select: {
            userId: true,
            username: true,
            fullName: true,
            avatar: true,
          },
        },
        medias: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        poll: true,
      },
    })
  }

  async findByConversationIdPaginatedForUser(
    conversationId: string,
    userId: string,
    take: number,
    cursor?: KeysetCursor | null,
  ) {
    const member = await this.prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
      },
      select: {
        clearedHistoryAt: true,
      },
    })

    const deletedMessageIds = new Set(
      (
        await this.prisma.deleteMessage.findMany({
          where: {
            userId,
          },
          select: {
            messageId: true,
          },
        })
      ).map((item) => item.messageId),
    )

    const batchSize = Math.max(take * 3, 30)
    const messages: any[] = []
    let nextCursor: KeysetCursor | null = cursor ?? null

    while (messages.length < take) {
      // Both the cursor and the cleared-history mark constrain `createdAt`.
      // They used to be spread in as two separate `createdAt` keys, so the
      // second overwrote the first: a user who had cleared their history lost
      // the cursor entirely and "load older" kept returning the same newest
      // page for ever. Collecting them into one AND keeps both in force.
      const bounds: Prisma.messageWhereInput[] = []
      if (nextCursor) bounds.push(olderThanCursor('createdAt', nextCursor))
      if (member?.clearedHistoryAt) {
        bounds.push({ createdAt: { gt: member.clearedHistoryAt } })
      }

      const batch = await this.prisma.message.findMany({
        where: {
          conversationId,
          ...(bounds.length ? { AND: bounds } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: batchSize,
        include: this.defaultMessageInclude as any,
      })

      if (!batch.length) break

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
    } catch (error: any) {
      if (error?.code === 'P2002') {
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

  async findUnreadMessages(
    conversationId: string,
    lastReadAt: Date | null,
    userId: string,
  ) {
    return await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(lastReadAt && {
          createdAt: { gt: lastReadAt },
        }),
        isDeleted: false,
        NOT: { senderId: userId },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true },
    })
  }

  async findConversationAssets(
    conversationId: string,
    kind: 'MEDIA' | 'LINK' | 'DOC',
    take: number,
    cursor?: KeysetCursor | null,
  ) {
    const where: any = {
      conversationId,
      isDeleted: false,
      // Same tie-safe cursor as the message list: several attachments sent
      // together share a timestamp, and a bare `lt` drops the ones that fell
      // on the page boundary.
      ...olderThanCursor('createdAt', cursor ?? null),
    }

    if (kind === 'MEDIA') {
      where.OR = [
        {
          type: {
            in: ['IMAGE', 'VIDEO'],
          },
        },
        {
          medias: {
            some: {
              mediaType: {
                in: ['IMAGE', 'VIDEO'],
              },
            },
          },
        },
      ]
    }

    if (kind === 'DOC') {
      where.OR = [
        {
          type: 'FILE',
        },
        {
          medias: {
            some: {
              mediaType: 'FILE',
            },
          },
        },
      ]
    }

    if (kind === 'LINK') {
      where.OR = [
        {
          content: {
            contains: 'http',
          },
        },
        {
          content: {
            contains: 'www.',
          },
        },
      ]
    }

    return await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        senderMember: {
          select: {
            userId: true,
            username: true,
            fullName: true,
            avatar: true,
          },
        },
        medias: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        poll: true,
      },
    } as any)
  }
}
