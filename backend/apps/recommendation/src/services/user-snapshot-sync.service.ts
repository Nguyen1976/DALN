import { toGeoPoint } from '@app/util'
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { EmbeddingService } from './embedding.service'
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
    private readonly embeddingService: EmbeddingService,
    private readonly dirty: RecommendationDirtyService,
  ) {}

  async syncUserCreated(payload: UserCreatedPayload): Promise<void> {
    const now = new Date()
    await this.dirty.markDirty(payload.userId)

    await this.prisma.userSnapshot.upsert({
      where: { userId: payload.userId },
      create: {
        userId: payload.userId,
        username: payload.username,
        fullName: payload.fullName ?? payload.username,
        avatar: payload.avatar ?? null,
        bio: payload.bio ?? null,
        // Either shape: messages published before the payload became a
        // GeoJSON Point may still be queued.
        location: toGeoPoint(payload.location),
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
      await this.embeddingService.embedBio(payload.userId, bio)
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
      await this.embeddingService.embedBio(payload.userId, payload.bio)
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
