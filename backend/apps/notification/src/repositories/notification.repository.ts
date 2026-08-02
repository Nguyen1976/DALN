import { Injectable } from '@nestjs/common'
import { PrismaService } from 'apps/notification/prisma/prisma.service'

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

  /**
   * Đảo chiều câu hỏi của digest sweep: thay vì "với MỖI user, đếm số thông báo
   * chưa đọc" (N query, O(tổng số user)), hỏi một lần "những user nào đang có
   * thông báo chưa đọc" — chi phí gắn với lưu lượng thật, không với quy mô DB.
   */
  async findDigestCandidates(): Promise<
    { userId: string; unreadCount: number }[]
  > {
    const rows = await this.prisma.notification.groupBy({
      by: ['userId'],
      where: { isRead: false, digestEligible: true },
      _count: { _all: true },
    })

    return rows.map((row) => ({
      userId: row.userId,
      unreadCount: row._count._all,
    }))
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
