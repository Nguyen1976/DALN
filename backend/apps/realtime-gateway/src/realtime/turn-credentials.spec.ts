import { createHmac } from 'crypto'
import { buildIceConfig, buildTurnCredential } from './turn-credentials'

/**
 * Mật khẩu TURN được coturn kiểm lại bằng đúng công thức này, mà hai bên không
 * hề nói chuyện với nhau — sai một chi tiết là mọi cuộc gọi phải relay đều hỏng,
 * và hỏng lặng lẽ (trình duyệt chỉ báo ICE failed). Nên nó được ghim ở đây.
 */
describe('turn-credentials', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.TURN_SECRET
    delete process.env.TURN_URLS
    delete process.env.TURN_HOST
    delete process.env.TURN_TLS_HOST
    delete process.env.STUN_URLS
    delete process.env.TURN_CREDENTIAL_TTL_SECONDS
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it('credential là base64 của HMAC-SHA1(secret, username)', () => {
    const expected = createHmac('sha1', 'secret-abc')
      .update('1700000000:user-1')
      .digest('base64')

    expect(buildTurnCredential('secret-abc', '1700000000:user-1')).toBe(
      expected,
    )
  })

  it('username là "<hạn unix>:<userId>" và hạn bằng now + TTL', () => {
    process.env.TURN_SECRET = 'secret-abc'
    process.env.TURN_URLS = 'turn:1.2.3.4:3478?transport=udp'

    const nowMs = 1_700_000_000_000
    const config = buildIceConfig('user-1', nowMs)
    const turn = config.iceServers.find((server) => server.username)

    expect(config.expiresAt).toBe(1_700_000_000 + 3600)
    expect(turn?.username).toBe(`${1_700_000_000 + 3600}:user-1`)
    expect(turn?.credential).toBe(
      buildTurnCredential('secret-abc', `${1_700_000_000 + 3600}:user-1`),
    )
  })

  it('dựng đủ udp/tcp/tls khi chỉ khai báo host', () => {
    process.env.TURN_SECRET = 'secret-abc'
    process.env.TURN_HOST = '109.199.115.126'
    process.env.TURN_TLS_HOST = 'nguyen1976.xyz'

    const turn = buildIceConfig('user-1').iceServers.find(
      (server) => server.username,
    )

    expect(turn?.urls).toEqual([
      'turn:109.199.115.126:3478?transport=udp',
      'turn:109.199.115.126:3478?transport=tcp',
      'turns:nguyen1976.xyz:5349?transport=tcp',
    ])
  })

  it('chưa cấu hình TURN thì vẫn trả STUN, không kèm mật khẩu', () => {
    const config = buildIceConfig('user-1')

    expect(config.expiresAt).toBeNull()
    expect(config.iceServers.length).toBeGreaterThan(0)
    expect(config.iceServers.every((server) => !server.credential)).toBe(true)
  })

  it('không bao giờ để secret lọt vào cấu hình gửi xuống trình duyệt', () => {
    process.env.TURN_SECRET = 'secret-abc'
    process.env.TURN_URLS = 'turn:1.2.3.4:3478?transport=udp'

    expect(JSON.stringify(buildIceConfig('user-1'))).not.toContain('secret-abc')
  })
})
