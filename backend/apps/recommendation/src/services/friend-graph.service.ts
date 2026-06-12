import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export type CommonFriendRow = { id: string; commonFriends: number }
export type CommonGroupRow = { id: string; commonGroups: number }

/**
 * MongoDB-backed friend/group graph for the recommendation service.
 *
 * The application's friendship + group data live in MongoDB (Neo4j is now used
 * ONLY for the offline link-prediction training pipeline). This service replaces
 * every Neo4j read/write that the recommendation flow used to perform.
 */
@Injectable()
export class FriendGraphService {
  private readonly logger = new Logger(FriendGraphService.name)

  constructor(private readonly prisma: PrismaService) {}

  // --- friendship writes (RMQ-driven replica) -------------------------------

  async upsertFriendship(userAId: string, userBId: string): Promise<void> {
    if (!userAId || !userBId || userAId === userBId) return
    const pairs = [
      { userId: userAId, friendId: userBId },
      { userId: userBId, friendId: userAId },
    ]
    await Promise.all(
      pairs.map((pair) =>
        this.prisma.friendship.upsert({
          where: { userId_friendId: pair },
          create: pair,
          update: {},
        }),
      ),
    )
  }

  async removeFriendship(userAId: string, userBId: string): Promise<void> {
    if (!userAId || !userBId) return
    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId: userAId, friendId: userBId },
          { userId: userBId, friendId: userAId },
        ],
      },
    })
  }

  // --- friendship reads -----------------------------------------------------

  async getFriendIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    })
    return rows.map((row) => row.friendId).filter(Boolean)
  }

  /** userId -> Set<friendId> for a batch of users (graph-feature neighbor sets). */
  async getNeighborsBatch(userIds: string[]): Promise<Map<string, Set<string>>> {
    const neighbors = new Map<string, Set<string>>()
    for (const id of userIds) neighbors.set(id, new Set())
    if (!userIds.length) return neighbors

    const rows = await this.prisma.friendship.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, friendId: true },
    })
    for (const row of rows) {
      if (!neighbors.has(row.userId)) neighbors.set(row.userId, new Set())
      neighbors.get(row.userId)!.add(row.friendId)
    }
    return neighbors
  }

  /** Friends-of-friends with shared-friend counts (replaces Neo4j common-friends). */
  async getCommonFriends(userId: string, limit = 300): Promise<CommonFriendRow[]> {
    const directFriends = await this.getFriendIds(userId)
    const exclude = [userId, ...directFriends]

    try {
      const raw = (await this.prisma.friendship.aggregateRaw({
        pipeline: [
          { $match: { userId } },
          {
            $lookup: {
              from: 'Friendship',
              localField: 'friendId',
              foreignField: 'userId',
              as: 'second',
            },
          },
          { $unwind: '$second' },
          { $match: { 'second.friendId': { $nin: exclude } } },
          { $group: { _id: '$second.friendId', commonFriends: { $sum: 1 } } },
          { $sort: { commonFriends: -1 } },
          { $limit: limit },
          { $project: { _id: 0, id: '$_id', commonFriends: 1 } },
        ],
      })) as unknown as CommonFriendRow[]
      return Array.isArray(raw) ? raw : []
    } catch (e) {
      this.logger.warn(`getCommonFriends failed: ${String(e)}`)
      return []
    }
  }

  /** All undirected friendship edges (u < v) for offline dataset building. */
  async getAllFriendEdges(): Promise<Array<{ user1: string; user2: string }>> {
    const rows = await this.prisma.friendship.findMany({
      select: { userId: true, friendId: true },
    })
    const seen = new Set<string>()
    const edges: Array<{ user1: string; user2: string }> = []
    for (const row of rows) {
      if (!row.userId || !row.friendId || row.userId === row.friendId) continue
      const [a, b] =
        row.userId < row.friendId
          ? [row.userId, row.friendId]
          : [row.friendId, row.userId]
      const key = `${a}|${b}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ user1: a, user2: b })
    }
    return edges
  }

  // --- group writes (RMQ-driven replica) ------------------------------------

  async upsertGroupMembership(
    userId: string,
    conversationId: string,
    groupName?: string,
  ): Promise<void> {
    if (!userId || !conversationId) return
    await this.prisma.groupMembership.upsert({
      where: { userId_conversationId: { userId, conversationId } },
      create: { userId, conversationId, groupName: groupName ?? null },
      update: { groupName: groupName ?? undefined },
    })
  }

  async removeGroupMembership(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    if (!userId || !conversationId) return
    await this.prisma.groupMembership.deleteMany({
      where: { userId, conversationId },
    })
  }

  // --- group reads ----------------------------------------------------------

  /** userId -> Set<conversationId> for a batch of users. */
  async getGroupsBatch(userIds: string[]): Promise<Map<string, Set<string>>> {
    const groups = new Map<string, Set<string>>()
    for (const id of userIds) groups.set(id, new Set())
    if (!userIds.length) return groups

    const rows = await this.prisma.groupMembership.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, conversationId: true },
    })
    for (const row of rows) {
      if (!groups.has(row.userId)) groups.set(row.userId, new Set())
      groups.get(row.userId)!.add(row.conversationId)
    }
    return groups
  }

  /** Users sharing groups with `userId`, with shared-group counts. */
  async getCommonGroups(userId: string, limit = 300): Promise<CommonGroupRow[]> {
    const myGroups = await this.prisma.groupMembership.findMany({
      where: { userId },
      select: { conversationId: true },
    })
    const groupIds = myGroups.map((row) => row.conversationId)
    if (!groupIds.length) return []

    try {
      const raw = (await this.prisma.groupMembership.aggregateRaw({
        pipeline: [
          { $match: { conversationId: { $in: groupIds } } },
          { $match: { userId: { $ne: userId } } },
          { $group: { _id: '$userId', commonGroups: { $sum: 1 } } },
          { $sort: { commonGroups: -1 } },
          { $limit: limit },
          { $project: { _id: 0, id: '$_id', commonGroups: 1 } },
        ],
      })) as unknown as CommonGroupRow[]
      return Array.isArray(raw) ? raw : []
    } catch (e) {
      this.logger.warn(`getCommonGroups failed: ${String(e)}`)
      return []
    }
  }
}
