import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '../../src/generated'
import { PrismaService } from '../../prisma/prisma.service'

type CandidateJson = { candidateId?: string; [key: string]: unknown }

function asPrismaJson(value: CandidateJson[]): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue
}

@Injectable()
export class RecommendationFriendshipService {
  private readonly logger = new Logger(RecommendationFriendshipService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remove `friendUserId` from stored recommendation list for `userId`.
   * Called after friendship is accepted (both directions).
   */
  async removeCandidateFromStoredRecommendations(
    userId: string,
    friendUserId: string,
  ): Promise<boolean> {
    const result = await this.prisma.recommendationResult.findUnique({
      where: { userId },
    })
    if (!result) return false

    const candidates = Array.isArray(result.candidates)
      ? (result.candidates as CandidateJson[])
      : []
    const filteredCandidates = candidates.filter(
      (c) => String(c?.candidateId ?? '') !== friendUserId,
    )
    if (filteredCandidates.length === candidates.length) {
      return false
    }

    const features = Array.isArray(result.features)
      ? (result.features as CandidateJson[])
      : []
    const filteredFeatures = features.filter(
      (f) => String(f?.candidateId ?? '') !== friendUserId,
    )

    await this.prisma.recommendationResult.update({
      where: { userId },
      data: {
        topK: filteredCandidates.length,
        candidates: asPrismaJson(filteredCandidates),
        features: asPrismaJson(filteredFeatures),
      },
    })

    this.logger.log(
      `[rcm] removed friend ${friendUserId} from recommendations of ${userId} (${candidates.length} -> ${filteredCandidates.length})`,
    )
    return true
  }

  /** Both users should no longer see each other in cached RCM after accept. */
  async onFriendshipAccepted(
    userAId: string,
    userBId: string,
  ): Promise<void> {
    await Promise.all([
      this.removeCandidateFromStoredRecommendations(userAId, userBId),
      this.removeCandidateFromStoredRecommendations(userBId, userAId),
    ])
  }

  /** Remove every current friend from stored list (GET safety net if RMQ lagged). */
  async stripFriendsFromStoredRecommendations(
    userId: string,
    friendIds: string[],
  ): Promise<boolean> {
    if (!friendIds.length) return false
    const exclude = new Set(friendIds.map(String))

    const result = await this.prisma.recommendationResult.findUnique({
      where: { userId },
    })
    if (!result) return false

    const candidates = Array.isArray(result.candidates)
      ? (result.candidates as CandidateJson[])
      : []
    const filteredCandidates = candidates.filter(
      (c) => !exclude.has(String(c?.candidateId ?? '')),
    )
    if (filteredCandidates.length === candidates.length) {
      return false
    }

    const features = Array.isArray(result.features)
      ? (result.features as CandidateJson[])
      : []
    const filteredFeatures = features.filter(
      (f) => !exclude.has(String(f?.candidateId ?? '')),
    )

    await this.prisma.recommendationResult.update({
      where: { userId },
      data: {
        topK: filteredCandidates.length,
        candidates: asPrismaJson(filteredCandidates),
        features: asPrismaJson(filteredFeatures),
      },
    })
    return true
  }
}
