import { createAdapter, createShardedAdapter } from '@socket.io/redis-adapter'
import { RedisIoAdapter } from './redis.adapter'

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => 'classic'),
  createShardedAdapter: jest.fn(() => 'sharded'),
}))
type FakeClient = { connect: jest.Mock; duplicate: () => FakeClient }
jest.mock('redis', () => ({
  createClient: jest.fn((): FakeClient => {
    const client: FakeClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      duplicate: () => client,
    }
    return client
  }),
}))

describe('RedisIoAdapter', () => {
  it('uses the sharded adapter in dynamic mode', async () => {
    const adapter = new RedisIoAdapter({} as never)

    await adapter.connectToRedis()

    expect(createShardedAdapter).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { subscriptionMode: 'dynamic' },
    )
    expect(createAdapter).not.toHaveBeenCalled()
  })
})
