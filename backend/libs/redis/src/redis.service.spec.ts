import { Test, TestingModule } from '@nestjs/testing'
import { RedisService } from './redis.service'

/**
 * Smoke test with a stubbed client: verifies the service is constructible and
 * that its presence lookup goes through the injected Redis client.
 */
describe('RedisService', () => {
  let service: RedisService

  const redisStub = {
    smembers: jest.fn().mockResolvedValue([]),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-2),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: 'REDIS_CLIENT', useValue: redisStub },
      ],
    }).compile()

    service = module.get<RedisService>(RedisService)
  })

  it('khởi tạo được', () => {
    expect(service).toBeDefined()
  })

  it('người dùng không có kết nối nào thì bị coi là ngoại tuyến', async () => {
    await expect(service.isOnline('user-1')).resolves.toBe(false)
    expect(redisStub.smembers).toHaveBeenCalled()
  })
})
