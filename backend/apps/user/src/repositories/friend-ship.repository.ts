import { PrismaService } from 'apps/user/prisma/prisma.service'
import { Inject, Injectable } from '@nestjs/common'
import { SUMMARY_SELECT } from './user.repository'
@Injectable()
export class FriendShipRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * A page of `userId`'s friendships in the order they were made. `after` is
   * the last friendship id already read (the page cursor).
   */
  async findFriendsByUserId(userId: string, take: number, after?: string) {
    return await this.prisma.friendship.findMany({
      where: { userId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, friend: { select: SUMMARY_SELECT } },
    })
  }

  /** `userId`'s friends whose username starts with `keyword` (any case). */
  async searchFriends(userId: string, keyword: string, take: number) {
    const rows = await this.prisma.friendship.findMany({
      where: {
        userId,
        friend: {
          is: { username: { startsWith: keyword, mode: 'insensitive' } },
        },
      },
      take,
      select: { friend: { select: SUMMARY_SELECT } },
    })
    return rows.map((row) => row.friend)
  }

  async findFriendshipBetweenUsers(userId1: string, userId2: string) {
    return await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: userId1, friendId: userId2 },
          { userId: userId2, friendId: userId1 },
        ],
      },
    })
  }

  async findAllFriendsByUserId(userId: string) {
    return await this.prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    })
  }
}
