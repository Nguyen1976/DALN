import { Injectable, Logger } from '@nestjs/common'
import { MongoClient, ObjectId } from 'mongodb'
import { PrismaService } from '../../prisma/prisma.service'

type UserMongoDoc = {
  _id: ObjectId
  username?: string
  fullName?: string
  avatar?: string | null
  bio?: string | null
  interests?: string[]
  location?: { lat?: number; lon?: number } | null
  isActive?: boolean
  lastSeen?: Date | null
}

@Injectable()
export class UserSnapshotHydrateService {
  private readonly logger = new Logger(UserSnapshotHydrateService.name)
  private client: MongoClient | null = null

  constructor(private readonly prisma: PrismaService) {}

  private resolveUserMongo(): { uri: string; dbName: string } {
    const raw =
      process.env.USER_MONGO_URI?.trim() ||
      process.env.USER_DATABASE_URL?.trim() ||
      'mongodb://localhost:27017/user-service'
    const dbFromEnv = process.env.USER_MONGO_DB?.trim()
    if (dbFromEnv) {
      try {
        const u = new URL(raw)
        return { uri: u.toString(), dbName: dbFromEnv }
      } catch {
        return { uri: raw, dbName: dbFromEnv }
      }
    }
    try {
      const u = new URL(raw)
      const dbFromPath = u.pathname.replace(/^\//, '').split('?')[0]
      if (dbFromPath) {
        u.pathname = '/'
        return { uri: u.toString(), dbName: dbFromPath }
      }
    } catch {
      /* use defaults */
    }
    return { uri: raw, dbName: 'user-service' }
  }

  private async getUserCollection() {
    if (!this.client) {
      const { uri, dbName } = this.resolveUserMongo()
      this.client = new MongoClient(uri)
      await this.client.connect()
      return this.client.db(dbName).collection<UserMongoDoc>('User')
    }
    const { dbName } = this.resolveUserMongo()
    return this.client.db(dbName).collection<UserMongoDoc>('User')
  }

  private toSnapshotLocation(
    location: UserMongoDoc['location'],
  ): { type: 'Point'; coordinates: [number, number] } | null {
    if (!location || typeof location !== 'object') return null
    const lat = Number(location.lat)
    const lon = Number(location.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { type: 'Point', coordinates: [lon, lat] }
  }

  private async upsertFromMongoUser(doc: UserMongoDoc): Promise<void> {
    const userId = doc._id.toString()
    const now = new Date()
    await this.prisma.userSnapshot.upsert({
      where: { userId },
      create: {
        userId,
        username: doc.username ?? userId,
        fullName: doc.fullName ?? doc.username ?? userId,
        avatar: doc.avatar ?? null,
        bio: doc.bio ?? null,
        interests: Array.isArray(doc.interests) ? doc.interests : [],
        location: this.toSnapshotLocation(doc.location),
        isActive: doc.isActive ?? true,
        lastSeen: doc.lastSeen ?? now,
        syncedAt: now,
      },
      update: {
        username: doc.username ?? undefined,
        fullName: doc.fullName ?? undefined,
        avatar: doc.avatar ?? undefined,
        bio: doc.bio ?? undefined,
        interests: Array.isArray(doc.interests) ? doc.interests : undefined,
        location: this.toSnapshotLocation(doc.location) ?? undefined,
        isActive: doc.isActive ?? undefined,
        syncedAt: now,
      },
    })
  }

  /** Ensure current user exists in UserSnapshot (RMQ miss / user created before sync). */
  async ensureUserSnapshot(userId: string): Promise<boolean> {
    const existing = await this.prisma.userSnapshot.findUnique({
      where: { userId },
      select: { userId: true },
    })
    if (existing) return true

    try {
      const col = await this.getUserCollection()
      const doc = await col.findOne({ _id: new ObjectId(userId) })
      if (!doc) {
        this.logger.warn(`[hydrate] user not found in user-service DB: ${userId}`)
        return false
      }
      await this.upsertFromMongoUser(doc)
      this.logger.log(`[hydrate] created UserSnapshot for ${userId}`)
      return true
    } catch (e) {
      this.logger.error(
        `[hydrate] ensureUserSnapshot failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      return false
    }
  }

  /** When replica is empty/small, pull other users so cold-start has candidates. */
  async hydratePeerSnapshotsIfNeeded(minPeers = 1): Promise<number> {
    const peerCount = await this.prisma.userSnapshot.count({
      where: { isActive: true },
    })
    if (peerCount >= minPeers + 1) return 0

    try {
      const col = await this.getUserCollection()
      const docs = await col.find({ isActive: { $ne: false } }).limit(500).toArray()
      let n = 0
      for (const doc of docs) {
        await this.upsertFromMongoUser(doc)
        n++
      }
      if (n > 0) {
        this.logger.log(`[hydrate] upserted ${n} user snapshot(s) from user-service`)
      }
      return n
    } catch (e) {
      this.logger.error(
        `[hydrate] hydratePeerSnapshotsIfNeeded failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      return 0
    }
  }
}
