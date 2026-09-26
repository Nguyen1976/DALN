import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'

/** What the recommendation feature cache holds per user (setUserFeaturesBatch). */
export interface CachedFeatures {
  bio: string | null
  location: unknown
  interests: string[]
}

/**
 * Cache đặc trưng user cho bước xếp hạng gợi ý kết bạn. Chỉ service
 * recommendation dùng, nên nó sống ở đây chứ không trong libs/redis: nằm ở
 * lib thì mỗi lần sửa, bundle của cả 5 service dùng RedisService đổi theo.
 * Khoá và TTL giữ nguyên như bản cũ.
 */
@Injectable()
export class UserFeaturesCache {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  // Feature Hydration Cache methods
  private getFeaturesKey(userId: string): string {
    return `user:${userId}:features`
  }

  async getUserFeaturesBatch(
    userIds: string[],
  ): Promise<Record<string, CachedFeatures>> {
    try {
      const keys = userIds.map((id) => this.getFeaturesKey(id))
      const results = await this.redisClient.mget(...keys)

      const featuresByUserId: Record<string, CachedFeatures> = {}
      for (let i = 0; i < userIds.length; i++) {
        const data = results[i]
        if (!data) continue
        try {
          featuresByUserId[userIds[i]] = JSON.parse(data) as CachedFeatures
        } catch {
          // Unreadable entry: treat as a cache miss.
        }
      }
      return featuresByUserId
    } catch (err) {
      console.error(`[UserFeaturesCache] Error getting features batch:`, err)
      return {}
    }
  }

  async setUserFeaturesBatch(
    profiles: Array<{
      id: string
      bio?: string | null
      location?: unknown
      interests?: string[]
    }>,
    ttl = 86400,
  ): Promise<void> {
    try {
      const pipeline = this.redisClient.pipeline()
      for (const p of profiles) {
        const key = this.getFeaturesKey(p.id)
        const serialized = JSON.stringify({
          bio: p.bio ?? null,
          location: p.location ?? null,
          interests: p.interests ?? [],
        })
        pipeline.set(key, serialized, 'EX', ttl)
      }
      await pipeline.exec()
    } catch (err) {
      console.error(`[UserFeaturesCache] Error setting features batch:`, err)
    }
  }
}
