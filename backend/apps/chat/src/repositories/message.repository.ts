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
    clientMessageId: string
    replyToMessageId?: string | null
    medias?: MediaInput[]
  }) {
    const existed = await this.prisma.message.findFirst({
      where: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        clientMessageId: data.clientMessageId,
      },
      include: {
        senderMember: {
          select: {
            userId: true,
            username: true,
            avatar: true,
            role: true,
            lastReadAt: true,
            fullName: true,
          },
        },
        medias: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    })

    if (existed) {
      return {
        message: existed,
        duplicated: true,
      }
    }

    const created = await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.message.create({
        data: {
          conversationId: data.conversationId,
          senderId: data.senderId,
          type: data.type as messageType,
          content: data.content || null,
          clientMessageId: data.clientMessageId,
          replyToMessageId: data.replyToMessageId || null,
        },
      })

      if ((data.medias?.length || 0) > 0) {
        await transaction.messageMedia.createMany({
          data: (data.medias || []).map((media, index) => ({
            messageId: message.id,
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
        })
      }

      return message
    })

    const message = await this.prisma.message.findUnique({
      where: {
        id: created.id,
      },
      include: {
        senderMember: {
          select: {
            userId: true,
            username: true,
            avatar: true,
            role: true,
            lastReadAt: true,
            fullName: true,
          },
        },
        medias: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    })

    return {
      message,
      duplicated: false,
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
