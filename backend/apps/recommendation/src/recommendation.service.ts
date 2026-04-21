import { Neo4jService } from '@app/neo4j/neo4j.service'
import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QdrantService } from '@app/qdrant/qdrant.service'
import { UtilService } from '@app/util/util.service'

@Injectable()
export class RecommendationService {
  constructor(
    private readonly neo4jService: Neo4jService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly qdrantService: QdrantService,
    private readonly utilService: UtilService,
  ) {}
  async getHello(userId: string) {
    console.log(`--- Bắt đầu xử lý Suggest cho User: ${userId} ---`)
    console.time('Tổng thời gian getHello')

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

    const suggestBasedOnInterest = qdrantRes.map(
      (user) => user.payload?.mongoId,
    )

    // 6. GIAI ĐOẠN CUỐI: MONGODB GEONEAR
    console.time('Giai đoạn 5: MongoDB GeoNear')
    const userLocation = currentUser?.location as any
    let suggestBasedOnNearby: Array<{ _id: string | { $oid: string } }> = []

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

    console.timeEnd('Tổng thời gian getHello')

    const result = new Set<string>(
      [
        ...commonFriends.map((u) => u.id),
        ...commonGroups.map((u) => u.id),
        ...suggestBasedOnInterest,
        ...suggestBasedOnNearby.map((u) =>
          typeof u._id === 'string' ? u._id : u._id.$oid,
        ),
      ]
    )
    
    return {
      commonFriends,
      commonGroups,
      suggestBasedOnInterest,
      suggestBasedOnNearby,
    }
  }
}
