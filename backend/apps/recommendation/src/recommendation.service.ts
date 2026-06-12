import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QdrantService } from '@app/qdrant/qdrant.service'
import { UtilService } from '@app/util/util.service'
import { RedisService } from '@app/redis/redis.service'
import { UserSnapshotHydrateService } from './services/user-snapshot-hydrate.service'
import { RecommendationFriendshipService } from './services/recommendation-friendship.service'
import { FriendGraphService } from './services/friend-graph.service'
import { EmbeddingService } from './services/embedding.service'
import { FeatureService } from './services/feature.service'
import { GbRankerService } from './services/gb-ranker.service'
import * as _ from 'lodash'

type NearbyUser = {
  userId: string
  dist: number
  fullName?: string
  username?: string
}

type UserProfileRow = {
  userId: string
  bio: string | null
  location: unknown
  interests?: string[]
}

type RecommendationFeatureRow = {
  candidateId: string
  score?: number
  jaccard?: number
  cosine_graph?: number
  adamic_adar?: number
  pref_attach?: number
  deg_u?: number
  deg_v?: number
  dist_km?: number
  dist_bucket?: number
  bio_cosine?: number
  bio_dot?: number
  bio_l2?: number
  same_cluster?: number
  group_inter?: number
  group_jaccard?: number
  same_group?: number
}

