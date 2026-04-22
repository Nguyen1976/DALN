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

@Injectable()
export class RecommendationService {
  constructor(
    private readonly neo4jService: Neo4jService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly qdrantService: QdrantService,
    private readonly utilService: UtilService,
    private readonly pythonClient: PythonRecommendationClient,
  ) {}

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
          select: { location: true },
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
    commonFriends.forEach((u) =>
      map.set(u.id, {
        candidateId: u.id,
        mutualFriends: u.commonFriends,
        mutualGroups: 0,
        interestSimilarity: 0,
        distanceKm: 0,
      }),
    )
    commonGroups.forEach((u) =>
      map.set(
        u.id,
        map.has(u.id)
          ? { ...map.get(u.id), mutualGroups: u.commonGroups }
          : {
              candidateId: u.id,
              mutualFriends: 0,
              mutualGroups: u.commonGroups,
              interestSimilarity: 0,
              distanceKm: 0,
            },
      ),
    )
    /**
     *  suggestBasedOnInterest: {
    id: '89e5d1fa-359f-5f66-a5fb-bc0f72a0ff5c',
    version: 86,
    score: 0.7603104,
    payload: { mongoId: '69dfa12186e60bb70f816cf9', username: 'bui_khanh_5' }
  },
     */
    qdrantRes.forEach((u) => {
      const mongoId = u.payload?.mongoId as string | undefined
      if (!mongoId) {
        return
      }

      map.set(
        mongoId,
        map.has(mongoId)
          ? {
              ...map.get(mongoId),
              interestSimilarity: Number(u.score ?? 0),
            }
          : {
              candidateId: mongoId,
              mutualFriends: 0,
              mutualGroups: 0,
              interestSimilarity: Number(u.score ?? 0),
              distanceKm: 0,
            },
      )
    })
    /**
     *  suggestBasedOnNearby: {
    _id: { '$oid': '69dfa11f86e60bb70f80c62d' },
    fullName: 'Vũ Hải Dũng',
    username: 'dungvh',
    dist: 0
  }
     */
    const getId = (id: string | { $oid: string }) =>
      typeof id === 'string' ? id : id.$oid

    suggestBasedOnNearby.forEach((u) =>
      map.set(
        getId(u._id),
        map.has(getId(u._id))
          ? {
              ...map.get(getId(u._id)),
              distanceKm: u.dist / 1000, // Convert m sang km
            }
          : {
              candidateId: getId(u._id),
              mutualFriends: 0,
              mutualGroups: 0,
              interestSimilarity: 0,
              distanceKm: u.dist / 1000,
            },
      ),
    )

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
  score Int
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

    top100.forEach(async (c: any, index) => {
      await this.prisma.impresstionLog.create({
        data: {
          userId,
          candidateId: c.candidateId,
          features: {
            mutualFriends: c.mutualFriends,
            mutualGroups: c.mutualGroups,
            interestSimilarity: c.interestSimilarity,
            distanceKm: c.distanceKm,
          },
          score: c.score as number,
          rank: index + 1,
          version: 1,
        },
      })

      await this.prisma.actionLog.create({
        data: {
          userId,
          candidateId: c.candidateId,
          action: 'IGNORE', // or some default action
          createdAt: new Date(),
        },
      })
    })

    return top100
  }
}
