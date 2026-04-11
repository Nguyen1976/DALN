import { Inject, Injectable } from '@nestjs/common'
import { messageType } from 'apps/chat/src/generated'
import { PrismaService } from 'apps/chat/prisma/prisma.service'

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
  sortOrder?: number
}

@Injectable()
export class MessageRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(data: {
    conversationId: string
    senderId: string
    type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE'
    content?: string | null
    replyToMessageId?: string | null
    medias?: MediaInput[]
  }) {
    // Ghi dữ liệu & trả về trong 1 nhịp duy nhất (nested writes)
    const created = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        type: data.type as any, // Ép kiểu messageType
        content: data.content || null,
        replyToMessageId: data.replyToMessageId || null,

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
                sortOrder: media.sortOrder ?? index,
              })),
            }
          : undefined,
      },
      // Trả về luôn relations, không cần gọi findUnique thêm lần nữa!
      include: {
        medias: { orderBy: { sortOrder: 'asc' } },
      },
    })

    return created
  }

  async findById(id: string, conversationId: string) {
    return await this.prisma.message.findFirst({
      where: {
        id,
        conversationId,
      },
    })
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
    cursor?: Date | null,
  ) {
    const where: any = {
      conversationId,
      isDeleted: false,
      ...(cursor && {
        createdAt: {
          lt: cursor,
        },
      }),
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
      },
    } as any)
  }
}
