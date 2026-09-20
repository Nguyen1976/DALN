import { PrismaService } from 'apps/user/prisma/prisma.service'
import { Inject, Injectable } from '@nestjs/common'
import { Status } from 'apps/user/src/generated'
import { olderThanCursor, type KeysetCursor } from '@app/util'
import { SUMMARY_SELECT } from './user.repository'

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

  /**
   * Pending requests `userId` sent or received, newest first, by keyset, with
   * both people on them.
   */
  async findPending(
    direction: 'sent' | 'received',
    userId: string,
    take: number,
    cursor: KeysetCursor | null,
  ) {
    return await this.prisma.friendRequest.findMany({
      where: {
        ...(direction === 'sent'
          ? { fromUserId: userId }
          : { toUserId: userId }),
        status: Status.PENDING,
        ...olderThanCursor('createdAt', cursor),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        fromUser: { select: SUMMARY_SELECT },
        toUser: { select: SUMMARY_SELECT },
      },
    })
  }

  async findById(id: string) {
    return await this.prisma.friendRequest.findUnique({
      where: { id },
    })
  }

  /** A request with the person who sent it. */
  async findWithSender(id: string) {
    return await this.prisma.friendRequest.findUnique({
      where: { id },
      include: { fromUser: { select: SUMMARY_SELECT } },
    })
  }

  /** Decline a request that is still waiting; a late duplicate changes nothing. */
  async decline(requestId: string) {
    return await this.prisma.friendRequest.updateMany({
      where: { id: requestId, status: Status.PENDING },
      data: { status: Status.REJECTED },
    })
  }
}
