// realtimekit.service.spec.ts
import { RealtimeKitService } from './realtimekit.service'
import { RealtimeKitUnavailableError } from './realtimekit.service'
import {
  newCustomParticipantId,
  presetFor,
  userIdFromCustomId,
} from './realtimekit.types'

/** Redis giả đủ cho service: get/set (NX)/del. */
class MemRedis {
  m = new Map<string, string>()
  get(k: string) {
    return Promise.resolve(this.m.get(k) ?? null)
  }
  set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && this.m.has(k)) return Promise.resolve(null)
    this.m.set(k, v)
    return Promise.resolve('OK')
  }
  del(...keys: string[]) {
    let n = 0
    for (const k of keys) if (this.m.delete(k)) n++
    return Promise.resolve(n)
  }
}

const reply = (data: unknown, status = 200) => ({
  ok: status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify({ success: status < 300, data })),
})

describe('RealtimeKitService', () => {
  const OLD = process.env
  let redis: MemRedis
  let fetchMock: jest.Mock
  let svc: RealtimeKitService

  beforeEach(() => {
    process.env = {
      ...OLD,
      REALTIMEKIT_ACCOUNT_ID: 'acc',
      REALTIMEKIT_APP_ID: 'app',
      REALTIMEKIT_API_TOKEN: 'tok',
    }
    delete process.env.REALTIMEKIT_API_BASE
    redis = new MemRedis()
    fetchMock = jest.fn()
    svc = new RealtimeKitService(redis as never, fetchMock)
  })
  afterAll(() => {
    process.env = OLD
  })

  it('isConfigured cần đủ ba biến', () => {
    expect(svc.isConfigured()).toBe(true)
    delete process.env.REALTIMEKIT_API_TOKEN
    expect(svc.isConfigured()).toBe(false)
  })

  it('preset theo phạm vi + loại cuộc gọi; custom id = userId.hậu tố', () => {
    expect(presetFor('group', 'video')).toBe('daln_group_video')
    expect(presetFor('direct', 'audio')).toBe('daln_direct_audio')
    const id = newCustomParticipantId('64f0c0ffee')
    expect(id).toMatch(/^64f0c0ffee\.[0-9a-f]{8}$/)
    expect(userIdFromCustomId(id)).toBe('64f0c0ffee')
    expect(userIdFromCustomId(undefined)).toBe('')
  })

  it('tạo phòng một lần, dùng lại, ghi ánh xạ hai chiều', async () => {
    fetchMock.mockResolvedValueOnce(reply({ id: 'm1' }))

    expect(await svc.ensureMeeting('c1')).toBe('m1')
    expect(await svc.ensureMeeting('c1')).toBe('m1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/realtime/kit/app/meetings',
    )
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    )
    expect(JSON.parse(init.body as string)).toEqual({ title: 'conv_c1' })
    expect(await svc.conversationOfMeeting('m1')).toBe('c1')
  })

  it('tạo đồng thời: bên thua dùng phòng của bên thắng', async () => {
    fetchMock.mockImplementationOnce(async () => {
      await redis.set('rtk:meeting:c1', 'winner')
      return reply({ id: 'loser' })
    })

    expect(await svc.ensureMeeting('c1')).toBe('winner')
    expect(await svc.conversationOfMeeting('loser')).toBeNull()
  })

  it('addParticipant: trả token, custom id duy nhất, đúng preset', async () => {
    await redis.set('rtk:meeting:c1', 'm1')
    fetchMock.mockResolvedValueOnce(reply({ id: 'p1', token: 'jwt' }))

    const grant = await svc.addParticipant('c1', {
      userId: 'u1',
      name: 'An',
      preset: 'daln_direct_audio',
    })

    expect(grant).toEqual({
      meetingId: 'm1',
      participantId: 'p1',
      customParticipantId: expect.stringMatching(/^u1\.[0-9a-f]{8}$/),
      authToken: 'jwt',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/meetings\/m1\/participants$/)
    expect(JSON.parse(init.body as string)).toEqual({
      custom_participant_id: grant.customParticipantId,
      name: 'An',
      preset_name: 'daln_direct_audio',
    })
  })

  it('phòng không còn (404) -> tạo phòng mới rồi thử lại một lần', async () => {
    await redis.set('rtk:meeting:c1', 'dead')
    fetchMock
      .mockResolvedValueOnce(reply(null, 404))
      .mockResolvedValueOnce(reply({ id: 'm2' }))
      .mockResolvedValueOnce(reply({ id: 'p1', token: 'jwt' }))

    const grant = await svc.addParticipant('c1', {
      userId: 'u1',
      name: 'An',
      preset: 'daln_group_video',
    })

    expect(grant.meetingId).toBe('m2')
    expect(await redis.get('rtk:meeting:c1')).toBe('m2')
  })

  it.each([
    ['5xx', () => Promise.resolve(reply(null, 503))],
    ['401', () => Promise.resolve(reply(null, 401))],
    ['mạng', () => Promise.reject(new Error('ECONNRESET'))],
  ])('lỗi %s -> RealtimeKitUnavailableError', async (_label, impl) => {
    await redis.set('rtk:meeting:c1', 'm1')
    fetchMock.mockImplementation(impl)

    await expect(
      svc.addParticipant('c1', {
        userId: 'u1',
        name: 'An',
        preset: 'daln_direct_audio',
      }),
    ).rejects.toBeInstanceOf(RealtimeKitUnavailableError)
  })

  it('chưa cấu hình -> RealtimeKitUnavailableError, không gọi mạng', async () => {
    delete process.env.REALTIMEKIT_APP_ID
    await expect(svc.ensureMeeting('c1')).rejects.toBeInstanceOf(
      RealtimeKitUnavailableError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('quá 8 giây -> huỷ request, RealtimeKitUnavailableError', async () => {
    jest.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    )
    const pending = svc.ensureMeeting('c1')
    const assertion = expect(pending).rejects.toBeInstanceOf(
      RealtimeKitUnavailableError,
    )
    await jest.advanceTimersByTimeAsync(8000)
    await assertion
    jest.useRealTimers()
  })

  it('revoke: kick theo custom id rồi xoá từng người; lỗi không ném ra', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(null, 400))
      .mockResolvedValueOnce(reply({}))
      .mockRejectedValueOnce(new Error('boom'))

    await expect(
      svc.revoke([
        { meetingId: 'm1', participantId: 'p1', customParticipantId: 'u1.aa' },
        { meetingId: 'm1', participantId: 'p2', customParticipantId: 'u2.bb' },
      ]),
    ).resolves.toBeUndefined()

    const calls = fetchMock.mock.calls as [string, RequestInit][]
    expect(calls[0][0]).toMatch(/\/meetings\/m1\/active-session\/kick$/)
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      custom_participant_ids: ['u1.aa', 'u2.bb'],
    })
    expect(calls[1][1].method).toBe('DELETE')
    expect(calls[1][0]).toMatch(/\/meetings\/m1\/participants\/p1$/)
    expect(calls[2][0]).toMatch(/\/meetings\/m1\/participants\/p2$/)
  })

  it('revoke với danh sách rỗng không gọi mạng', async () => {
    await svc.revoke([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
