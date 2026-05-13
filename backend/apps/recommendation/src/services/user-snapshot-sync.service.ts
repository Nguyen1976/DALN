import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  UserCreatedPayload,
  UserUpdatedPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class UserSnapshotSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncUserCreated(payload: UserCreatedPayload): Promise<void> {
    const now = new Date()

    await this.prisma.userSnapshot.upsert({
      where: { userId: payload.id },
      create: {
        userId: payload.id,
        username: payload.username,
        fullName: payload.username,
        avatar: null,
        bio: null,
        location: payload.location
          ? {
              lat: payload.location.lat,
              lon: payload.location.lon,
            }
          : null,
        isActive: true,
        lastSeen: now,
        syncedAt: now,
      },
      update: {
        syncedAt: now,
        isActive: true,
      },
    })
  }

  async syncUserUpdated(payload: UserUpdatedPayload): Promise<void> {
    const now = new Date()

    const updates: Record<string, any> = {
      syncedAt: now,
    }

    if (payload.avatar !== undefined) {
      updates.avatar = payload.avatar
    }

    if (payload.fullName !== undefined) {
      updates.fullName = payload.fullName
    }

    await this.prisma.userSnapshot.update({
      where: { userId: payload.userId },
      data: updates,
    })
  }
}
