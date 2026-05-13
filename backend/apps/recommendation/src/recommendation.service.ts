import { Neo4jService } from '@app/neo4j/neo4j.service'
import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QdrantService } from '@app/qdrant/qdrant.service'
import { UtilService } from '@app/util/util.service'
import { RedisService } from '@app/redis/redis.service'
import { PythonRecommendationClient } from './python-recommendation.client'
import * as _ from 'lodash'

type NearbyUser = {
  userId: string
  dist: number
  fullName?: string
  username?: string
}

type UserBioRow = {
  id: string
  bio: string | null
}

type UserProfileRow = {
  id: string
  bio: string | null
  location: unknown
}

@Injectable()
export class RecommendationService {
  constructor(
    private readonly neo4jService: Neo4jService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly qdrantService: QdrantService,
    private readonly utilService: UtilService,
    private readonly redisService: RedisService,
    private readonly pythonClient: PythonRecommendationClient,
  ) {}

  /**
   * Graph Features Computation
   */

  private computeJaccard(neighU: Set<string>, neighV: Set<string>): number {
    if (neighU.size === 0 && neighV.size === 0) return 0
    const intersection = new Set([...neighU].filter((x) => neighV.has(x)))
    const union = new Set([...neighU, ...neighV])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  private computeCosineGraph(neighU: Set<string>, neighV: Set<string>): number {
    const intersection = new Set([...neighU].filter((x) => neighV.has(x)))
    const denominator = Math.sqrt(neighU.size * neighV.size)
    return denominator > 0 ? intersection.size / denominator : 0
  }

  private computeAdamicAdar(
    neighU: Set<string>,
    neighV: Set<string>,
    degrees: Map<string, number>,
  ): number {
    const common = new Set([...neighU].filter((x) => neighV.has(x)))
    let score = 0
    for (const z of common) {
      const deg = degrees.get(z) ?? 1
      if (deg > 1) {
        score += 1 / Math.log(deg)
      }
    }
    return score
  }

  private computePreferentialAttachment(
    neighU: Set<string>,
    neighV: Set<string>,
  ): number {
    return neighU.size * neighV.size
  }

  private computeDegree(neighbors: Set<string>): number {
    return neighbors.size
  }

  /**
   * Bio Embedding Features Computation
   */

  private computeBioCosine(
    bioA: number[] | null,
    bioB: number[] | null,
  ): number {
    if (!bioA || !bioB || bioA.length === 0 || bioB.length === 0) return 0
    if (bioA.length !== bioB.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < bioA.length; i++) {
      dotProduct += bioA[i] * bioB[i]
      normA += bioA[i] * bioA[i]
      normB += bioB[i] * bioB[i]
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    return denominator > 0 ? dotProduct / denominator : 0
  }

  private computeBioDot(bioA: number[] | null, bioB: number[] | null): number {
    if (!bioA || !bioB || bioA.length === 0 || bioB.length === 0) return 0
    if (bioA.length !== bioB.length) return 0

    let dotProduct = 0
    for (let i = 0; i < bioA.length; i++) {
      dotProduct += bioA[i] * bioB[i]
    }
    return dotProduct
  }

  private computeBioL2(bioA: number[] | null, bioB: number[] | null): number {
    if (!bioA || !bioB || bioA.length === 0 || bioB.length === 0) return 0
    if (bioA.length !== bioB.length) return 0

    let sumSquaredDiff = 0
    for (let i = 0; i < bioA.length; i++) {
      const diff = bioA[i] - bioB[i]
      sumSquaredDiff += diff * diff
    }
    return Math.sqrt(sumSquaredDiff)
  }

  /**
   * Distance & Community Features Computation
   */

  private computeDistanceBucket(km: number): number {
    // buckets: 0-1=0, 1-5=1, 5-20=2, 20-100=3, 100+=4
    if (km <= 1) return 0
    if (km <= 5) return 1
    if (km <= 20) return 2
    if (km <= 100) return 3
    return 4
  }

  private computeSameGroup(
    userGroups: Set<string>,
    candidateGroups: Set<string>,
  ): number {
    // Returns 1 if they have at least 1 group in common, 0 otherwise
    for (const group of userGroups) {
      if (candidateGroups.has(group)) return 1
    }
    return 0
  }

  private computeGroupIntersection(
    userGroups: Set<string>,
    candidateGroups: Set<string>,
  ): number {
    // Count of common groups
    let count = 0
    for (const group of userGroups) {
      if (candidateGroups.has(group)) count++
    }
    return count
  }

  private computeGroupJaccard(
    userGroups: Set<string>,
    candidateGroups: Set<string>,
  ): number {
    // Jaccard similarity of group sets
    if (userGroups.size === 0 && candidateGroups.size === 0) return 0
    const intersection = new Set(
      [...userGroups].filter((x) => candidateGroups.has(x)),
    )
    const union = new Set([...userGroups, ...candidateGroups])
    return union.size > 0 ? intersection.size / union.size : 0
  }

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

  private haversineDistanceKm(
    from: [number, number],
    to: [number, number],
  ): number {
    const [fromLng, fromLat] = from
    const [toLng, toLat] = to

    const toRad = (deg: number) => (deg * Math.PI) / 180
    const earthRadiusKm = 6371

    const dLat = toRad(toLat - fromLat)
    const dLng = toRad(toLng - fromLng)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(fromLat)) *
        Math.cos(toRad(toLat)) *
        Math.sin(dLng / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return earthRadiusKm * c
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

  async recommendation() {
    console.time('Tổng thời gian cho 1000 User')
    // 1. Lấy 1000 user (có thể thay đổi số lượng)
    console.time('Bắt đầu lấy danh sách user từ MongoDB')
    const users = await this.prisma.userSnapshot.findMany({
      take: 1000,
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

    // 1. Lấy danh sách ID từ Neo4j
    const friendRecords = await this.neo4jService.read(
      `
    MATCH (me:User {userId: $userId})-[:FRIEND]-(friend:User)
    RETURN friend.userId AS friendId
  `,
      { userId },
    )

    // Vệ sinh friendIds: Chỉ lấy string, bỏ null/undefined
    const friendIds: string[] = friendRecords
      .map((r) => r.get('friendId'))
      .filter((id) => id && typeof id === 'string')

    friendIds.push(userId) // Luôn loại trừ chính mình
    const uniqueExcludeIds = Array.from(new Set(friendIds))

    // 2. Định nghĩa các Query cho Neo4j
    const queryCommonFriends = `
    MATCH (me:User {userId: $userId})-[:FRIEND]-(friend: User)-[:FRIEND]-(stranger:User)
    WHERE NOT (me)-[:FRIEND]-(stranger) AND me <> stranger
    RETURN stranger.userId AS id, count(friend) AS commonFriends
    ORDER BY commonFriends DESC LIMIT 300
  `

    const queryCommonGroups = `
    MATCH (me:User {userId: $userId})-[:MEMBER_OF]-(group:Group)<-[:MEMBER_OF]-(stranger:User)
    WHERE NOT (me)-[:FRIEND]-(stranger) AND me <> stranger
    RETURN stranger.userId AS id, count(group) AS commonGroups
    ORDER BY commonGroups DESC LIMIT 300
  `

    // 3. Convert userId sang UUID cho Qdrant
    const qdrantUuid = await this.utilService.mongoIdToUuid(userId)

    // 4. CHẠY SONG SONG
    console.time('Giai đoạn xử lý song song')
    const [commonFriendsRecords, commonGroupsRecords, qdrantRes, currentUser] =
      await Promise.all([
        this.neo4jService.read(queryCommonFriends, { userId }),
        this.neo4jService.read(queryCommonGroups, { userId }),
        this.qdrantService.recommendSimilar(qdrantUuid, 200, uniqueExcludeIds),
        this.prisma.userSnapshot.findUnique({
          where: { userId },
          select: { location: true, bio: true },
        }),
      ])
    console.timeEnd('Giai đoạn xử lý song song')

    // 5. MAP DỮ LIỆU
    const commonFriends = commonFriendsRecords.map((r) => ({
      id: r.get('id'),
      commonFriends: r.get('commonFriends').toNumber(),
    }))

    const commonGroups = commonGroupsRecords.map((r) => ({
      id: r.get('id'),
      commonGroups: r.get('commonGroups').toNumber(),
    }))

    // 6. GIAI ĐOẠN CUỐI: MONGODB GEONEAR
    console.time('Giai đoạn 5: MongoDB GeoNear')
    const userLocation = currentUser?.location as any
    let suggestBasedOnNearby: Array<NearbyUser> = []

    if (userLocation?.coordinates) {
      suggestBasedOnNearby = (await this.prisma.userSnapshot.aggregateRaw({
        pipeline: [
          {
            $geoNear: {
              near: {
                type: 'Point',
                coordinates: [
                  userLocation.coordinates[0],
                  userLocation.coordinates[1],
                ],
              },
              distanceField: 'dist',
              spherical: true,
              query: {
                userId: { $nin: uniqueExcludeIds },
              },
            },
          },
          { $limit: 200 },
          { $project: { userId: 1, username: 1, fullName: 1, dist: 1 } },
        ],
      })) as any
    }
    console.timeEnd('Giai đoạn 5: MongoDB GeoNear')

    // 7. Union candidate IDs từ các heuristic để enrich đầy đủ 4 feature.
    console.time('Giai đoạn 6: Build candidate union')
    const candidateIdsFromGraph = [
      ...commonFriends.map((u) => u.id),
      ...commonGroups.map((u) => u.id),
    ]
    const candidateIdsFromNearby = suggestBasedOnNearby.map((u) => u.userId)
    const candidateIdsFromQdrant = qdrantRes
      .map((u) => u.payload?.mongoId as string | undefined)
      .filter((id): id is string => typeof id === 'string')

    const allCandidateIds = Array.from(
      new Set([
        ...candidateIdsFromGraph,
        ...candidateIdsFromNearby,
        ...candidateIdsFromQdrant,
      ]),
    )
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

    // Fetch vectors từ Qdrant
    const vectorPoints =
      await this.qdrantService.getVectorsBatch(qdrantUserUuids)
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
        select: { userId: true, bio: true, location: true },
      })

      // Warm-up cache: lưu ngược trở lại Redis để tránh cache-miss cho lần tiếp theo
      if (missingProfiles.length > 0) {
        await this.redisService.setUserFeaturesBatch(missingProfiles)
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
          id,
          bio: cached.bio || null,
          location: cached.location || null,
        })
      } else {
        const profile = missingProfilesMap.get(id)
        if (profile)
          candidateProfiles.push({
            id: profile.userId,
            bio: profile.bio,
            location: profile.location,
          })
      }
    }

    // Giai đoạn 7d: Fetch neighbors (friends) của current user + tất cả candidates từ Neo4j
    console.time('Giai đoạn 7d: Fetch neighbors from Neo4j')
    const userIdsForNeighbors = [userId, ...allCandidateIds]
    const neighborsRecords = await this.neo4jService.read(
      `
      UNWIND $userIds AS userId
      MATCH (u:User {userId: userId})-[:FRIEND]-(friend:User)
      RETURN userId, collect(friend.userId) AS friendIds
    `,
      { userIds: userIdsForNeighbors },
    )

    // Build map: userId -> Set<friendIds> and degrees map
    const neighborsByUserId = new Map<string, Set<string>>()
    const degreesByUserId = new Map<string, number>()
    for (const record of neighborsRecords) {
      const uid = record.get('userId')
      const friendIds = record.get('friendIds') as string[]
      const friendSet = new Set(friendIds)
      neighborsByUserId.set(uid, friendSet)
      degreesByUserId.set(uid, friendSet.size)
    }

    // Ensure current user is in the map
    if (!neighborsByUserId.has(userId)) {
      neighborsByUserId.set(userId, new Set())
      degreesByUserId.set(userId, 0)
    }

    console.timeEnd('Giai đoạn 7d: Fetch neighbors from Neo4j')

    // Giai đoạn 7d.5: Fetch groups (MEMBER_OF) của current user + tất cả candidates từ Neo4j
    console.time('Giai đoạn 7d.5: Fetch groups from Neo4j')
    const groupsRecords = await this.neo4jService.read(
      `
      UNWIND $userIds AS userId
      MATCH (u:User {userId: userId})-[:MEMBER_OF]-(group:Group)
      RETURN userId, collect(group.id) AS groupIds
    `,
      { userIds: userIdsForNeighbors },
    )

    // Build map: userId -> Set<groupIds>
    const groupsByUserId = new Map<string, Set<string>>()
    for (const record of groupsRecords) {
      const uid = record.get('userId')
      const groupIds = record.get('groupIds') as string[]
      groupsByUserId.set(uid, new Set(groupIds))
    }

    // Ensure all users are in the map
    for (const id of userIdsForNeighbors) {
      if (!groupsByUserId.has(id)) {
        groupsByUserId.set(id, new Set())
      }
    }

    console.timeEnd('Giai đoạn 7d.5: Fetch groups from Neo4j')

    // Giai đoạn 7e: Không gọi Neo4j nữa — dùng commonFriends & commonGroups đã lấy ở Giai đoạn 4
    const commonFriendsById = new Map<string, number>(
      commonFriends.map((f) => [f.id, f.commonFriends]),
    )
    const commonGroupsById = new Map<string, number>(
      commonGroups.map((g) => [g.id, g.commonGroups]),
    )

    console.timeEnd('Giai đoạn 7: Enrich Features')

    const profileByCandidateId = new Map(
      (candidateProfiles as UserProfileRow[]).map((u) => [u.id, u]),
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
    const currentUserCoordinates = this.getCoordinates(currentUser?.location)
    console.timeEnd('Giai đoạn 7: Enrich all candidates from graph + mongo')

    console.timeEnd('Tổng thời gian recommendationHelper')

    console.log({
      commonFriends: commonFriends[0],
      commonGroups: commonGroups[0],
      suggestBasedOnInterest: qdrantRes[0],
      suggestBasedOnNearby: suggestBasedOnNearby[0],
    })

    const currentUserNeighbors = neighborsByUserId.get(userId) ?? new Set()
    const currentUserBioVector = bioVectorsByUserId.get(userId) ?? null

    const map = new Map<string, any>()
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
      const interestSimilarity = Math.max(qdrantScore, bioSimilarity)

      const candidateCoordinates = this.getCoordinates(
        candidateProfile?.location,
      )
      const distanceKm =
        currentUserCoordinates && candidateCoordinates
          ? this.haversineDistanceKm(
              currentUserCoordinates,
              candidateCoordinates,
            )
          : 0

      // Graph Features
      const candidateNeighbors = neighborsByUserId.get(candidateId) ?? new Set()
      const degreeU = this.computeDegree(currentUserNeighbors)
      const degreeV = this.computeDegree(candidateNeighbors)
      const jaccard = this.computeJaccard(
        currentUserNeighbors,
        candidateNeighbors,
      )
      const cosineGraph = this.computeCosineGraph(
        currentUserNeighbors,
        candidateNeighbors,
      )
      const adamicAdar = this.computeAdamicAdar(
        currentUserNeighbors,
        candidateNeighbors,
        degreesByUserId,
      )
      const prefAttach = this.computePreferentialAttachment(
        currentUserNeighbors,
        candidateNeighbors,
      )

      // Bio Embedding Features
      const candidateBioVector = bioVectorsByUserId.get(candidateId) ?? null
      const bioCosine = this.computeBioCosine(
        currentUserBioVector,
        candidateBioVector,
      )
      const bioDot = this.computeBioDot(
        currentUserBioVector,
        candidateBioVector,
      )
      const bioL2 = this.computeBioL2(currentUserBioVector, candidateBioVector)

      // Distance & Community Features
      const distanceBucket = this.computeDistanceBucket(distanceKm)
      const currentUserGroups = groupsByUserId.get(userId) ?? new Set()
      const candidateGroups = groupsByUserId.get(candidateId) ?? new Set()
      const sameGroup = this.computeSameGroup(
        currentUserGroups,
        candidateGroups,
      )
      const groupInter = this.computeGroupIntersection(
        currentUserGroups,
        candidateGroups,
      )
      const groupJaccard = this.computeGroupJaccard(
        currentUserGroups,
        candidateGroups,
      )

      map.set(candidateId, {
        candidateId,
        mutualFriends: commonFriendsById.get(candidateId) ?? 0,
        mutualGroups: commonGroupsById.get(candidateId) ?? 0,
        interestSimilarity,
        distanceKm,
        // Graph Features
        jaccard,
        cosineGraph,
        adamicAdar,
        prefAttach,
        degreeU,
        degreeV,
        // Bio Embedding Features
        bioCosine,
        bioDot,
        bioL2,
        // Distance & Community Features
        distanceBucket,
        sameGroup,
        groupInter,
        groupJaccard,
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

    const candidatesForPython = Array.from(map.values()).filter(
      (candidate) =>
        typeof candidate?.candidateId === 'string' &&
        Number.isFinite(Number(candidate?.mutualFriends)) &&
        Number.isFinite(Number(candidate?.mutualGroups)) &&
        Number.isFinite(Number(candidate?.interestSimilarity)) &&
        Number.isFinite(Number(candidate?.distanceKm)) &&
        Number.isFinite(Number(candidate?.jaccard)) &&
        Number.isFinite(Number(candidate?.cosineGraph)) &&
        Number.isFinite(Number(candidate?.adamicAdar)) &&
        Number.isFinite(Number(candidate?.prefAttach)) &&
        Number.isFinite(Number(candidate?.degreeU)) &&
        Number.isFinite(Number(candidate?.degreeV)) &&
        Number.isFinite(Number(candidate?.bioCosine)) &&
        Number.isFinite(Number(candidate?.bioDot)) &&
        Number.isFinite(Number(candidate?.bioL2)) &&
        Number.isFinite(Number(candidate?.distanceBucket)) &&
        Number.isFinite(Number(candidate?.sameGroup)) &&
        Number.isFinite(Number(candidate?.groupInter)) &&
        Number.isFinite(Number(candidate?.groupJaccard)),
    )
    const topKCandidates =
      await this.pythonClient.predictTop100(candidatesForPython)
    const dayVersion = this.getDayVersion()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await this.prisma.recommendationResult.upsert({
      where: { userId },
      create: {
        userId,
        topK: topKCandidates.length,
        candidates: topKCandidates,
        features: candidatesForPython,
        dayVersion,
        expiresAt,
      },
      update: {
        topK: topKCandidates.length,
        candidates: topKCandidates,
        features: candidatesForPython,
        dayVersion,
        expiresAt,
      },
    })

    return topKCandidates
  }
}
