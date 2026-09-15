import {
  buildGroupCallToken,
  getLivekitUrl,
  isLivekitConfigured,
} from './livekit-token'

/**
 * SFU chỉ tin đúng chữ ký + đúng grant: sai grant là join được nhưng câm (không
 * publish/subscribe được), hỏng lặng lẽ. Nên grant và định danh được ghim ở đây.
 */
describe('livekit-token', () => {
  const OLD_ENV = process.env

  const decode = (jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.LIVEKIT_URL
    delete process.env.LIVEKIT_API_KEY
    delete process.env.LIVEKIT_API_SECRET
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  const configure = () => {
    process.env.LIVEKIT_URL = 'ws://localhost:7880'
    process.env.LIVEKIT_API_KEY = 'devkey'
    process.env.LIVEKIT_API_SECRET = 'a'.repeat(32)
  }

  it('grant chỉ cho audio: publish + subscribe, chặn publishData, đúng phòng', async () => {
    configure()

    const jwt = await buildGroupCallToken({
      userId: 'user-1',
      username: 'Alice',
      roomName: 'conv_c1',
    })

    expect(jwt).toBeTruthy()
    const payload = decode(jwt as string)

    expect(payload.video).toEqual(
      expect.objectContaining({
        roomJoin: true,
        room: 'conv_c1',
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      }),
    )
    // identity = userId (webhook khớp lại đúng người), name = username hiển thị.
    expect(payload.sub).toBe('user-1')
    expect(payload.name).toBe('Alice')
    expect(payload.iss).toBe('devkey')
    // TTL ~10 phút.
    expect(payload.exp - payload.nbf).toBe(600)
  })

  it('thiếu API_KEY/SECRET/URL -> trả null (handler trả LIVEKIT_UNCONFIGURED)', async () => {
    expect(isLivekitConfigured()).toBe(false)
    expect(getLivekitUrl()).toBeNull()
    expect(
      await buildGroupCallToken({
        userId: 'user-1',
        username: 'Alice',
        roomName: 'conv_c1',
      }),
    ).toBeNull()

    // Có URL nhưng thiếu secret vẫn là chưa cấu hình.
    process.env.LIVEKIT_URL = 'ws://localhost:7880'
    process.env.LIVEKIT_API_KEY = 'devkey'
    expect(
      await buildGroupCallToken({
        userId: 'user-1',
        username: 'Alice',
        roomName: 'conv_c1',
      }),
    ).toBeNull()
  })

  it('getLivekitUrl trả đúng LIVEKIT_URL khi đã cấu hình', () => {
    configure()
    expect(getLivekitUrl()).toBe('ws://localhost:7880')
    expect(isLivekitConfigured()).toBe(true)
  })
})
