import { RecommendationService } from './recommendation.service'

jest.mock('@app/qdrant/qdrant.service', () => ({ QdrantService: class {} }))

const ME = 'me'
const snapshot = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  username: userId,
  fullName: userId.toUpperCase(),
  avatar: null,
  ...extra,
})

function setup({
  stored,
  friends = [] as string[],
  mutual = new Map<string, string[]>(),
}: {
  stored: { candidateId: string; score?: number }[] | null
  friends?: string[]
  mutual?: Map<string, string[]>
}) {
  const snapshots = [
    snapshot('a'),
    snapshot('b'),
    snapshot('friend'),
    snapshot('f1', { avatar: 'x.png' }),
  ]
  const prisma = {
    recommendationResult: {
      findUnique: jest
        .fn()
        .mockResolvedValue(stored ? { candidates: stored } : null),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    userSnapshot: {
      findMany: jest.fn(({ where }: { where: { userId: { in: string[] } } }) =>
        Promise.resolve(
          snapshots.filter((s) => where.userId.in.includes(s.userId)),
        ),
      ),
    },
  }
  const friendGraph = {
    getFriendIds: jest.fn().mockResolvedValue(friends),
    getMutualFriendIds: jest.fn().mockResolvedValue(mutual),
  }
  const service = new RecommendationService(
    prisma as never,
    {} as never, // qdrant
    {} as never, // util
    {} as never, // redis
    {} as never, // embedding
    {} as never, // feature
    {} as never, // gb ranker
    {} as never, // snapshot hydrate
    friendGraph as never,
    {} as never, // dirty queue
    {} as never, // features cache
  )
  return { service, prisma }
}

describe('RecommendationService.getRecommendationForUser', () => {
  it('returns only what the card shows, best first, with mutual friends', async () => {
    const { service, prisma } = setup({
      stored: [
        { candidateId: 'b', score: 0.9 },
        { candidateId: 'a', score: 0.5 },
      ],
      friends: ['f1'],
      mutual: new Map([['b', ['f1']]]),
    })

    const result = await service.getRecommendationForUser(ME)

    expect(result).toEqual([
      {
        userId: 'b',
        username: 'b',
        fullName: 'B',
        avatar: null,
        mutualFriends: {
          count: 1,
          preview: [snapshot('f1', { avatar: 'x.png' })],
        },
      },
      {
        userId: 'a',
        username: 'a',
        fullName: 'A',
        avatar: null,
        mutualFriends: { count: 0, preview: [] },
      },
    ])
    // Nothing removed, so the stored row is left alone.
    expect(prisma.recommendationResult.update).not.toHaveBeenCalled()
  })

  it('drops people who became friends and writes the shorter list back', async () => {
    const { service, prisma } = setup({
      stored: [{ candidateId: 'friend' }, { candidateId: 'a' }],
      friends: ['friend'],
    })

    const result = await service.getRecommendationForUser(ME)

    expect(result.map((s) => s.userId)).toEqual(['a'])
    expect(prisma.recommendationResult.update).toHaveBeenCalledWith({
      where: { userId: ME },
      data: { candidates: [{ candidateId: 'a' }], topK: 1 },
    })
  })

  it('builds and stores a quick list when there is none', async () => {
    const { service, prisma } = setup({ stored: null })
    jest
      .spyOn(service as never, 'getLiveHeuristicColdStartRecommendations')
      .mockResolvedValue(['a', 'b'] as never)

    const result = await service.getRecommendationForUser(ME)

    expect(result.map((s) => s.userId)).toEqual(['a', 'b'])
    expect(prisma.recommendationResult.upsert).toHaveBeenCalledTimes(1)
  })
})
