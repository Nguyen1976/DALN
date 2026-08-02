import { Injectable, Logger } from '@nestjs/common'
import { FriendGraphService } from './friend-graph.service'
import { RecommendationDirtyService } from './recommendation-dirty.service'

@Injectable()
export class RecommendationGroupMembershipService {
  private readonly logger = new Logger(RecommendationGroupMembershipService.name)

  constructor(
    private readonly friendGraph: FriendGraphService,
    private readonly dirty: RecommendationDirtyService,
  ) {}

  async onUserJoinedGroup(payload: {
    userId: string
    groupId: string
    conversationId?: string
    groupName?: string
    createdAt?: string
  }): Promise<void> {
    const conversationId = payload.conversationId ?? payload.groupId
    await this.dirty.markDirty(payload.userId)
    try {
      await this.friendGraph.upsertGroupMembership(
        payload.userId,
        conversationId,
        payload.groupName,
      )
    } catch (e) {
      this.logger.warn(`upsert group membership failed: ${String(e)}`)
    }
  }

  async onUserLeftGroup(payload: {
    userId: string
    groupId: string
    conversationId?: string
    leftAt?: string
  }): Promise<void> {
    const conversationId = payload.conversationId ?? payload.groupId
    await this.dirty.markDirty(payload.userId)
    try {
      await this.friendGraph.removeGroupMembership(payload.userId, conversationId)
    } catch (e) {
      this.logger.warn(`remove group membership failed: ${String(e)}`)
    }
  }
}
