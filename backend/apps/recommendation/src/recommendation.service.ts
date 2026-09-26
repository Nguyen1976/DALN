import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RecommendationDirtyService } from './services/recommendation-dirty.service'
import { UserFeaturesCache } from './services/user-features.cache'
import { QdrantService } from '@app/qdrant/qdrant.service'
import { UtilService } from '@app/util/util.service'
import { RedisService } from '@app/redis/redis.service'
import { UserSnapshotHydrateService } from './services/user-snapshot-hydrate.service'
import { FriendGraphService } from './services/friend-graph.service'
import { EmbeddingService } from './services/embedding.service'
import { FeatureService, SAFE_FEATURES } from './services/feature.service'
import {
  GbRankerService,
  type RankedCandidate,
  type RankingCandidateInput,
} from './services/gb-ranker.service'
import { toGeoPoint } from '@app/util'

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

type MutualFriendPreview = {
  userId: string
  username: string
  fullName: string
  avatar: string | null
}

/** A suggested friend, as GET /recommendation/me returns it. */
export type SuggestedFriend = MutualFriendPreview & {
  mutualFriends: { count: number; preview: MutualFriendPreview[] }
}

/** How many mutual friends each card shows as avatars. */
const MUTUAL_FRIEND_PREVIEW = 2

/** A stored suggestion: the candidate, its score and the features behind it. */
type RecommendationFeatureRow = RankingCandidateInput & { score?: number }

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly qdrantService: QdrantService,
    private readonly utilService: UtilService,
    private readonly redisService: RedisService,
    private readonly embeddingService: EmbeddingService,
    private readonly featureService: FeatureService,
    private readonly gbRankerService: GbRankerService,
    private readonly userSnapshotHydrate: UserSnapshotHydrateService,
    private readonly friendGraph: FriendGraphService,
    private readonly dirty: RecommendationDirtyService,
    private readonly featuresCache: UserFeaturesCache,
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

  private dedupeByCandidateId<T extends { candidateId?: string }>(
    rows: T[],
  ): T[] {
    const seen = new Set<string>()
    const out: T[] = []
    for (const row of rows) {
      const candidateId = row?.candidateId ?? ''
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
      this.logger.warn('[recommendation] cold-start interest match failed', e)
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
      this.logger.warn('[recommendation] cold-start geo ring failed', e)
      return []
    }
  }

  private readonly heuristicPoolLimit = 3

  /** Qdrant retrieve/search may return a plain number[] or a named-vector wrapper. */
  private extractDenseVector(raw: unknown): number[] | null {
    if (Array.isArray(raw) && raw.length && typeof raw[0] === 'number') {
      return raw as number[]
    }
    if (raw && typeof raw === 'object' && 'default' in raw) {
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
      this.logger.warn('[recommendation] top interest overlap failed', e)
      return []
    }
  }

  /**
   * Read-time cold start when there is no stored recommendation list.
   * Pool = 3 Qdrant (similar bio) + 3 $geoNear + 3 best interest overlap, de-duplicated. No Python GB model.
   */
  private async getLiveHeuristicColdStartRecommendations(
    userId: string,
  ): Promise<string[]> {
    await this.userSnapshotHydrate.ensureUserSnapshot(userId)
    await this.userSnapshotHydrate.hydratePeerSnapshotsIfNeeded(1)

    const me = await this.prisma.userSnapshot.findUnique({
      where: { userId },
      select: { bio: true, location: true, interests: true },
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
        await this.embeddingService.embedBio(userId, me.bio ?? '')
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

    const nearPoint = toGeoPoint(me.location)
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

    return mergedIds
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

  /**
   * The suggestions to show `userId`, best first: the stored list (rebuilt
   * nightly), or — when there is none yet — a quick heuristic one that is
   * stored in its place. Friends are left out; the stored row is written back
   * only when that actually removed someone.
   */
  async getRecommendationForUser(userId: string): Promise<SuggestedFriend[]> {
    const friendIds = await this.getFriendIdsExclusive(userId)
    const exclude = new Set([userId, ...friendIds])

    const stored = await this.prisma.recommendationResult.findUnique({
      where: { userId },
      select: { candidates: true },
    })
    const storedRows = Array.isArray(stored?.candidates)
      ? (stored.candidates as RecommendationFeatureRow[])
      : []
    const visibleRows = storedRows.filter(
      (row) =>
        typeof row?.candidateId === 'string' && !exclude.has(row.candidateId),
    )
    if (stored && visibleRows.length !== storedRows.length) {
      await this.prisma.recommendationResult.update({
        where: { userId },
        data: { candidates: visibleRows, topK: visibleRows.length },
      })
    }

    let suggestions = await this.toSuggestedFriends(
      visibleRows.map((row) => row.candidateId),
      friendIds,
    )
    if (suggestions.length === 0) {
      const liveIds = (
        await this.getLiveHeuristicColdStartRecommendations(userId)
      ).filter((id) => !exclude.has(id))
      if (liveIds.length > 0) {
        await this.storeList(
          userId,
          liveIds.map((candidateId, rank) => ({
            candidateId,
            score: 1 - (rank + 1) * 0.01,
          })),
          [],
        )
        suggestions = await this.toSuggestedFriends(liveIds, friendIds)
      }
    }
    return suggestions
  }

  /**
   * Candidates as the client shows them: name, avatar and the friends they
   * share with the viewer — nothing else. The stored rows also hold the
   * ranking features and the snapshot has bio and exact location; none of
   * that leaves the service. Mutual friends are read live, as friendships
   * change during the day while the list is rebuilt only nightly.
   */
  private async toSuggestedFriends(
    candidateIds: string[],
    viewerFriendIds: string[],
  ): Promise<SuggestedFriend[]> {
    if (candidateIds.length === 0) return []

    const [profiles, mutualIds] = await Promise.all([
      this.prisma.userSnapshot.findMany({
        where: { userId: { in: candidateIds } },
        select: { userId: true, username: true, fullName: true, avatar: true },
      }),
      this.friendGraph
        .getMutualFriendIds(viewerFriendIds, candidateIds)
        .catch((e) => {
          // The list is still useful without the "N mutual friends" line.
          this.logger.warn('[recommendation] mutual friends failed', e)
          return new Map<string, string[]>()
        }),
    ])

    const previewIds = [...new Set([...mutualIds.values()].flat())]
    const people = previewIds.length
      ? await this.prisma.userSnapshot.findMany({
          where: { userId: { in: previewIds } },
          select: {
            userId: true,
            username: true,
            fullName: true,
            avatar: true,
          },
        })
      : []
    const personById = new Map(people.map((person) => [person.userId, person]))
    const profileById = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    )

    return candidateIds.flatMap((candidateId) => {
      const profile = profileById.get(candidateId)
      if (!profile) return []
      const ids = mutualIds.get(candidateId) ?? []
      const preview = ids
        .map((id) => personById.get(id))
        .filter((person): person is MutualFriendPreview => Boolean(person))
        // Photos first: the stacked avatars look empty without them.
        .sort((a, b) => Number(Boolean(b.avatar)) - Number(Boolean(a.avatar)))
        .slice(0, MUTUAL_FRIEND_PREVIEW)
      return [{ ...profile, mutualFriends: { count: ids.length, preview } }]
    })
  }

  /** Save `userId`'s list (and, from the nightly run, its features for audit). */
  private async storeList(
    userId: string,
    candidates: RecommendationFeatureRow[],
    features: unknown[],
  ) {
    const data = {
      topK: candidates.length,
      candidates: candidates as object[],
      features: features as object[],
      dayVersion: this.getDayVersion(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }
    await this.prisma.recommendationResult.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  }

  /**
   * Tính lại gợi ý cho những user CÓ THAY ĐỔI kể từ lượt trước.
   *
   * Trước đây hàm này `findMany` toàn bộ userSnapshot không giới hạn, rồi chạy
   * cho từng người — mỗi người tốn 2 truy vấn Neo4j + 1 vector search Qdrant +
   * 1 truy vấn Mongo. Đa số là vô ích vì người dùng không đổi gì so với hôm
   * trước, và job chết giữa chừng thì lần sau phải làm lại từ đầu.
   *
   * Nay đọc từ hàng đợi `rcm:dirty:users` (SPOP nguyên tử): chi phí gắn với số
   * thay đổi thật, và những user chưa pop vẫn nằm nguyên trong set nên job có
   * thể tiếp tục đúng chỗ dở sau sự cố.
   */
  async recommendation() {
    const startedAt = Date.now()
    const CHUNK_SIZE = 50
    const TAKE_PER_ROUND = 500

    let processed = 0
    let failed = 0

    for (;;) {
      const userIds = await this.dirty.take(TAKE_PER_ROUND)
      if (!userIds.length) break

      for (let start = 0; start < userIds.length; start += CHUNK_SIZE) {
        const chunk = userIds.slice(start, start + CHUNK_SIZE)
        // allSettled: một user lỗi không được làm hỏng cả lô 50 như Promise.all
        const results = await Promise.allSettled(
          chunk.map((userId) => this.recommendationHelper(userId)),
        )

        const retry = chunk.filter((_u, i) => results[i].status === 'rejected')
        if (retry.length) {
          failed += retry.length
          await this.dirty.requeue(retry)
        }
        processed += chunk.length - retry.length
      }
    }

    this.logger.log(
      `Daily refresh: ${processed} user thành công, ${failed} trả lại hàng đợi, ${Date.now() - startedAt}ms`,
    )
  }

  /**
   * Lưới an toàn: quét toàn bộ user và đẩy vào hàng đợi dirty.
   * Cơ chế đánh dấu theo sự kiện luôn có nguy cơ sót (mất message, service
   * ngừng đúng lúc), nên cần một lần đối soát định kỳ. Chạy hằng tuần.
   */
  async enqueueFullRefresh(): Promise<number> {
    const BATCH = 1000
    let cursor: string | undefined
    let total = 0

    for (;;) {
      const users = await this.prisma.userSnapshot.findMany({
        select: { userId: true },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { userId: cursor } } : {}),
        orderBy: { userId: 'asc' },
      })
      if (!users.length) break

      await this.dirty.markDirty(...users.map((u) => u.userId))
      total += users.length
      cursor = users[users.length - 1].userId
      if (users.length < BATCH) break
    }

    this.logger.log(`Full refresh: đã đưa ${total} user vào hàng đợi`)
    return total
  }

  async recommendationHelper(userId: string) {
    // 1. Bạn bè từ MongoDB (cold start: có thể không có dữ liệu)
    let friendIds: string[] = []
    try {
      friendIds = await this.friendGraph.getFriendIds(userId)
    } catch (e) {
      this.logger.warn('[recommendation] friend list failed', e)
    }
    friendIds = friendIds.filter((id) => id && typeof id === 'string')

    const friendCountExclusive = friendIds.length
    const uniqueExcludeIds = Array.from(new Set([...friendIds, userId]))

    const qdrantUuid = this.utilService.mongoIdToUuid(userId)

    const settled = await Promise.allSettled([
      this.friendGraph.getCommonFriends(userId, 300),
      this.friendGraph.getCommonGroups(userId, 300),
      this.qdrantService.recommendSimilar(qdrantUuid, 200, uniqueExcludeIds),
      this.prisma.userSnapshot.findUnique({
        where: { userId },
        select: { location: true, bio: true, interests: true },
      }),
    ])

    const commonFriends =
      settled[0].status === 'fulfilled' ? settled[0].value : []
    if (settled[0].status === 'rejected') {
      this.logger.warn(
        '[recommendation] commonFriends failed',
        settled[0].reason,
      )
    }

    const commonGroups =
      settled[1].status === 'fulfilled' ? settled[1].value : []
    if (settled[1].status === 'rejected') {
      this.logger.warn(
        '[recommendation] commonGroups failed',
        settled[1].reason,
      )
    }

    const qdrantRes = settled[2].status === 'fulfilled' ? settled[2].value : []
    if (settled[2].status === 'rejected') {
      this.logger.warn(
        '[recommendation] qdrant recommendSimilar failed',
        settled[2].reason,
      )
    }

    const currentUser =
      settled[3].status === 'fulfilled' ? settled[3].value : null
    if (settled[3].status === 'rejected') {
      this.logger.warn(
        '[recommendation] prisma currentUser failed',
        settled[3].reason,
      )
    }

    const nearPoint = toGeoPoint(currentUser?.location)
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
        })) as unknown as NearbyUser[]
      } catch (e) {
        this.logger.warn('[recommendation] MongoDB GeoNear failed', e)
      }
    }

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

    // Giai đoạn 6.5: Lấy bio embedding vectors từ Qdrant
    // Qdrant point ids are UUIDs derived from the Mongo ids.
    const uuidToMongoId = new Map(
      [userId, ...allCandidateIds].map((id) => [
        this.utilService.mongoIdToUuid(id),
        id,
      ]),
    )

    let vectorPoints: Awaited<ReturnType<QdrantService['getVectorsBatch']>> = []
    try {
      vectorPoints = await this.qdrantService.getVectorsBatch([
        ...uuidToMongoId.keys(),
      ])
    } catch (e) {
      this.logger.warn('[recommendation] getVectorsBatch failed', e)
    }
    const bioVectorsByUserId = new Map<string, number[]>()
    for (const point of vectorPoints) {
      const mongoId = uuidToMongoId.get(String(point.id))
      if (mongoId && point.vector) {
        bioVectorsByUserId.set(mongoId, point.vector as number[])
      }
    }

    // Giai đoạn 7a: Fetch từ Redis cache (batch)
    const cachedFeatures =
      await this.featuresCache.getUserFeaturesBatch(allCandidateIds)
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
        await this.featuresCache.setUserFeaturesBatch(
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
    const userIdsForNeighbors = [userId, ...allCandidateIds]
    let neighborsByUserId = new Map<string, Set<string>>()
    try {
      neighborsByUserId =
        await this.friendGraph.getNeighborsBatch(userIdsForNeighbors)
    } catch (e) {
      this.logger.warn('[recommendation] neighbors batch failed', e)
    }

    const degreesByUserId = new Map<string, number>()
    for (const [uid, friendSet] of neighborsByUserId) {
      degreesByUserId.set(uid, friendSet.size)
    }
    if (!neighborsByUserId.has(userId)) {
      neighborsByUserId.set(userId, new Set())
      degreesByUserId.set(userId, 0)
    }

    // Giai đoạn 7d.5: Fetch groups của current user + candidates từ MongoDB
    let groupsByUserId = new Map<string, Set<string>>()
    try {
      groupsByUserId =
        await this.friendGraph.getGroupsBatch(userIdsForNeighbors)
    } catch (e) {
      this.logger.warn('[recommendation] groups batch failed', e)
    }
    for (const id of userIdsForNeighbors) {
      if (!groupsByUserId.has(id)) {
        groupsByUserId.set(id, new Set())
      }
    }

    const profileByCandidateId = new Map(
      candidateProfiles.map((u) => [u.userId, u]),
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
    const currentUserInterests = currentUser?.interests ?? []

    this.logger.debug(
      JSON.stringify({
        commonFriends: commonFriends[0],
        commonGroups: commonGroups[0],
        suggestBasedOnInterest: qdrantRes[0],
        suggestBasedOnNearby: suggestBasedOnNearby[0],
        coldStart,
        candidatePool: allCandidateIds.length,
      }),
    )

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

      const interestJaccard = this.computeInterestJaccard(
        currentUserInterests,
        candidateProfile?.interests ?? [],
      )

      // The very function the training set is built with (dataset-builder):
      // a hand-copied version here had drifted — a missing location scored as
      // distance 0, "right next door", where training had used -1.
      const features = this.featureService.computePairFeatures({
        neighU: currentUserNeighbors,
        neighV: neighborsByUserId.get(candidateId) ?? new Set(),
        degrees: degreesByUserId,
        bioU: currentUserBioVector,
        bioV: bioVectorsByUserId.get(candidateId) ?? null,
        locationU: currentUser?.location,
        locationV: candidateProfile?.location,
        groupsU: groupsByUserId.get(userId) ?? new Set(),
        groupsV: groupsByUserId.get(candidateId) ?? new Set(),
      })

      const vecSignal = Math.max(features.bio_cosine, Math.min(1, qdrantScore))
      const coldPrior = this.computeColdStartPrior({
        interestJaccard,
        bioTokenSim: bioSimilarity,
        distKm: features.dist_km,
        vecSignal,
      })
      coldPriorById.set(candidateId, coldPrior)

      map.set(candidateId, {
        candidateId,
        ...features,
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
      const rest = { ...c }
      delete rest.interest_jaccard
      delete rest.cold_prior
      return rest
    }

    const candidatesForPython = this.dedupeByCandidateId(
      Array.from(map.values()),
    )
      .map((c) => stripColdMeta(c as Record<string, unknown>))
      // Only candidates with every feature the model reads.
      .filter(
        (candidate): candidate is RankingCandidateInput =>
          typeof candidate?.candidateId === 'string' &&
          SAFE_FEATURES.every((name) =>
            Number.isFinite(Number(candidate[name])),
          ),
      )

    let topKCandidates =
      await this.gbRankerService.predictTop100(candidatesForPython)

    const priorValues = Array.from(coldPriorById.values())
    const maxColdPrior = Math.max(1e-9, ...priorValues)

    const blendWithColdPrior = (rows: RankedCandidate[]): RankedCandidate[] => {
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
        .map((c) => ({
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

    await this.storeList(
      userId,
      topKCandidates,
      this.filterCandidatesExcludingFriends(
        Array.from(map.values()),
        latestFriendIds,
      ),
    )

    return topKCandidates
  }
}
