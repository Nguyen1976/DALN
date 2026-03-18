import { PrismaService } from 'apps/user/prisma/prisma.service'
import { Inject, Injectable } from '@nestjs/common'
import { Status } from 'apps/user/src/generated';

@Injectable()
export class FriendRequestRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(data: { fromUserId: string; toUserId: string }) {
    return await this.prisma.friendRequest.create({
      data: {
        fromUserId: data.fromUserId,
        toUserId: data.toUserId,
        status: Status.PENDING,
      },
    })
  }

  async findByUsers(fromUserId: string, toUserId: string) {
    return await this.prisma.friendRequest.findMany({
      where: {
        fromUserId,
        toUserId,
      },
    })
  }

  async findById(id: string) {
    return await this.prisma.friendRequest.findUnique({
      where: { id },
    })
  }

  async findPendingByToUserId(toUserId: string, limit: number, page: number) {
    return await this.prisma.friendRequest.findMany({
      where: {
        toUserId,
        status: Status.PENDING,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: (page - 1) * limit,
    })
  }

  async updateStatus(fromUserId: string, toUserId: string, status: Status) {
    return await this.prisma.friendRequest.updateMany({
      where: {
        fromUserId,
        toUserId,
      },
      data: {
        status,
      },
    })
  }
}
