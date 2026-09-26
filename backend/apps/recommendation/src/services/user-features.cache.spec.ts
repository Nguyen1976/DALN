import { UserFeaturesCache } from './user-features.cache'

/**
 * Cache đặc trưng user cho bước xếp hạng: đọc/ghi theo lô, và KHÔNG BAO GIỜ
 * làm hỏng luồng gợi ý — Redis lỗi thì coi như cache miss.
 */
describe('UserFeaturesCache', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('đọc lô bằng một lệnh MGET, bỏ qua user chưa có trong cache', async () => {
    const client = {
      mget: jest
        .fn()
        .mockResolvedValue([
          JSON.stringify({ bio: 'b', location: null, interests: ['x'] }),
          null,
        ]),
    }
    const cache = new UserFeaturesCache(client as never)

    await expect(cache.getUserFeaturesBatch(['u1', 'u2'])).resolves.toEqual({
      u1: { bio: 'b', location: null, interests: ['x'] },
    })
    expect(client.mget).toHaveBeenCalledWith(
      'user:u1:features',
      'user:u2:features',
    )
  })

  it('bản ghi hỏng JSON -> coi như cache miss', async () => {
    const client = { mget: jest.fn().mockResolvedValue(['{hong']) }
    const cache = new UserFeaturesCache(client as never)

    await expect(cache.getUserFeaturesBatch(['u1'])).resolves.toEqual({})
  })

  it('Redis lỗi khi đọc -> trả rỗng, không ném', async () => {
    const client = { mget: jest.fn().mockRejectedValue(new Error('down')) }
    const cache = new UserFeaturesCache(client as never)

    await expect(cache.getUserFeaturesBatch(['u1'])).resolves.toEqual({})
  })

  it('ghi lô bằng một pipeline, TTL mặc định 1 ngày', async () => {
    const pipeline = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }
    const client = { pipeline: jest.fn(() => pipeline) }
    const cache = new UserFeaturesCache(client as never)

    await cache.setUserFeaturesBatch([
      { id: 'u1', bio: null, interests: ['a'] },
    ])

    expect(pipeline.set).toHaveBeenCalledWith(
      'user:u1:features',
      JSON.stringify({ bio: null, location: null, interests: ['a'] }),
      'EX',
      86400,
    )
    expect(pipeline.exec).toHaveBeenCalledTimes(1)
  })

  it('Redis lỗi khi ghi -> không ném', async () => {
    const pipeline = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('down')),
    }
    const client = { pipeline: jest.fn(() => pipeline) }
    const cache = new UserFeaturesCache(client as never)

    await expect(
      cache.setUserFeaturesBatch([{ id: 'u1' }]),
    ).resolves.toBeUndefined()
  })
})
