import { PrismaService } from 'apps/user/prisma/prisma.service'
import { Inject, Injectable } from '@nestjs/common'
@Injectable()
export class FriendShipRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(data: { userId: string; friendId: string }) {
    return await this.prisma.friendship.create({
      data: {
        userId: data.userId,
        friendId: data.friendId,
      },
    })
  }

  async findFriendsByUserId(userId: string, limit: number, page: number) {
    return await this.prisma.friendship.findMany({
      where: { userId },
      take: limit,
      skip: (page - 1) * limit,
      select: { friendId: true },
    })
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
