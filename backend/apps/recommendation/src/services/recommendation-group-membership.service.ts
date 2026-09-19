import { Injectable, Logger } from '@nestjs/common'
import { FriendGraphService } from './friend-graph.service'
import { RecommendationDirtyService } from './recommendation-dirty.service'
import type {
  UserJoinGroupPayload,
  UserLeftGroupPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class RecommendationGroupMembershipService {
  private readonly logger = new Logger(RecommendationGroupMembershipService.name)

  constructor(
    private readonly friendGraph: FriendGraphService,
    private readonly dirty: RecommendationDirtyService,
  ) {}

  async onUserJoinedGroup(payload: UserJoinGroupPayload): Promise<void> {
    await this.dirty.markDirty(payload.userId)
    try {
      await this.friendGraph.upsertGroupMembership(
        payload.userId,
        payload.conversationId,
        payload.groupName,
      )
    } catch (e) {
      this.logger.warn(`upsert group membership failed: ${String(e)}`)
    }
  }

  async onUserLeftGroup(payload: UserLeftGroupPayload): Promise<void> {
    await this.dirty.markDirty(payload.userId)
    try {
      await this.friendGraph.removeGroupMembership(
        payload.userId,
        payload.conversationId,
      )
    } catch (e) {
      this.logger.warn(`remove group membership failed: ${String(e)}`)
    }
  }
}
