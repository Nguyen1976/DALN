import { Neo4jService } from '@app/neo4j/neo4j.service'
import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QdrantService } from '@app/qdrant/qdrant.service'
import { UtilService } from '@app/util/util.service'
import { PythonRecommendationClient } from './python-recommendation.client'

type NearbyUser = {
  _id: string | { $oid: string }
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
    private readonly pythonClient: PythonRecommendationClient,
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

  async recommendation() {
    console.time('Tổng thời gian recommendation')
    //hàm này sẽ lấy tạm 1k user sau dó rcm cho từng người

    console.time('Bắt đầu lấy danh sách user từ MongoDB')
    const users = await this.prisma.user.findMany({
      take: 1000,
      select: { id: true },
    })
    console.timeEnd('Bắt đầu lấy danh sách user từ MongoDB')
    console.time('Bắt đầu vòng lặp recommendationHelper cho từng user')
    for (const user of users) {
      const rcm = await this.recommendationHelper(user.id)
      console.log(`Gợi ý cho user ${user.id}:`, rcm)
    }
    console.timeEnd('Bắt đầu vòng lặp recommendationHelper cho từng user')
    console.timeEnd('Tổng thời gian recommendation')
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
        this.prisma.user.findUnique({
          where: { id: userId },
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
      suggestBasedOnNearby = (await this.prisma.user.aggregateRaw({
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
                _id: { $nin: uniqueExcludeIds.map((id) => ({ $oid: id })) },
              },
            },
          },
          { $limit: 200 },
          { $project: { _id: 1, username: 1, fullName: 1, dist: 1 } },
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
    const candidateIdsFromNearby = suggestBasedOnNearby.map((u) =>
      typeof u._id === 'string' ? u._id : u._id.$oid,
    )
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

    console.time('Giai đoạn 7: Enrich all candidates from graph + mongo')
    const queryBatchCommonFriends = `
      MATCH (me:User {userId: $userId})
      UNWIND $candidateIds AS candidateId
      OPTIONAL MATCH (me)-[:FRIEND]-(f:User)-[:FRIEND]-(candidate:User {userId: candidateId})
      RETURN candidateId AS id, count(DISTINCT f) AS commonFriends
    `

    const queryBatchCommonGroups = `
      MATCH (me:User {userId: $userId})
      UNWIND $candidateIds AS candidateId
      OPTIONAL MATCH (me)-[:MEMBER_OF]-(g:Group)<-[:MEMBER_OF]-(candidate:User {userId: candidateId})
      RETURN candidateId AS id, count(DISTINCT g) AS commonGroups
    `

    const [batchFriendsRecords, batchGroupsRecords, candidateProfiles] =
      allCandidateIds.length > 0
        ? await Promise.all([
            this.neo4jService.read(queryBatchCommonFriends, {
              userId,
              candidateIds: allCandidateIds,
            }),
            this.neo4jService.read(queryBatchCommonGroups, {
              userId,
              candidateIds: allCandidateIds,
            }),
            this.prisma.user.findMany({
              where: { id: { in: allCandidateIds } },
              select: { id: true, bio: true, location: true },
            }),
          ])
        : [[], [], []]

    const commonFriendsById = new Map(
      batchFriendsRecords.map((r) => [
        String(r.get('id')),
        Number(r.get('commonFriends')?.toNumber?.() ?? 0),
      ]),
    )

    const commonGroupsById = new Map(
      batchGroupsRecords.map((r) => [
        String(r.get('id')),
        Number(r.get('commonGroups')?.toNumber?.() ?? 0),
      ]),
    )

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

    // "mutualFriends",
    // "mutualGroups",
    // "interestSimilarity",
    // "distanceKm",

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

      map.set(candidateId, {
        candidateId,
        mutualFriends: commonFriendsById.get(candidateId) ?? 0,
        mutualGroups: commonGroupsById.get(candidateId) ?? 0,
        interestSimilarity,
        distanceKm,
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
        Number.isFinite(Number(candidate?.distanceKm)),
    )
    const top100 = await this.pythonClient.predictTop100(candidatesForPython)

    //ghi với verstion 1
    /**
     * model impresstionLog {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  userId  String   @db.ObjectId
  candidateId String @db.ObjectId
  features Features
  score Float
  rank Int
  version Int
  createdAt DateTime @default(now())
}

     * 
     * 
     * 
     * 
     */
    /**
     * enum Action {
  MESSAGE
  FRIEND
  IGNORE
}

model actionLog {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  userId  String   @db.ObjectId
  candidateId String @db.ObjectId
  action  Action
  createdAt DateTime @default(now())
}

     * 
     * 
     */

    await this.prisma.impresstionLog.createMany({
      data: top100.map((c: any, index: number) => ({
        userId,
        candidateId: c.candidateId,
        features: {
          mutualFriends: c.mutualFriends,
          mutualGroups: c.mutualGroups,
          interestSimilarity: c.interestSimilarity,
          distanceKm: c.distanceKm,
        },
        action: 'IGNORE',
        score: this.toStoredScore(c.score),
        rank: index + 1,
        version: 3,
      })),
    })

    return top100
  }
}
