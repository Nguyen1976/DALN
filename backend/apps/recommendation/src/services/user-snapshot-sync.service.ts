import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { EmbeddingNotifyService } from './embedding-notify.service'
import {
  UserCreatedPayload,
  UserInterestsUpdatedPayload,
  UserUpdatedPayload,
} from 'libs/constant/rmq/payload'
import { RecommendationDirtyService } from './recommendation-dirty.service'

@Injectable()
export class UserSnapshotSyncService {
  private readonly logger = new Logger(UserSnapshotSyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingNotify: EmbeddingNotifyService,
    private readonly dirty: RecommendationDirtyService,
  ) {}

  async syncUserCreated(payload: UserCreatedPayload): Promise<void> {
    const now = new Date()
    await this.dirty.markDirty(payload.id)

    await this.prisma.userSnapshot.upsert({
      where: { userId: payload.id },
      create: {
        userId: payload.id,
        username: payload.username,
        fullName: payload.fullName ?? payload.username,
        avatar: payload.avatar ?? null,
        bio: payload.bio ?? null,
        location: payload.location
          ? {
              type: 'Point',
              coordinates: [payload.location.lon, payload.location.lat],
            }
          : null,
        isActive: true,
        lastSeen: now,
        syncedAt: now,
      },
      update: {
        syncedAt: now,
        isActive: true,
        ...(payload.fullName !== undefined && { fullName: payload.fullName }),
        ...(payload.avatar !== undefined && { avatar: payload.avatar }),
        ...(payload.bio !== undefined && { bio: payload.bio }),
      },
    })

    const bio = (payload.bio ?? '').trim()
    if (bio) {
      const r = await this.embeddingNotify.notifyBioEmbedded(payload.id, bio)
      if (!r.ok) {
        this.logger.error(
          `[snapshot] USER_CREATED bio embed/Qdrant failed userId=${payload.id} detail=${r.detail ?? ''}`,
        )
      }
    }
  }

  async syncUserUpdated(payload: UserUpdatedPayload): Promise<void> {
    const now = new Date()
    await this.dirty.markDirty(payload.userId)

    const updates: Record<string, any> = {
      syncedAt: now,
    }

    if (payload.avatar !== undefined) {
      updates.avatar = payload.avatar
    }

    if (payload.fullName !== undefined) {
      updates.fullName = payload.fullName
    }

    if (payload.bio !== undefined) {
      updates.bio = payload.bio
    }

    await this.prisma.userSnapshot.upsert({
      where: { userId: payload.userId },
      create: {
        userId: payload.userId,
        username: payload.userId,
        fullName: payload.fullName ?? payload.userId,
        avatar: payload.avatar ?? null,
        bio: payload.bio ?? null,
        interests: [],
        location: null,
        isActive: true,
        lastSeen: now,
        syncedAt: now,
        ...updates,
      },
      update: updates,
    })

    if (payload.bio !== undefined) {
      const r = await this.embeddingNotify.notifyBioEmbedded(
        payload.userId,
        payload.bio ?? '',
      )
      if (!r.ok) {
        this.logger.error(
          `[snapshot] bio saved but embedding/Qdrant notify failed userId=${payload.userId} detail=${r.detail ?? ''}`,
        )
      }
    }
  }

  async syncUserInterestsUpdated(
    payload: UserInterestsUpdatedPayload,
  ): Promise<void> {
    const now = new Date()

    const validTags = await this.prisma.interestTag.findMany({
      where: {
        slug: { in: payload.interests },
        isActive: true,
      },
      select: { slug: true },
    })

    const slugs = validTags.map((t) => t.slug)
    if (!slugs.length) {
      return
    }

    await this.dirty.markDirty(payload.userId)

    await this.prisma.userSnapshot.updateMany({
      where: { userId: payload.userId },
      data: {
        interests: slugs,
        syncedAt: now,
      },
    })
  }
}
