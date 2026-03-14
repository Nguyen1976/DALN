import { PrismaService } from '@app/prisma'
import { Injectable } from '@nestjs/common'

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    userId: string
    message: string
    type: string
    friendRequestId?: string | null
    digestEligible?: boolean
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        message: data.message,
        type: data.type,
        friendRequestId: data.friendRequestId ?? null,
        digestEligible: data.digestEligible ?? true,
      },
    })
  }

  findManyByUser(userId: string, skip: number, take: number) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    })
  }

  countUnread(userId: string) {
    return this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    })
  }

  countUnreadDigestEligible(userId: string) {
    return this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
        digestEligible: true,
      },
    })
  }

  markOneRead(userId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
  }
}