@Injectable()
export class RecommendationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly qdrantService: QdrantService,
    private readonly utilService: UtilService,
    private readonly redisService: RedisService,
    private readonly embeddingService: EmbeddingService,
    private readonly featureService: FeatureService,
    private readonly gbRankerService: GbRankerService,
    private readonly userSnapshotHydrate: UserSnapshotHydrateService,
    private readonly recommendationFriendship: RecommendationFriendshipService,
    private readonly friendGraph: FriendGraphService,
  ) {}

  private tokenizeBio(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 1),
    )
  }

  private computeBioSimilarity(
    currentBio: string | null,
    candidateBio: string | null,
  ): number {
    if (!currentBio || !candidateBio) {
      return 0
    }

    const currentTokens = this.tokenizeBio(currentBio)
    const candidateTokens = this.tokenizeBio(candidateBio)
    if (!currentTokens.size || !candidateTokens.size) {
      return 0
    }

    let intersection = 0
    for (const token of currentTokens) {
      if (candidateTokens.has(token)) {
        intersection += 1
      }
    }

    const union = currentTokens.size + candidateTokens.size - intersection
    return union > 0 ? intersection / union : 0
  }

  private getCoordinates(location: unknown): [number, number] | null {
    const coordinates = (location as { coordinates?: unknown })?.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return null
    }

    const lng = Number(coordinates[0])
    const lat = Number(coordinates[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null
    }
    return [lng, lat]
  }

  /** GeoJSON Point for $geoNear — supports legacy `{ lat, lon }` snapshots. */
  private toGeoNearNearField(location: unknown): {
    type: 'Point'
    coordinates: [number, number]
  } | null {
    const fromCoordinates = this.getCoordinates(location)
    if (fromCoordinates) {
      return { type: 'Point', coordinates: fromCoordinates }
    }
    const lo = location as { lat?: unknown; lon?: unknown } | null
    const lat = typeof lo?.lat === 'number' ? lo.lat : Number(lo?.lat)
    const lon = typeof lo?.lon === 'number' ? lo.lon : Number(lo?.lon)
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { type: 'Point', coordinates: [lon, lat] }
    }
    return null
  }

  private computeInterestJaccard(a: string[], b: string[]): number {
    if (!a?.length || !b?.length) return 0
    const setA = new Set(a)
    const setB = new Set(b)
    let inter = 0
    for (const x of setA) {
      if (setB.has(x)) inter++
    }
    const union = setA.size + setB.size - inter
    return union > 0 ? inter / union : 0
  }

  /**
   * Cold-start prior: interests + text bio + geography + weak vector signal.
   * Used to blend with GB model when graph features are sparse.
   */
  private computeColdStartPrior(params: {
    interestJaccard: number
    bioTokenSim: number
    distKm: number
    vecSignal: number
  }): number {
    const hasDist = Number.isFinite(params.distKm) && params.distKm > 0
    const geo = hasDist ? Math.exp(-Math.min(params.distKm, 500) / 130) : 0.32
    return (
      0.38 * params.interestJaccard +
      0.28 * params.bioTokenSim +
      0.22 * geo +
      0.12 * Math.min(1, Math.max(0, params.vecSignal))
    )
  }

  private orderedUniqueCandidates(lists: string[][], max: number): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const list of lists) {
      for (const id of list) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push(id)
        if (out.length >= max) return out
      }
    }
    return out
  }

  private dedupeByCandidateId<T extends { candidateId?: unknown }>(
    rows: T[],
  ): T[] {
    const seen = new Set<string>()
    const out: T[] = []
    for (const row of rows) {
      const candidateId = String(row?.candidateId ?? '')
      if (!candidateId || seen.has(candidateId)) continue
      seen.add(candidateId)
      out.push(row)
    }
    return out
  }

  private isColdStartUser(params: {
    friendCount: number
    graphOnlyCandidates: number
    unionSizeBeforeCold: number
  }): boolean {
    if (params.friendCount <= 2) return true
    if (params.graphOnlyCandidates < 6) return true
    if (params.unionSizeBeforeCold < 28) return true
    return false
  }

  private async fetchColdStartInterestMatches(
    excludeIds: string[],
    interestSlugs: string[],
  ): Promise<string[]> {
    if (!interestSlugs.length) return []
    try {
      const raw = await this.prisma.userSnapshot.aggregateRaw({
        pipeline: [
          {
            $match: {
              userId: { $nin: excludeIds },
              interests: { $in: interestSlugs },
            },
          },
          { $limit: 220 },
          { $project: { userId: 1, _id: 0 } },
        ],
      })
      const rows = raw as unknown as { userId?: string }[]
      if (!Array.isArray(rows)) return []
      return rows
        .map((r) => r.userId)
        .filter((id): id is string => typeof id === 'string')
    } catch (e) {
      console.warn('[recommendation] cold-start interest match failed', e)
      return []
    }
  }

  private async fetchColdStartGeoRing(
    excludeIds: string[],
    near: { type: 'Point'; coordinates: [number, number] },
    limit: number,
  ): Promise<string[]> {
    try {
      const raw = await this.prisma.userSnapshot.aggregateRaw({
        pipeline: [
          {
            $geoNear: {
              near,
              distanceField: 'dist',
              spherical: true,
              query: { userId: { $nin: excludeIds } },
            },
          },
          { $limit: limit },
          { $project: { userId: 1, _id: 0 } },
        ],
      })
      const rows = raw as unknown as { userId?: string }[]
      if (!Array.isArray(rows)) return []
      return rows
        .map((r) => r.userId)
        .filter((id): id is string => typeof id === 'string')
    } catch (e) {
      console.warn('[recommendation] cold-start geo ring failed', e)
      return []
    }
  }

  private readonly heuristicPoolLimit = 3

  /** Qdrant retrieve/search may return a plain number[] or a named-vector wrapper. */
  private extractDenseVector(raw: unknown): number[] | null {
    if (Array.isArray(raw) && raw.length && typeof raw[0] === 'number') {
      return raw as number[]
    }
    if (raw && typeof raw === 'object' && 'default' in (raw as object)) {
      const inner = (raw as { default?: unknown }).default
      if (
        Array.isArray(inner) &&
        inner.length &&
        typeof inner[0] === 'number'
      ) {
        return inner as number[]
      }
    }
    return null
  }

  private async getFriendIdsExclusive(userId: string): Promise<string[]> {
    try {
      const ids = await this.friendGraph.getFriendIds(userId)
      return ids.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
    } catch {
      return []
    }
  }

  private filterCandidatesExcludingFriends<T extends { candidateId?: string }>(
    rows: T[],
    friendIds: string[],
  ): T[] {
    if (!friendIds.length) return rows
    const exclude = new Set(friendIds)
    return rows.filter((r) => !exclude.has(String(r.candidateId ?? '')))
  }

  private async requestEmbedAndSave(
    userId: string,
    bio: string,
  ): Promise<boolean> {
    const result = await this.embeddingService.embedAndSave([
      { id: userId, bio: bio || '', age: 0 },
    ])
    return result.status === 'ok'
  }

  private async fetchTopInterestOverlapUserIds(
    excludeIds: string[],
    interestSlugs: string[],
    limit: number,
  ): Promise<string[]> {
    if (!interestSlugs.length) return []
    try {
      const raw = await this.prisma.userSnapshot.aggregateRaw({
        pipeline: [
          {
            $match: {
              userId: { $nin: excludeIds },
              interests: { $in: interestSlugs },
            },
          },
          {
            $addFields: {
              overlap: {
                $size: {
                  $ifNull: [
                    { $setIntersection: ['$interests', interestSlugs] },
                    [],
                  ],
                },
              },
            },
          },
          { $match: { overlap: { $gt: 0 } } },
          { $sort: { overlap: -1, userId: 1 } },
          { $limit: limit },
          { $project: { userId: 1, _id: 0 } },
        ],
      })
      const rows = raw as unknown as { userId?: string }[]
      if (!Array.isArray(rows)) return []
      return rows
        .map((r) => r.userId)
        .filter((id): id is string => typeof id === 'string')
    } catch (e) {
      console.warn('[recommendation] top interest overlap failed', e)
      return []
    }
  }

  private buildHeuristicCandidateRow(
    candidateId: string,
    score: number,
    profile: {
      userId: string
      username: string
      fullName: string
      avatar: string | null
      bio: string | null
      location: unknown
      isActive: boolean
      lastSeen: Date | null
    },
  ) {
    return {
      candidateId,
      score,
      jaccard: 0,
      cosine_graph: 0,
      adamic_adar: 0,
      pref_attach: 0,
      deg_u: 0,
      deg_v: 0,
      dist_km: 0,
      dist_bucket: 0,
      bio_cosine: 0,
      bio_dot: 0,
      bio_l2: 0,
      same_cluster: 0,
      group_inter: 0,
      group_jaccard: 0,
      same_group: 0,
      profile: {
        userId: profile.userId,
        username: profile.username,
        fullName: profile.fullName,
        avatar: profile.avatar,
        bio: profile.bio,
        location: profile.location,
        isActive: profile.isActive,
        lastSeen: profile.lastSeen,
      },
    }
  }

  /**
   * Read-time cold start when there is no stored recommendation list.
   * Pool = 3 Qdrant (similar bio) + 3 $geoNear + 3 best interest overlap, de-duplicated. No Python GB model.
   */
  private async getLiveHeuristicColdStartRecommendations(
    userId: string,
  ): Promise<any[]> {
    await this.userSnapshotHydrate.ensureUserSnapshot(userId)
    await this.userSnapshotHydrate.hydratePeerSnapshotsIfNeeded(1)

    const me = await this.prisma.userSnapshot.findUnique({
      where: { userId },
      select: {
        bio: true,
        location: true,
        interests: true,
        username: true,
        fullName: true,
        avatar: true,
        isActive: true,
        lastSeen: true,
      },
    })
    if (!me) return []

    const friendIds = await this.getFriendIdsExclusive(userId)
    const excludeIds = [userId, ...friendIds]
    const k = this.heuristicPoolLimit
    let fromBio: string[] = []

    if ((me.bio ?? '').trim()) {
      const qid = this.utilService.mongoIdToUuid(userId)
      let rows = await this.qdrantService.getVectorsBatch([qid])
      let vec = this.extractDenseVector(rows[0]?.vector)
      if (!vec || !vec.length) {
        await this.requestEmbedAndSave(userId, me.bio ?? '')
        rows = await this.qdrantService.getVectorsBatch([qid])
        vec = this.extractDenseVector(rows[0]?.vector)
      }
      if (vec?.length) {
        const hits = await this.qdrantService.searchSimilarByVector(
          vec,
          k,
          excludeIds,
        )
        fromBio = hits
          .map((h) => {
            const mid =
              h.payload && (h.payload as Record<string, unknown>).mongoId
            return typeof mid === 'string' ? mid : null
          })
          .filter((id): id is string => id !== null)
      }
    }

    const nearPoint = this.toGeoNearNearField(me.location)
    let fromGeo: string[] = []
    if (nearPoint) {
      fromGeo = await this.fetchColdStartGeoRing(excludeIds, nearPoint, k)
    }

    const fromInterest = await this.fetchTopInterestOverlapUserIds(
      excludeIds,
      me.interests ?? [],
      k,
    )

    let mergedIds = this.orderedUniqueCandidates(
      [fromBio, fromGeo, fromInterest],
      64,
    )

    if (!mergedIds.length) {
      const fallback = await this.prisma.userSnapshot.findMany({
        where: { userId: { not: userId } },
        take: this.heuristicPoolLimit * 3,
        orderBy: { syncedAt: 'desc' },
        select: { userId: true },
      })
      mergedIds = fallback.map((r) => r.userId)
    }

    if (!mergedIds.length) return []

    const profiles = await this.prisma.userSnapshot.findMany({
      where: { userId: { in: mergedIds } },
      select: {
        userId: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        location: true,
        isActive: true,
        lastSeen: true,
      },
    })
    const byId = new Map(profiles.map((p) => [p.userId, p]))

    const out: any[] = []
    let rank = 0
    for (const id of mergedIds) {
      const profile = byId.get(id)
      if (!profile) continue
      rank += 1
      out.push(
        this.buildHeuristicCandidateRow(
          profile.userId,
          1 - rank * 0.01,
          profile,
        ),
      )
    }
    return out
  }

  private toStoredScore(score: unknown): number {
    const rawScore = Number(score)
    return Number.isFinite(rawScore) ? rawScore : 0
  }

  private getDayVersion(): number {
    const now = new Date()
    return (
      now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
    )
  }

  async getRecommendationForUser(userId: string) {
    const friendIds = await this.getFriendIdsExclusive(userId)
    await this.recommendationFriendship.stripFriendsFromStoredRecommendations(
      userId,
      friendIds,
    )

    const result = await this.prisma.recommendationResult.findUnique({
      where: { userId },
    })

    let storedCandidates = Array.isArray(result?.candidates)
      ? (result!.candidates as RecommendationFeatureRow[])
      : []
    storedCandidates = this.filterCandidatesExcludingFriends(
      storedCandidates,
      friendIds,
    )

    const candidateIds = storedCandidates
      .map((candidate) => candidate?.candidateId)
      .filter(
        (candidateId): candidateId is string => typeof candidateId === 'string',
      )

    const noStoredList = !result || candidateIds.length === 0

    if (noStoredList) {
      const live = this.filterCandidatesExcludingFriends(
        await this.getLiveHeuristicColdStartRecommendations(userId),
        friendIds,
      )
      if (live.length > 0) {
        const now = new Date()
        const dayVersion = this.getDayVersion()
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        await this.prisma.recommendationResult.upsert({
          where: { userId },
          create: {
            userId,
            topK: live.length,
            candidates: live,
            features: [],
            dayVersion,
            expiresAt,
          },
          update: {
            topK: live.length,
            candidates: live,
            features: [],
            dayVersion,
            expiresAt,
          },
        })
        return {
          status: 'ok',
          source: 'live_heuristic',
          userId,
          topK: live.length,
          dayVersion,
          expiresAt,
          createdAt: now,
          updatedAt: now,
          candidates: live,
        }
      }
    }

    if (!result) {
      return {
        status: 'empty',
        userId,
        topK: 0,
        dayVersion: this.getDayVersion(),
        candidates: [],
      }
    }

    const candidates = storedCandidates

    const profiles = await this.prisma.userSnapshot.findMany({
      where: { userId: { in: candidateIds } },
      select: {
        userId: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        location: true,
        isActive: true,
        lastSeen: true,
      },
    })

    const profileByUserId = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    )

    const enriched = candidates
      .map((candidate) => {
        const profile = profileByUserId.get(candidate.candidateId)
        if (!profile) return null

        return {
          ...candidate,
          profile: {
            userId: profile.userId,
            username: profile.username,
            fullName: profile.fullName,
            avatar: profile.avatar,
            bio: profile.bio,
            location: profile.location,
            isActive: profile.isActive,
            lastSeen: profile.lastSeen,
          },
        }
      })
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null,
      )

    if (enriched.length === 0) {
      const live = this.filterCandidatesExcludingFriends(
        await this.getLiveHeuristicColdStartRecommendations(userId),
        friendIds,
      )
      if (live.length > 0) {
        const now = new Date()
        const dayVersion = this.getDayVersion()
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        await this.prisma.recommendationResult.upsert({
          where: { userId },
          create: {
            userId,
            topK: live.length,
            candidates: live,
            features: [],
            dayVersion,
            expiresAt,
          },
          update: {
            topK: live.length,
            candidates: live,
            features: [],
            dayVersion,
            expiresAt,
          },
        })
        return {
          status: 'ok',
          source: 'live_heuristic',
          userId,
          topK: live.length,
          dayVersion,
          expiresAt,
          createdAt: now,
          updatedAt: now,
          candidates: live,
        }
      }
    }

    const visible = this.filterCandidatesExcludingFriends(enriched, friendIds)

    return {
      status: 'ok',
      userId,
      topK: visible.length,
      dayVersion: result.dayVersion,
      expiresAt: result.expiresAt,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      candidates: visible,
    }
  }

  async recommendation() {
    console.time('Tổng thời gian cho 1000 User')
    // 1. Lấy 1000 user (có thể thay đổi số lượng)
    console.time('Bắt đầu lấy danh sách user từ MongoDB')
    const users = await this.prisma.userSnapshot.findMany({
      select: { userId: true },
    })
    console.timeEnd('Bắt đầu lấy danh sách user từ MongoDB')

    // 2. Chia thành các lô nhỏ để giữ mức concurrency ổn định
    const CHUNK_SIZE = 50
    const userChunks = _.chunk(users, CHUNK_SIZE)

    let processed = 0
    for (const chunk of userChunks) {
      // Chạy song song trong mỗi lô (khoảng CHUNK_SIZE promises)
      await Promise.all(chunk.map((u) => this.recommendationHelper(u.userId)))
      processed += chunk.length
      console.log(`✅ Đã xử lý xong ${processed}/${users.length} users...`)
    }

    console.timeEnd('Tổng thời gian cho 1000 User')
  }

  async recommendationHelper(userId: string) {
    console.log(`--- Bắt đầu xử lý Suggest cho User: ${userId} ---`)
    console.time('Tổng thời gian recommendationHelper')

    // 1. Bạn bè từ MongoDB (cold start: có thể không có dữ liệu)
    let friendIds: string[] = []
    try {
      friendIds = await this.friendGraph.getFriendIds(userId)
    } catch (e) {
      console.warn('[recommendation] friend list failed', e)
    }
    friendIds = friendIds.filter((id) => id && typeof id === 'string')

    const friendCountExclusive = friendIds.length
    const uniqueExcludeIds = Array.from(new Set([...friendIds, userId]))

    const qdrantUuid = await this.utilService.mongoIdToUuid(userId)

    console.time('Giai đoạn xử lý song song')
    const settled = await Promise.allSettled([
      this.friendGraph.getCommonFriends(userId, 300),
      this.friendGraph.getCommonGroups(userId, 300),
      this.qdrantService.recommendSimilar(qdrantUuid, 200, uniqueExcludeIds),
      this.prisma.userSnapshot.findUnique({
        where: { userId },
        select: { location: true, bio: true, interests: true },
      }),
    ])
    console.timeEnd('Giai đoạn xử lý song song')

    const commonFriends =
      settled[0].status === 'fulfilled' ? settled[0].value : []
    if (settled[0].status === 'rejected') {
      console.warn('[recommendation] commonFriends failed', settled[0].reason)
    }

    const commonGroups =
      settled[1].status === 'fulfilled' ? settled[1].value : []
    if (settled[1].status === 'rejected') {
      console.warn('[recommendation] commonGroups failed', settled[1].reason)
    }

    const qdrantRes = settled[2].status === 'fulfilled' ? settled[2].value : []
    if (settled[2].status === 'rejected') {
      console.warn(
        '[recommendation] qdrant recommendSimilar failed',
        settled[2].reason,
      )
    }

    const currentUser =
      settled[3].status === 'fulfilled' ? settled[3].value : null
    if (settled[3].status === 'rejected') {
      console.warn(
        '[recommendation] prisma currentUser failed',
        settled[3].reason,
      )
    }

    console.time('Giai đoạn 5: MongoDB GeoNear')
    const nearPoint = this.toGeoNearNearField(currentUser?.location)
    let suggestBasedOnNearby: Array<NearbyUser> = []

    if (nearPoint) {
      try {
        suggestBasedOnNearby = (await this.prisma.userSnapshot.aggregateRaw({
          pipeline: [
            {
              $geoNear: {
                near: nearPoint,
                distanceField: 'dist',
                spherical: true,
                query: {
                  userId: { $nin: uniqueExcludeIds },
                },
              },
            },
            { $limit: 220 },
            { $project: { userId: 1, username: 1, fullName: 1, dist: 1 } },
          ],
        })) as any
      } catch (e) {
        console.warn('[recommendation] MongoDB GeoNear failed', e)
      }
    }
    console.timeEnd('Giai đoạn 5: MongoDB GeoNear')

    console.time('Giai đoạn 6: Build candidate union')
    const candidateIdsFromGraph = [
      ...commonFriends.map((u) => u.id),
      ...commonGroups.map((u) => u.id),
    ]
    const candidateIdsFromNearby = suggestBasedOnNearby.map((u) => u.userId)
    const candidateIdsFromQdrant = qdrantRes
      .map((u) => u.payload?.mongoId as string | undefined)
      .filter((id): id is string => typeof id === 'string')

    const graphOnlyUnique = new Set(
      [
        ...commonFriends.map((u) => u.id),
        ...commonGroups.map((u) => u.id),
      ].filter((id): id is string => typeof id === 'string'),
    )

    let orderedCandidateIds = this.orderedUniqueCandidates(
      [candidateIdsFromGraph, candidateIdsFromNearby, candidateIdsFromQdrant],
      520,
    )

    const coldStart = this.isColdStartUser({
      friendCount: friendCountExclusive,
      graphOnlyCandidates: graphOnlyUnique.size,
      unionSizeBeforeCold: orderedCandidateIds.length,
    })

    let coldInterestIds: string[] = []
    let coldGeoIdsExtra: string[] = []
    if (coldStart || orderedCandidateIds.length < 36) {
      const myInterests = currentUser?.interests ?? []
      coldInterestIds = await this.fetchColdStartInterestMatches(
        uniqueExcludeIds,
        myInterests,
      )
      if (nearPoint) {
        coldGeoIdsExtra = await this.fetchColdStartGeoRing(
          uniqueExcludeIds,
          nearPoint,
          260,
        )
      }
    }

    orderedCandidateIds = this.orderedUniqueCandidates(
      [orderedCandidateIds, coldInterestIds, coldGeoIdsExtra],
      480,
    )

    const allCandidateIds = orderedCandidateIds
    console.timeEnd('Giai đoạn 6: Build candidate union')

    // Giai đoạn 6.5: Lấy bio embedding vectors từ Qdrant
    console.time('Giai đoạn 6.5: Fetch bio vectors from Qdrant')
    const userIdsForBioVectors = [userId, ...allCandidateIds]
    const qdrantUserUuids: string[] = []
    for (const id of userIdsForBioVectors) {
      try {
        const uuid = await this.utilService.mongoIdToUuid(id)
        qdrantUserUuids.push(uuid)
      } catch {
        // Skip if conversion fails
      }
    }

    // Map UUID -> MongoDB ID
    const uuidToMongoId = new Map<string, string>()
    for (let i = 0; i < userIdsForBioVectors.length; i++) {
      uuidToMongoId.set(qdrantUserUuids[i], userIdsForBioVectors[i])
    }

    let vectorPoints: any[] = []
    try {
      vectorPoints = await this.qdrantService.getVectorsBatch(qdrantUserUuids)
    } catch (e) {
      console.warn('[recommendation] getVectorsBatch failed', e)
    }
    const bioVectorsByUserId = new Map<string, number[]>()
    for (const point of vectorPoints) {
      const mongoId = uuidToMongoId.get(String(point.id))
      if (mongoId && point.vector) {
        bioVectorsByUserId.set(mongoId, point.vector as number[])
      }
    }
    console.timeEnd('Giai đoạn 6.5: Fetch bio vectors from Qdrant')

    console.time('Giai đoạn 7: Enrich Features')

    // Giai đoạn 7a: Fetch từ Redis cache (batch)
    const cachedFeatures =
      await this.redisService.getUserFeaturesBatch(allCandidateIds)
    const missingIds = allCandidateIds.filter((id) => !cachedFeatures[id])

    // Giai đoạn 7b: Query Prisma cho những ID bị thiếu
    let missingProfiles: UserProfileRow[] = []
    if (missingIds.length > 0) {
      missingProfiles = await this.prisma.userSnapshot.findMany({
        where: { userId: { in: missingIds } },
        select: { userId: true, bio: true, location: true, interests: true },
      })

      // Warm-up cache: lưu ngược trở lại Redis để tránh cache-miss cho lần tiếp theo
      if (missingProfiles.length > 0) {
        await this.redisService.setUserFeaturesBatch(
          missingProfiles.map((profile) => ({
            id: profile.userId,
            bio: profile.bio,
            location: profile.location,
            interests: profile.interests ?? [],
          })),
        )
      }
    }

    // Giai đoạn 7c: Combine bằng Map (O(1) lookup)
    const missingProfilesMap = new Map(
      missingProfiles.map((p) => [p.userId, p]),
    )
    const candidateProfiles: UserProfileRow[] = []
    for (const id of allCandidateIds) {
      if (cachedFeatures[id]) {
        const cached = cachedFeatures[id]
        candidateProfiles.push({
          userId: id,
          bio: cached.bio || null,
          location: cached.location || null,
          interests: Array.isArray(cached.interests) ? cached.interests : [],
        })
      } else {
        const profile = missingProfilesMap.get(id)
        if (profile)
          candidateProfiles.push({
            userId: profile.userId,
            bio: profile.bio,
            location: profile.location,
            interests: profile.interests ?? [],
          })
      }
    }

    // Giai đoạn 7d: Fetch neighbors (friends) của current user + candidates từ MongoDB
    console.time('Giai đoạn 7d: Fetch neighbors from MongoDB')
    const userIdsForNeighbors = [userId, ...allCandidateIds]
    let neighborsByUserId = new Map<string, Set<string>>()
    try {
      neighborsByUserId =
        await this.friendGraph.getNeighborsBatch(userIdsForNeighbors)
    } catch (e) {
      console.warn('[recommendation] neighbors batch failed', e)
    }

    const degreesByUserId = new Map<string, number>()
    for (const [uid, friendSet] of neighborsByUserId) {
      degreesByUserId.set(uid, friendSet.size)
    }
    if (!neighborsByUserId.has(userId)) {
      neighborsByUserId.set(userId, new Set())
      degreesByUserId.set(userId, 0)
    }

    console.timeEnd('Giai đoạn 7d: Fetch neighbors from MongoDB')

    // Giai đoạn 7d.5: Fetch groups của current user + candidates từ MongoDB
    console.time('Giai đoạn 7d.5: Fetch groups from MongoDB')
    let groupsByUserId = new Map<string, Set<string>>()
    try {
      groupsByUserId = await this.friendGraph.getGroupsBatch(userIdsForNeighbors)
    } catch (e) {
      console.warn('[recommendation] groups batch failed', e)
    }
    for (const id of userIdsForNeighbors) {
      if (!groupsByUserId.has(id)) {
        groupsByUserId.set(id, new Set())
      }
    }

    console.timeEnd('Giai đoạn 7d.5: Fetch groups from MongoDB')

    console.timeEnd('Giai đoạn 7: Enrich Features')

    const profileByCandidateId = new Map(
      (candidateProfiles as UserProfileRow[]).map((u) => [u.userId, u]),
    )
    const qdrantScoreById = new Map(
      qdrantRes
        .map((u) => {
          const mongoId = u.payload?.mongoId as string | undefined
          return mongoId ? ([mongoId, Number(u.score ?? 0)] as const) : null
        })
        .filter((row): row is readonly [string, number] => row !== null),
    )

    const currentUserBio = currentUser?.bio ?? null
    const currentUserCoordinates = this.featureService.getLngLatPair(
      currentUser?.location,
    )
    const currentUserInterests = currentUser?.interests ?? []

    console.log({
      commonFriends: commonFriends[0],
      commonGroups: commonGroups[0],
      suggestBasedOnInterest: qdrantRes[0],
      suggestBasedOnNearby: suggestBasedOnNearby[0],
      coldStart,
      candidatePool: allCandidateIds.length,
    })

    const currentUserNeighbors = neighborsByUserId.get(userId) ?? new Set()
    const currentUserBioVector = bioVectorsByUserId.get(userId) ?? null

    const map = new Map<string, any>()
    const coldPriorById = new Map<string, number>()
    /**
     *  suggestBasedOnInterest: {
    id: '89e5d1fa-359f-5f66-a5fb-bc0f72a0ff5c',
    version: 86,
    score: 0.7603104,
    payload: { mongoId: '69dfa12186e60bb70f816cf9', username: 'bui_khanh_5' }
  },
     */
    for (const candidateId of allCandidateIds) {
      const candidateProfile = profileByCandidateId.get(candidateId)
      const bioSimilarity = this.computeBioSimilarity(
        currentUserBio,
        candidateProfile?.bio ?? null,
      )
      const qdrantScore = qdrantScoreById.get(candidateId) ?? 0

      const candidateCoordinates = this.featureService.getLngLatPair(
        candidateProfile?.location,
      )
      const interestJaccard = this.computeInterestJaccard(
        currentUserInterests,
        candidateProfile?.interests ?? [],
      )
      const distanceKm =
        currentUserCoordinates && candidateCoordinates
          ? this.featureService.haversineDistanceKm(
              currentUserCoordinates,
              candidateCoordinates,
            )
          : 0

      // Graph Features
      const candidateNeighbors = neighborsByUserId.get(candidateId) ?? new Set()
      const degreeU = this.featureService.computeDegree(currentUserNeighbors)
      const degreeV = this.featureService.computeDegree(candidateNeighbors)
      const jaccard = this.featureService.computeJaccard(
        currentUserNeighbors,
        candidateNeighbors,
      )
      const cosineGraph = this.featureService.computeCosineGraph(
        currentUserNeighbors,
        candidateNeighbors,
      )
      const adamicAdar = this.featureService.computeAdamicAdar(
        currentUserNeighbors,
        candidateNeighbors,
        degreesByUserId,
      )
      const prefAttach = this.featureService.computePreferentialAttachment(
        currentUserNeighbors,
        candidateNeighbors,
      )

      // Bio Embedding Features
      const candidateBioVector = bioVectorsByUserId.get(candidateId) ?? null
      const bioCosine = this.featureService.computeBioCosine(
        currentUserBioVector,
        candidateBioVector,
      )
      const bioDot = this.featureService.computeBioDot(
        currentUserBioVector,
        candidateBioVector,
      )
      const bioL2 = this.featureService.computeBioL2(
        currentUserBioVector,
        candidateBioVector,
      )

      // Distance & Community Features
      const distanceBucket = this.featureService.computeDistanceBucket(distanceKm)
      const currentUserGroups = groupsByUserId.get(userId) ?? new Set()
      const candidateGroups = groupsByUserId.get(candidateId) ?? new Set()
      const sameGroup = this.featureService.computeSameGroup(
        currentUserGroups,
        candidateGroups,
      )
      const groupInter = this.featureService.computeGroupIntersection(
        currentUserGroups,
        candidateGroups,
      )
      const groupJaccard = this.featureService.computeGroupJaccard(
        currentUserGroups,
        candidateGroups,
      )

      const vecSignal = Math.max(bioCosine, Math.min(1, qdrantScore))
      const coldPrior = this.computeColdStartPrior({
        interestJaccard,
        bioTokenSim: bioSimilarity,
        distKm: distanceKm,
        vecSignal,
      })
      coldPriorById.set(candidateId, coldPrior)

      map.set(candidateId, {
        candidateId,
        jaccard,
        cosine_graph: cosineGraph,
        adamic_adar: adamicAdar,
        pref_attach: prefAttach,
        deg_u: degreeU,
        deg_v: degreeV,
        dist_km: distanceKm,
        dist_bucket: distanceBucket,
        bio_cosine: bioCosine,
        bio_dot: bioDot,
        bio_l2: bioL2,
        same_cluster: 0,
        group_inter: groupInter,
        group_jaccard: groupJaccard,
        same_group: sameGroup,
        interest_jaccard: interestJaccard,
        cold_prior: coldPrior,
      })
    }
    /**
     *  suggestBasedOnNearby: {
    _id: { '$oid': '69dfa11f86e60bb70f80c62d' },
    fullName: 'Vũ Hải Dũng',
    username: 'dungvh',
    dist: 0
  }
     */
    // distanceKm đã được tính batch từ location, không ghi đè bằng geonear ở bước này.

    const stripColdMeta = (c: Record<string, unknown>) => {
      const { interest_jaccard: _i, cold_prior: _cp, ...rest } = c
      return rest
    }

    const candidatesForPython = this.dedupeByCandidateId(
      Array.from(map.values()),
    )
      .map((c) => stripColdMeta(c as Record<string, unknown>))
      .filter(
        (candidate) =>
          typeof candidate?.candidateId === 'string' &&
          Number.isFinite(Number(candidate?.jaccard)) &&
          Number.isFinite(Number(candidate?.cosine_graph)) &&
          Number.isFinite(Number(candidate?.adamic_adar)) &&
          Number.isFinite(Number(candidate?.pref_attach)) &&
          Number.isFinite(Number(candidate?.deg_u)) &&
          Number.isFinite(Number(candidate?.deg_v)) &&
          Number.isFinite(Number(candidate?.dist_km)) &&
          Number.isFinite(Number(candidate?.dist_bucket)) &&
          Number.isFinite(Number(candidate?.bio_cosine)) &&
          Number.isFinite(Number(candidate?.bio_dot)) &&
          Number.isFinite(Number(candidate?.bio_l2)) &&
          Number.isFinite(Number(candidate?.same_cluster)) &&
          Number.isFinite(Number(candidate?.group_inter)) &&
          Number.isFinite(Number(candidate?.group_jaccard)) &&
          Number.isFinite(Number(candidate?.same_group)),
      ) as any

    let topKCandidates =
      await this.gbRankerService.predictTop100(candidatesForPython)

    const priorValues = Array.from(coldPriorById.values())
    const maxColdPrior = Math.max(1e-9, ...priorValues)

    const blendWithColdPrior = (rows: any[]): any[] => {
      if (!rows.length || !coldPriorById.size) return rows
      const alphaModel = coldStart ? 0.44 : 0.86
      return [...rows]
        .map((row) => {
          const pid = String(row.candidateId)
          const coldN = (coldPriorById.get(pid) ?? 0) / (maxColdPrior || 1e-9)
          const modelScore = this.toStoredScore(row.score)
          return {
            ...row,
            score: modelScore * alphaModel + coldN * (1 - alphaModel),
          }
        })
        .sort(
          (a, b) => this.toStoredScore(b.score) - this.toStoredScore(a.score),
        )
        .slice(0, 100)
    }

    topKCandidates = blendWithColdPrior(topKCandidates)

    if (!topKCandidates.length && candidatesForPython.length) {
      topKCandidates = [...candidatesForPython]
        .map((c: any) => ({
          ...c,
          score: (coldPriorById.get(String(c.candidateId)) ?? 0) / maxColdPrior,
        }))
        .sort(
          (a, b) => this.toStoredScore(b.score) - this.toStoredScore(a.score),
        )
        .slice(0, 100)
    }

    const latestFriendIds = await this.getFriendIdsExclusive(userId)

    topKCandidates = this.filterCandidatesExcludingFriends(
      this.dedupeByCandidateId(topKCandidates),
      latestFriendIds,
    ).slice(0, 100)

    const dayVersion = this.getDayVersion()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const featuresForAudit = this.filterCandidatesExcludingFriends(
      Array.from(map.values()),
      latestFriendIds,
    )

    await this.prisma.recommendationResult.upsert({
      where: { userId },
      create: {
        userId,
        topK: topKCandidates.length,
        candidates: topKCandidates,
        features: featuresForAudit,
        dayVersion,
        expiresAt,
      },
      update: {
        topK: topKCandidates.length,
        candidates: topKCandidates,
        features: featuresForAudit,
        dayVersion,
        expiresAt,
      },
    })

    console.timeEnd('Tổng thời gian recommendationHelper')
    return topKCandidates
  }
}
