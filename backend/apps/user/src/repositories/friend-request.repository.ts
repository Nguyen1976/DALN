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

  /** Pending requests between two users, in either direction. */
  async findPendingBetweenUsers(userA: string, userB: string) {
    return await this.prisma.friendRequest.findMany({
      where: {
        status: Status.PENDING,
        OR: [
          { fromUserId: userA, toUserId: userB },
          { fromUserId: userB, toUserId: userA },
        ],
      },
    })
  }

  async findPendingByFromUserId(fromUserId: string, limit: number, page: number) {
    return await this.prisma.friendRequest.findMany({
      where: {
        fromUserId,
        status: Status.PENDING,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: (page - 1) * limit,
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
        // Only a request still waiting can be answered; without this a late
        // duplicate could overwrite a decision that was already made.
        status: Status.PENDING,
      },
      data: {
        status,
      },
    })
  }
}
