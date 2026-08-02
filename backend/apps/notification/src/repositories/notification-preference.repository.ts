import { Injectable } from '@nestjs/common'
import { PrismaService } from 'apps/notification/prisma/prisma.service'

@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string) {
    return this.prisma.userNotificationPreference.findUnique({
      where: { userId },
    })
  }

  create(data: {
    userId: string
    globalSettings: any
    overrides: any
    digestSettings: any
  }) {
    return this.prisma.userNotificationPreference.create({
      data,
    })
  }

  upsert(data: {
    userId: string
    globalSettings: any
    overrides: any
    digestSettings: any
    version: number
  }) {
    return this.prisma.userNotificationPreference.upsert({
      where: { userId: data.userId },
      create: data,
      update: {
        globalSettings: data.globalSettings,
        overrides: data.overrides,
        digestSettings: data.digestSettings,
        version: data.version,
      },
    })
  }

  updateDigest(userId: string, digestSettings: any, version: number) {
    return this.prisma.userNotificationPreference.update({
      where: { userId },
      data: {
        digestSettings,
        version,
      },
    })
  }

  /**
   * @deprecated Tải TOÀN BỘ preference — chi phí O(số user) mỗi lượt quét.
   * Dùng {@link findManyByUserIds} với tập ứng viên đã lọc từ notification.
   */
  findAllForDigestSweep() {
    return this.prisma.userNotificationPreference.findMany({
      select: {
        userId: true,
        globalSettings: true,
        overrides: true,
        digestSettings: true,
        version: true,
        updatedAt: true,
      },
    })
  }

  // Không early-return [] khi rỗng: bên gọi đã chặn trước, và trả về union với
  // never[] làm hỏng suy luận kiểu ở phía dùng.
  findManyByUserIds(userIds: string[]) {
    return this.prisma.userNotificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        globalSettings: true,
        overrides: true,
        digestSettings: true,
        version: true,
        updatedAt: true,
      },
    })
  }
}
