import { Test, TestingModule } from '@nestjs/testing'
import { RedisService } from '@app/redis/redis.service'
import { UserAuthStore } from './user-auth.store'

describe('UserAuthStore — token đặt lại mật khẩu', () => {
  let service: UserAuthStore

  const pipelineStub = {
    del: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }
  const client = {
    get: jest.fn().mockResolvedValue(null),
    getdel: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn(() => pipelineStub),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    pipelineStub.del.mockReturnThis()
    pipelineStub.set.mockReturnThis()
    pipelineStub.exec.mockResolvedValue([])
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAuthStore,
        RedisService,
        { provide: 'REDIS_CLIENT', useValue: client },
      ],
    }).compile()
    service = module.get<UserAuthStore>(UserAuthStore)
  })

  it('lưu token: ghi cả key tra cứu lẫn chỉ mục ngược, cùng TTL 900', async () => {
    await service.savePasswordResetToken('AN@Example.Test ', 'u1', 'hash-new')

    // Email phải được chuẩn hoá trước khi thành tên key.
    expect(client.get).toHaveBeenCalledWith('pwdreset:email:an@example.test')
    expect(pipelineStub.set).toHaveBeenCalledWith(
      'pwdreset:hash-new',
      'u1',
      'EX',
      900,
    )
    expect(pipelineStub.set).toHaveBeenCalledWith(
      'pwdreset:email:an@example.test',
      'hash-new',
      'EX',
      900,
    )
  })

  it('cấp token mới thì token cũ bị xoá ngay', async () => {
    client.get.mockResolvedValueOnce('hash-old')

    await service.savePasswordResetToken('an@example.test', 'u1', 'hash-new')

    expect(pipelineStub.del).toHaveBeenCalledWith('pwdreset:hash-old')
  })

  it('chưa từng có token thì không gọi DEL thừa', async () => {
    client.get.mockResolvedValueOnce(null)

    await service.savePasswordResetToken('an@example.test', 'u1', 'hash-new')

    expect(pipelineStub.del).not.toHaveBeenCalled()
  })

  it('tiêu thụ token dùng GETDEL — đọc và xoá trong một lệnh', async () => {
    client.getdel.mockResolvedValueOnce('u1')

    await expect(service.consumePasswordResetToken('h')).resolves.toBe('u1')

    expect(client.getdel).toHaveBeenCalledWith('pwdreset:h')
    // Tách thành GET rồi DEL sẽ để hở khe cho hai request cùng đi qua.
    expect(client.get).not.toHaveBeenCalled()
    expect(client.del).not.toHaveBeenCalled()
  })

  it('peek chỉ đọc, không tiêu thụ token', async () => {
    client.get.mockResolvedValueOnce('u1')

    await expect(service.peekPasswordResetToken('h')).resolves.toBe('u1')

    expect(client.get).toHaveBeenCalledWith('pwdreset:h')
    expect(client.getdel).not.toHaveBeenCalled()
  })

  it('dọn chỉ mục ngược theo email đã chuẩn hoá', async () => {
    await service.clearPasswordResetIndex('  AN@Example.Test ')

    expect(client.del).toHaveBeenCalledWith('pwdreset:email:an@example.test')
  })

  it('cooldown theo email: lần đầu giành được, lần sau thua', async () => {
    client.set.mockResolvedValueOnce('OK')
    await expect(
      service.claimPasswordResetSlot('an@example.test'),
    ).resolves.toBe(true)
    expect(client.set).toHaveBeenCalledWith(
      'pwdreset:cooldown:an@example.test',
      '1',
      'EX',
      60,
      'NX',
    )

    client.set.mockResolvedValueOnce(null)
    await expect(
      service.claimPasswordResetSlot('an@example.test'),
    ).resolves.toBe(false)
  })

  it('hạn mức IP: đặt EXPIRE đúng một lần, ở lần đếm đầu tiên', async () => {
    client.incr.mockResolvedValueOnce(1)
    await expect(service.claimPasswordResetIpSlot('1.2.3.4')).resolves.toBe(
      true,
    )
    expect(client.expire).toHaveBeenCalledWith('pwdreset:ip:1.2.3.4', 3600)

    client.incr.mockResolvedValueOnce(2)
    await expect(service.claimPasswordResetIpSlot('1.2.3.4')).resolves.toBe(
      true,
    )
    expect(client.expire).toHaveBeenCalledTimes(1)
  })

  it('hạn mức IP: vượt 10 lần thì từ chối', async () => {
    client.incr.mockResolvedValueOnce(11)
    await expect(service.claimPasswordResetIpSlot('1.2.3.4')).resolves.toBe(
      false,
    )
  })

  it('trần theo giờ: đặt EXPIRE đúng một lần, ở lần đếm đầu tiên', async () => {
    client.incr.mockResolvedValueOnce(1)
    await expect(
      service.claimPasswordResetHourlySlot('an@example.test'),
    ).resolves.toBe(true)
    expect(client.expire).toHaveBeenCalledWith(
      'pwdreset:hourly:an@example.test',
      3600,
    )

    client.incr.mockResolvedValueOnce(2)
    await expect(
      service.claimPasswordResetHourlySlot('an@example.test'),
    ).resolves.toBe(true)
    // Đặt EXPIRE mỗi lần sẽ đẩy cửa sổ trượt mãi và bộ đếm không bao giờ reset
    // — trần sẽ im lặng không bao giờ kích hoạt.
    expect(client.expire).toHaveBeenCalledTimes(1)
  })

  it('trần theo email: đúng 5 lần trong một giờ thì vẫn cho qua', async () => {
    client.incr.mockResolvedValueOnce(5)
    await expect(
      service.claimPasswordResetHourlySlot('an@example.test'),
    ).resolves.toBe(true)
  })

  it('trần theo email: quá 5 lần trong một giờ thì từ chối', async () => {
    client.incr.mockResolvedValueOnce(6)
    await expect(
      service.claimPasswordResetHourlySlot('an@example.test'),
    ).resolves.toBe(false)
  })
})
