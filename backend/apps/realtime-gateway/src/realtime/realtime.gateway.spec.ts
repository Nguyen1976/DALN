import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { SessionStore } from '@app/common'
import type { Server } from 'socket.io'
import { EVENT_TYPE_HEADER, EVENT_VERSION_HEADER } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { CallAck, RealtimeGateway } from './realtime.gateway'
import { GroupCallStore, isGroupCallId } from './group-call.store'
import type { ClientSocket } from './socket.types'
import { RealtimeKitService } from './realtimekit.service'

/**
 * Redis giả trong bộ nhớ, đủ cho GroupCallStore trong test gọi nhóm: string
 * (get/set với NX), hash (hset/hdel/hgetall), set (sadd/smembers), expire.
 */
class FakeRedis {
  private strings = new Map<string, string>()
  private hashes = new Map<string, Map<string, string>>()
  private sets = new Map<string, Set<string>>()

  get(key: string) {
    return Promise.resolve(this.strings.get(key) ?? null)
  }
  set(key: string, value: string, ...args: unknown[]) {
    const nx = args.some((a) => a === 'NX')
    if (nx && this.strings.has(key)) return Promise.resolve(null)
    this.strings.set(key, value)
    return Promise.resolve('OK')
  }
  del(...keys: string[]) {
    let removed = 0
    for (const key of keys) {
      if (this.strings.delete(key)) removed++
      this.hashes.delete(key)
      this.sets.delete(key)
    }
    return Promise.resolve(removed)
  }
  expire() {
    return Promise.resolve(1)
  }
  hset(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map<string, string>()
    hash.set(field, value)
    this.hashes.set(key, hash)
    return Promise.resolve(1)
  }
  hdel(key: string, field: string) {
    return Promise.resolve(this.hashes.get(key)?.delete(field) ? 1 : 0)
  }
  hgetall(key: string) {
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []))
  }
  sadd(key: string, member: string) {
    const set = this.sets.get(key) ?? new Set<string>()
    const had = set.has(member)
    set.add(member)
    this.sets.set(key, set)
    return Promise.resolve(had ? 0 : 1)
  }
  smembers(key: string) {
    return Promise.resolve(Array.from(this.sets.get(key) ?? []))
  }
}

/** A socket as the handlers see it: the authenticated user and `emit`. */
function socketOf(userId?: string, emit = jest.fn()): ClientSocket {
  return { data: { userId }, emit } as unknown as ClientSocket
}

/** The body of a successful ack; an error ack fails the test with its code. */
function expectOk(ack: CallAck) {
  if (!ack.ok) throw new Error(`${ack.code}: ${ack.message}`)
  return ack
}

/**
 * Smoke test: the gateway constructs against stubbed JWT, Redis and RabbitMQ.
 *
 * Also pins the rules that do not need a live socket to check — a client with
 * no authenticated user must not be able to publish a message, and what does
 * get published carries the event version header.
 */
describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway

  const amqpStub = {
    publish: jest
      .fn<Promise<boolean>, [string, string, unknown, unknown]>()
      .mockResolvedValue(true),
  }
  const redisStub = {
    smembers: jest.fn().mockResolvedValue([]),
    sadd: jest.fn(),
    srem: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
    pipeline: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  }

  /** Phiên còn sống hay không — handshake hỏi Redis qua đây. */
  const sessionStub = {
    isAlive: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true),
  }

  /** RealtimeKit giả: cấp grant kèm token, thu hồi ghi lại để kiểm. */
  let grantSeq = 0
  const rtkStub = {
    isConfigured: jest.fn(() => true),
    addParticipant: jest.fn(
      (conversationId: string, input: { userId: string }) => {
        grantSeq++
        return Promise.resolve({
          meetingId: `meeting-${conversationId}`,
          participantId: `p${grantSeq}`,
          customParticipantId: `${input.userId}.0000000${grantSeq}`,
          authToken: `token-${input.userId}`,
        })
      },
    ),
    revoke: jest.fn().mockResolvedValue(undefined),
    conversationOfMeeting: jest.fn(),
  }

  /** What the chat service answers, as `internalFetch` reads it. */
  const fetchMock = jest.fn<
    Promise<Pick<Response, 'ok' | 'status' | 'text'>>,
    [string, RequestInit?]
  >()
  const respond = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () =>
        Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
    })

  /** Every room the server emitted to, and what it emitted. */
  let to: jest.Mock
  let emitted: jest.Mock

  const publishedTo = (routingKey: string) =>
    amqpStub.publish.mock.calls.filter(([, key]) => key === routingKey)

  beforeEach(async () => {
    jest.clearAllMocks()
    rtkStub.isConfigured.mockReturnValue(true)
    // mockReset (không chỉ clear): xoá cả hàng đợi mockResolvedValueOnce mà một
    // test thoát sớm để lại, không thì nó rò sang test sau.
    redisStub.get.mockReset().mockResolvedValue(null)
    redisStub.set.mockReset().mockResolvedValue('OK')
    redisStub.del.mockReset().mockResolvedValue(1)
    redisStub.eval.mockReset().mockResolvedValue(1)
    rtkStub.addParticipant.mockClear()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: 'REDIS_CLIENT', useValue: redisStub },
        { provide: AmqpConnection, useValue: amqpStub },
        { provide: SessionStore, useValue: sessionStub },
        { provide: RealtimeKitService, useValue: rtkStub },
      ],
    }).compile()

    gateway = module.get<RealtimeGateway>(RealtimeGateway)

    emitted = jest.fn()
    to = jest.fn().mockReturnValue({ emit: emitted })
    gateway.server = { to } as unknown as Server
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.INTERNAL_API_TOKEN = 'test-token'
  })

  /**
   * Socket là kết nối dài hạn được xác thực MỘT LẦN lúc handshake, nên đây là
   * chỗ duy nhất chặn được kẻ mang token đã bị thu hồi — và cũng là chỗ dễ để
   * hở nhất: trước đây nó chấp nhận cả refresh token.
   */
  describe('handshake xác thực', () => {
    const jwtForTest = new JwtService({ secret: 'gw-test-secret' })

    const signAccess = (extra: Record<string, unknown> = {}) =>
      jwtForTest.sign(
        {
          userId: 'u1',
          email: 'e',
          username: 'u',
          sid: 's1',
          typ: 'at',
          ...extra,
        },
        { expiresIn: '15m' },
      )

    const fakeClient = (cookie?: string) =>
      ({
        id: 'sock-1',
        data: {} as Record<string, unknown>,
        handshake: { headers: { cookie } },
        join: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
        conn: { on: jest.fn() },
      }) as unknown as ClientSocket & { emit: jest.Mock; join: jest.Mock }

    const codeEmitted = (client: { emit: jest.Mock }): string | undefined => {
      const calls = client.emit.mock.calls as unknown as [
        string,
        { code?: string },
      ][]
      return calls.find(([event]) => event === 'auth:error')?.[1]?.code
    }

    beforeEach(() => {
      ;(
        gateway as unknown as { jwtService: { verify: jest.Mock } }
      ).jwtService.verify.mockImplementation((token: string): unknown =>
        jwtForTest.verify(token),
      )
      sessionStub.isAlive.mockResolvedValue(true)
    })

    it('access hợp lệ + phiên còn sống -> vào phòng và ghi nhớ sid', async () => {
      const client = fakeClient(`accessToken=${signAccess()}`)

      await gateway.handleConnection(client)

      expect(sessionStub.isAlive).toHaveBeenCalledWith('s1')
      expect(client.join).toHaveBeenCalledWith('user:u1')
      expect(client.data.userId).toBe('u1')
      expect(client.data.sid).toBe('s1')
      expect(codeEmitted(client)).toBeUndefined()
    })

    // Hồi quy quan trọng nhất của thay đổi này: refresh token KHÔNG còn xác
    // thực được socket. Trước đây nó làm được, và cookie của nó còn được gửi
    // kèm cả handshake.
    it('chỉ có refresh cookie -> từ chối ACCESS_TOKEN_MISSING', async () => {
      const client = fakeClient('refreshToken=s1.verifier')

      await gateway.handleConnection(client)

      expect(codeEmitted(client)).toBe('ACCESS_TOKEN_MISSING')
      expect(client.join).not.toHaveBeenCalled()
      expect(sessionStub.isAlive).not.toHaveBeenCalled()
    })

    it('không có cookie nào -> ACCESS_TOKEN_MISSING', async () => {
      const client = fakeClient(undefined)
      await gateway.handleConnection(client)
      expect(codeEmitted(client)).toBe('ACCESS_TOKEN_MISSING')
    })

    it('access hết hạn -> ACCESS_TOKEN_EXPIRED (client tự refresh rồi nối lại)', async () => {
      const expired = jwtForTest.sign({
        userId: 'u1',
        sid: 's1',
        typ: 'at',
        exp: Math.floor(Date.now() / 1000) - 60,
      })
      const client = fakeClient(`accessToken=${expired}`)

      await gateway.handleConnection(client)

      expect(codeEmitted(client)).toBe('ACCESS_TOKEN_EXPIRED')
    })

    it('token thiếu sid -> TOKEN_INVALID', async () => {
      const legacy = jwtForTest.sign(
        { userId: 'u1', email: 'e', username: 'u', typ: 'at' },
        { expiresIn: '15m' },
      )
      const client = fakeClient(`accessToken=${legacy}`)

      await gateway.handleConnection(client)

      expect(codeEmitted(client)).toBe('TOKEN_INVALID')
    })

    it('phiên đã bị thu hồi -> SESSION_REVOKED dù token còn hạn', async () => {
      sessionStub.isAlive.mockResolvedValue(false)
      const client = fakeClient(`accessToken=${signAccess()}`)

      await gateway.handleConnection(client)

      expect(codeEmitted(client)).toBe('SESSION_REVOKED')
      expect(client.join).not.toHaveBeenCalled()
    })

    it('không kiểm tra được phiên -> SESSION_CHECK_UNAVAILABLE, fail-closed', async () => {
      sessionStub.isAlive.mockRejectedValue(new Error('ECONNREFUSED'))
      const client = fakeClient(`accessToken=${signAccess()}`)

      await gateway.handleConnection(client)

      expect(codeEmitted(client)).toBe('SESSION_CHECK_UNAVAILABLE')
      expect(client.join).not.toHaveBeenCalled()
    })
  })

  describe('thu hồi phiên -> ngắt socket', () => {
    const socketFor = (sid?: string) => ({
      data: sid ? { sid } : {},
      emit: jest.fn(),
      disconnect: jest.fn(),
    })

    const withSockets = (sockets: unknown[]) => {
      const fetchSockets = jest.fn().mockResolvedValue(sockets)
      const inRoom = jest.fn().mockReturnValue({ fetchSockets })
      gateway.server = { to, in: inRoom } as unknown as Server
      return { fetchSockets, inRoom }
    }

    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('chỉ ngắt socket thuộc sid bị thu hồi', async () => {
      const revoked = socketFor('s1')
      const other = socketFor('s2')
      withSockets([revoked, other])

      await gateway.handleSessionRevoked({
        userId: 'u1',
        sids: ['s1'],
        reason: 'logout',
      })
      jest.advanceTimersByTime(100)

      expect(revoked.emit).toHaveBeenCalledWith('auth:error', {
        code: 'SESSION_REVOKED',
      })
      expect(revoked.disconnect).toHaveBeenCalledWith(true)
      // Đăng xuất một thiết bị không được đá thiết bị khác của cùng người.
      expect(other.emit).not.toHaveBeenCalled()
      expect(other.disconnect).not.toHaveBeenCalled()
    })

    it('thu hồi nhiều sid cùng lúc (đổi mật khẩu) -> ngắt hết', async () => {
      const a = socketFor('s1')
      const b = socketFor('s2')
      withSockets([a, b])

      await gateway.handleSessionRevoked({
        userId: 'u1',
        sids: ['s1', 's2'],
        reason: 'password-changed',
      })
      jest.advanceTimersByTime(100)

      expect(a.disconnect).toHaveBeenCalled()
      expect(b.disconnect).toHaveBeenCalled()
    })

    it('socket không có sid (bản trước khi deploy) -> vẫn ngắt', async () => {
      const legacy = socketFor(undefined)
      withSockets([legacy])

      await gateway.handleSessionRevoked({
        userId: 'u1',
        sids: ['s1'],
        reason: 'logout',
      })
      jest.advanceTimersByTime(100)

      expect(legacy.disconnect).toHaveBeenCalled()
    })

    it('chỉ hỏi phòng của đúng user đó', async () => {
      const { inRoom } = withSockets([])

      await gateway.handleSessionRevoked({
        userId: 'u9',
        sids: ['s1'],
        reason: 'logout-all',
      })

      expect(inRoom).toHaveBeenCalledWith('user:u9')
    })
  })

  /**
   * Các quy tắc gọi thoại đều là quy tắc phân quyền, và chúng không cần socket
   * thật để kiểm: gateway phải tự quyết ai là người nhận, và mọi sự kiện sau đó
   * phải khớp một phiên mà người gửi thuộc về.
   */
  describe('gọi thoại 1-1', () => {
    const CALL_ID = '11111111-2222-4333-8444-555555555555'
    const GRANT = {
      meetingId: 'meeting-conv-1',
      participantId: 'p0',
      customParticipantId: 'caller.00000000',
    }

    const session = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        callId: CALL_ID,
        callerId: 'caller',
        calleeId: 'callee',
        conversationId: 'conv-1',
        status: 'ringing',
        callType: 'audio',
        startedAt: Date.now(),
        rtkGrants: [GRANT],
        ...overrides,
      })

    const start = { v: 2, conversationId: 'conv-1', callType: 'video' }
    // Client vẫn khai người nhận; gateway không được tin (biến riêng để tránh
    // excess-property check của object literal).
    const startWithVictim = { ...start, targetUserId: 'victim' }

    /** Socket bắt máy: cần `broadcast` để báo các tab khác đóng chuông. */
    const acceptingSocket = (userId: string) =>
      ({
        id: 'sock-1',
        data: { userId },
        emit: jest.fn(),
        broadcast: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
      }) as unknown as ClientSocket

    it('client cũ (có offer hoặc thiếu v) -> CLIENT_OUTDATED, không gọi chat', async () => {
      for (const body of [
        { conversationId: 'conv-1', offer: { sdp: 'x' } },
        { v: 2, conversationId: 'conv-1', offer: { sdp: 'x' } },
        { conversationId: 'conv-1' },
      ]) {
        const ack = await gateway.handleIncomingCall(body, socketOf('caller'))
        expect(ack).toEqual(
          expect.objectContaining({ ok: false, code: 'CLIENT_OUTDATED' }),
        )
      }
      expect(fetchMock).not.toHaveBeenCalled()
      const accepted = await gateway.handleCallAccepted(
        { callId: CALL_ID, answer: { sdp: 'y' } },
        socketOf('callee'),
      )
      expect(accepted).toEqual(
        expect.objectContaining({ ok: false, code: 'CLIENT_OUTDATED' }),
      )
    })

    it('chat service từ chối (403) -> ack CALL_FORBIDDEN, không ai đổ chuông', async () => {
      respond(403)

      const ack = await gateway.handleIncomingCall(
        startWithVictim,
        socketOf('stranger'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
      expect(emitted).not.toHaveBeenCalled()
      expect(rtkStub.addParticipant).not.toHaveBeenCalled()
    })

    it('đổ chuông đúng người nhận, không kèm SDP; ack trả authToken của người gọi', async () => {
      respond(200, { peerId: 'callee' })

      const ack = expectOk(
        await gateway.handleIncomingCall(startWithVictim, socketOf('caller')),
      )

      expect(ack.authToken).toBe('token-caller')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'caller',
        name: 'caller',
        preset: 'daln_direct_video',
      })
      expect(to).toHaveBeenCalledWith('user:callee')
      expect(to).not.toHaveBeenCalledWith('user:victim')
      expect(emitted).toHaveBeenCalledWith('call.incoming_call', {
        callId: ack.callId,
        callerId: 'caller',
        conversationId: 'conv-1',
        callType: 'video',
      })
      // Phiên lưu grant để thu hồi sau, KHÔNG lưu token.
      const setCalls = redisStub.set.mock.calls as unknown as [string, string][]
      const stored = setCalls.find(([key]) => key.startsWith('call:'))
      expect(stored?.[1]).toContain('"customParticipantId"')
      expect(stored?.[1]).not.toContain('token-caller')
    })

    it('chưa cấu hình RealtimeKit -> MEDIA_UNCONFIGURED', async () => {
      rtkStub.isConfigured.mockReturnValue(false)
      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))
      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNCONFIGURED' }),
      )
    })

    it('API media lỗi khi gọi -> MEDIA_UNAVAILABLE, nhả khoá bận, không đổ chuông', async () => {
      respond(200, { peerId: 'callee' })
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(emitted).not.toHaveBeenCalled()
      // release() của CallBusyStore là Lua compare-and-DEL.
      expect(redisStub.eval).toHaveBeenCalled()
    })

    it('người nhận đang bận -> CALLEE_BUSY, không cấp media', async () => {
      respond(200, { peerId: 'callee' })
      redisStub.get.mockResolvedValueOnce('another-call-id')

      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALLEE_BUSY' }),
      )
      expect(rtkStub.addParticipant).not.toHaveBeenCalled()
    })

    it('người gọi đang bận -> BUSY, không tạo phiên', async () => {
      respond(200, { peerId: 'callee' })
      redisStub.set.mockResolvedValueOnce(null)
      redisStub.get.mockResolvedValueOnce('another-call-id')

      const ack = await gateway.handleIncomingCall(start, socketOf('caller'))

      expect(ack).toEqual(expect.objectContaining({ ok: false, code: 'BUSY' }))
      expect(emitted).not.toHaveBeenCalled()
    })

    it('sự kiện mang callId không có phiên thì bị bỏ', async () => {
      redisStub.get.mockResolvedValueOnce(null)

      const ack = await gateway.handleCallRejected(
        { callId: CALL_ID },
        socketOf('callee'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_NOT_FOUND' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('người ngoài phiên không chen được vào cuộc gọi', async () => {
      redisStub.get.mockResolvedValueOnce(session())

      const ack = await gateway.handleCallEnded(
        { callId: CALL_ID },
        socketOf('stranger'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('chỉ người được gọi mới nghe máy được', async () => {
      redisStub.get.mockResolvedValueOnce(session())

      const ack = await gateway.handleCallAccepted(
        { v: 2, callId: CALL_ID },
        socketOf('caller'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
    })

    it('nghe máy: cấp media cho người nhận, lưu cả hai grant, báo người gọi không kèm SDP', async () => {
      redisStub.get.mockResolvedValue(session())

      const ack = expectOk(
        await gateway.handleCallAccepted(
          { v: 2, callId: CALL_ID },
          acceptingSocket('callee'),
        ),
      )

      expect(ack.authToken).toBe('token-callee')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'callee',
        name: 'callee',
        preset: 'daln_direct_audio',
      })
      expect(emitted).toHaveBeenCalledWith('call.accepted', {
        callId: CALL_ID,
        answererId: 'callee',
      })
      const setCalls = redisStub.set.mock.calls as unknown as [string, string][]
      const connected = setCalls
        .filter(([key]) => key === `call:${CALL_ID}`)
        .pop()
      const saved = JSON.parse(String(connected?.[1])) as {
        rtkGrants: unknown[]
      }
      expect(saved.rtkGrants).toHaveLength(2)
    })

    it('API media lỗi khi nghe máy -> MEDIA_UNAVAILABLE, nhả khoá bận và claim', async () => {
      redisStub.get.mockResolvedValue(session())
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleCallAccepted(
        { v: 2, callId: CALL_ID },
        socketOf('callee'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(redisStub.del).toHaveBeenCalledWith(`callaccept:${CALL_ID}`)
      expect(emitted).not.toHaveBeenCalledWith(
        'call.accepted',
        expect.anything(),
      )
    })

    it('kết thúc: ghi kết quả đúng một lần và thu hồi media đúng một lần', async () => {
      const connectedAt = Date.now() - 42_000
      redisStub.get.mockResolvedValue(
        session({ status: 'connected', connectedAt }),
      )
      redisStub.del
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)

      // Client gửi kèm hội thoại và thời lượng tự bịa: phải bị bỏ qua.
      const forged = {
        callId: CALL_ID,
        conversationId: 'conv-KHAC',
        durationSeconds: 9999,
      }
      await gateway.handleCallEnded(forged, socketOf('caller'))
      await gateway.handleCallEnded({ callId: CALL_ID }, socketOf('callee'))

      const calls = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(calls).toHaveLength(1)
      expect(calls[0][2]).toEqual(
        expect.objectContaining({
          conversationId: 'conv-1',
          outcome: 'COMPLETED',
          durationSeconds: 42,
        }),
      )
      expect(rtkStub.revoke).toHaveBeenCalledTimes(1)
      expect(rtkStub.revoke).toHaveBeenCalledWith([GRANT])
    })

    it('từ chối: báo người gọi, ghi REJECTED, thu hồi media', async () => {
      redisStub.get.mockResolvedValue(session())
      redisStub.del.mockResolvedValueOnce(1)

      await gateway.handleCallRejected({ callId: CALL_ID }, socketOf('callee'))

      const [[, , payload]] = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(payload).toEqual(expect.objectContaining({ outcome: 'REJECTED' }))
      expect(rtkStub.revoke).toHaveBeenCalledWith([GRANT])
    })

    it('huỷ lúc đang đổ chuông là cuộc gọi nhỡ, không phải hoàn tất 0 giây', async () => {
      redisStub.get.mockResolvedValue(session())
      redisStub.del.mockResolvedValueOnce(1)

      await gateway.handleCallEnded({ callId: CALL_ID }, socketOf('caller'))

      const [[, , payload]] = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(payload).toEqual(expect.objectContaining({ outcome: 'MISSED' }))
    })

    it('lý do unreachable được ghi lại để hiện "không kết nối được"', async () => {
      redisStub.get.mockResolvedValue(session())
      redisStub.del.mockResolvedValueOnce(1)

      await gateway.handleCallEnded(
        { callId: CALL_ID, reason: 'unreachable' },
        socketOf('caller'),
      )

      const [[, , payload]] = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(payload).toEqual(
        expect.objectContaining({ outcome: 'UNREACHABLE' }),
      )
    })
  })

  /**
   * Gọi nhóm khác 1-1 về bản chất: gateway chỉ phân quyền + ký token, không
   * chuyển tiếp SDP. Ghim ba chốt: từ chối khi chat trả 403, đổ chuông đúng
   * người khi được phép, và webhook room_finished ghi log + đóng phiên.
   */
  describe('gọi nhóm', () => {
    const OLD_ENV = process.env
    let store: GroupCallStore

    beforeEach(() => {
      process.env = { ...OLD_ENV }
      process.env.INTERNAL_API_TOKEN = 'test-token'
      process.env.CHAT_SERVICE_URL = 'http://chat:3003'

      // Store thật trên Redis giả: kiểm cả logic phiên chứ không chỉ handler.
      store = new GroupCallStore(new FakeRedis() as never)
      Object.assign(gateway, { groupCallStore: store })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    afterAll(() => {
      process.env = OLD_ENV
    })

    const members = [
      { id: 'alice', username: 'Alice' },
      { id: 'bob', username: 'Bob' },
    ]

    it('chat trả 403 -> ack NOT_MEMBER, không ai đổ chuông', async () => {
      respond(403)

      const ack = await gateway.handleGroupCallStart(
        { v: 2, conversationId: 'conv-1' },
        socketOf('stranger'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'NOT_MEMBER' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('fail-closed: chat trả thành viên nhưng type khác GROUP -> NOT_GROUP', async () => {
      // Client tự gửi group_call.start cho hội thoại DIRECT: dù có thành viên
      // hợp lệ, thiếu type=GROUP thì không được cấp phòng nữa.
      respond(200, { members, type: 'DIRECT' })

      const ack = await gateway.handleGroupCallStart(
        { v: 2, conversationId: 'conv-1' },
        socketOf('alice'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'NOT_GROUP' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('callType video: lưu vào phiên, đi kèm chuông và ack', async () => {
      respond(200, { members, type: 'GROUP' })

      const ack = expectOk(
        await gateway.handleGroupCallStart(
          { v: 2, conversationId: 'conv-1', callType: 'video' },
          socketOf('alice'),
        ),
      )

      expect(ack.callType).toBe('video')
      expect(emitted).toHaveBeenCalledWith(
        'group_call.incoming',
        expect.objectContaining({ callType: 'video' }),
      )
      // Phòng đã mở giữ callType: bấm audio sau đó vẫn vào phòng video.
      const audioAck = expectOk(
        await gateway.handleGroupCallStart(
          { v: 2, conversationId: 'conv-1', callType: 'audio' },
          socketOf('bob'),
        ),
      )
      expect(audioAck.callType).toBe('video')
    })

    const rtkEvent = (
      event: string,
      userId?: string,
    ): { event: string; meetingId: string; customParticipantId?: string } => ({
      event,
      meetingId: 'meeting-conv-1',
      ...(userId ? { customParticipantId: `${userId}.0a0b0c0d` } : {}),
    })

    beforeEach(() => {
      rtkStub.conversationOfMeeting.mockImplementation((meetingId: string) =>
        Promise.resolve(meetingId === 'meeting-conv-1' ? 'conv-1' : null),
      )
    })

    it('client cũ -> CLIENT_OUTDATED', async () => {
      const ack = await gateway.handleGroupCallStart(
        { conversationId: 'conv-1' },
        socketOf('alice'),
      )
      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CLIENT_OUTDATED' }),
      )
    })

    it('được phép -> tạo phiên, đổ chuông, ack có authToken, lưu grant', async () => {
      respond(200, { members, type: 'GROUP' })

      const ack = expectOk(
        await gateway.handleGroupCallStart(
          { v: 2, conversationId: 'conv-1' },
          socketOf('alice'),
        ),
      )

      expect(isGroupCallId(ack.callId)).toBe(true)
      expect(ack.roomName).toBe('conv_conv-1')
      expect(ack.authToken).toBe('token-alice')
      expect(ack).not.toHaveProperty('url')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'alice',
        name: 'Alice',
        preset: 'daln_group_audio',
      })
      expect(
        (await store.getByConversationId('conv-1'))?.rtkGrants,
      ).toHaveLength(1)
      expect(to).toHaveBeenCalledWith('user:bob')
      expect(to).not.toHaveBeenCalledWith('user:alice')
    })

    it('RealtimeKit chưa cấu hình -> MEDIA_UNCONFIGURED', async () => {
      rtkStub.isConfigured.mockReturnValue(false)
      respond(200, { members, type: 'GROUP' })

      const ack = await gateway.handleGroupCallStart(
        { v: 2, conversationId: 'conv-1' },
        socketOf('alice'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNCONFIGURED' }),
      )
    })

    it('API media lỗi khi mở phòng -> MEDIA_UNAVAILABLE, không đổ chuông', async () => {
      respond(200, { members, type: 'GROUP' })
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleGroupCallStart(
        { v: 2, conversationId: 'conv-1' },
        socketOf('alice'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(emitted).not.toHaveBeenCalledWith(
        'group_call.incoming',
        expect.anything(),
      )
    })

    it('accept: thành viên -> authToken theo preset của phòng; người ngoài -> NOT_MEMBER', async () => {
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
        callType: 'video',
      })
      respond(200, { members, type: 'GROUP' })

      const ok = expectOk(
        await gateway.handleGroupCallAccept(
          { v: 2, callId: created.callId },
          socketOf('bob'),
        ),
      )
      expect(ok.authToken).toBe('token-bob')
      expect(rtkStub.addParticipant).toHaveBeenCalledWith('conv-1', {
        userId: 'bob',
        name: 'Bob',
        preset: 'daln_group_video',
      })

      const denied = await gateway.handleGroupCallAccept(
        { v: 2, callId: created.callId },
        socketOf('stranger'),
      )
      expect(denied).toEqual(
        expect.objectContaining({ ok: false, code: 'NOT_MEMBER' }),
      )
    })

    it('API media lỗi khi accept -> MEDIA_UNAVAILABLE và nhả khoá bận', async () => {
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      respond(200, { members, type: 'GROUP' })
      rtkStub.addParticipant.mockRejectedValueOnce(new Error('down'))

      const ack = await gateway.handleGroupCallAccept(
        { v: 2, callId: created.callId },
        socketOf('bob'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'MEDIA_UNAVAILABLE' }),
      )
      expect(redisStub.eval).toHaveBeenCalled()
    })

    it('webhook participantJoined: vào roster, phát state; người ngoài danh sách bị bỏ qua', async () => {
      await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })

      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantJoined', 'bob'),
      )
      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantJoined', 'mallory'),
      )

      const session = await store.getByConversationId('conv-1')
      expect(Object.keys(session?.participants ?? {})).toEqual(['bob'])
      expect(emitted).toHaveBeenCalledWith(
        'group_call.state',
        expect.objectContaining({
          participants: [{ id: 'bob', username: 'Bob' }],
        }),
      )
    })

    it('webhook của phòng lạ hoặc phòng 1-1 thì bỏ qua', async () => {
      await gateway.applyRtkWebhook({
        event: 'meeting.participantJoined',
        meetingId: 'meeting-khac',
        customParticipantId: 'bob.00000001',
      })
      expect(emitted).not.toHaveBeenCalled()
    })

    it('người cuối rời -> 15 giây sau: ghi log, phát ended, thu hồi media, đúng một lần', async () => {
      jest.useFakeTimers()
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      const grant = {
        meetingId: 'meeting-conv-1',
        participantId: 'p9',
        customParticipantId: 'alice.0a0b0c0d',
      }
      await store.addGrant('conv-1', grant)
      respond(200)

      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantJoined', 'alice'),
      )
      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantJoined', 'bob'),
      )
      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantLeft', 'alice'),
      )
      await gateway.applyRtkWebhook(rtkEvent('meeting.participantLeft', 'bob'))

      // Chưa hết 15 giây: phòng còn.
      await jest.advanceTimersByTimeAsync(14_000)
      expect(await store.getByConversationId('conv-1')).not.toBeNull()

      await jest.advanceTimersByTimeAsync(1_000)
      expect(await store.getByConversationId('conv-1')).toBeNull()

      const logCalls = fetchMock.mock.calls.filter(([url]) =>
        url.includes('/chat/internal/group-call-log'),
      )
      expect(logCalls).toHaveLength(1)
      const body = JSON.parse(logCalls[0][1]?.body as string) as Record<
        string,
        unknown
      >
      expect(body).toEqual(
        expect.objectContaining({
          conversationId: 'conv-1',
          participantCount: 2,
        }),
      )
      expect(emitted).toHaveBeenCalledWith(
        'group_call.ended',
        expect.objectContaining({
          callId: created.callId,
          conversationId: 'conv-1',
        }),
      )
      expect(rtkStub.revoke).toHaveBeenCalledWith([grant])

      // meeting.ended tới muộn: finish đã chạy -> không ghi log lần hai.
      await gateway.applyRtkWebhook(rtkEvent('meeting.ended'))
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          url.includes('/chat/internal/group-call-log'),
        ),
      ).toHaveLength(1)
    })

    it('rời rồi vào lại trong 15 giây -> không kết thúc', async () => {
      jest.useFakeTimers()
      await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })

      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantJoined', 'alice'),
      )
      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantLeft', 'alice'),
      )
      await jest.advanceTimersByTimeAsync(5_000)
      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantJoined', 'alice'),
      )
      await jest.advanceTimersByTimeAsync(20_000)

      expect(await store.getByConversationId('conv-1')).not.toBeNull()
    })

    it('meeting.ended kết thúc ngay', async () => {
      await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      respond(200)

      await gateway.applyRtkWebhook(rtkEvent('meeting.ended'))

      expect(await store.getByConversationId('conv-1')).toBeNull()
      expect(emitted).toHaveBeenCalledWith(
        'group_call.ended',
        expect.anything(),
      )
    })

    it('group_call.leave của người cuối cũng khởi động bộ đếm 15 giây', async () => {
      jest.useFakeTimers()
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      respond(200)
      await gateway.applyRtkWebhook(
        rtkEvent('meeting.participantJoined', 'alice'),
      )

      await gateway.handleGroupCallLeave(
        { callId: created.callId },
        socketOf('alice'),
      )
      await jest.advanceTimersByTimeAsync(15_000)

      expect(await store.getByConversationId('conv-1')).toBeNull()
    })
  })

  it('khởi tạo được', () => {
    expect(gateway).toBeDefined()
  })

  it('không cho gửi tin nhắn khi socket chưa xác thực', () => {
    const emit = jest.fn()

    gateway.handleCreateMessage(
      { conversationId: 'c1', clientMessageId: 'tmp-1', content: 'xin chao' },
      socketOf(undefined, emit),
    )

    expect(amqpStub.publish).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      expect.stringContaining('error'),
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('socket đã xác thực -> publish SEND_MESSAGE kèm header version, body giữ nguyên', () => {
    gateway.handleCreateMessage(
      { conversationId: 'c1', clientMessageId: 'tmp-1', content: 'xin chao' },
      socketOf('u1'),
    )

    expect(amqpStub.publish).toHaveBeenCalledWith(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.SEND_MESSAGE,
      expect.objectContaining({
        conversationId: 'c1',
        senderId: 'u1',
        content: 'xin chao',
        clientMessageId: 'tmp-1',
      }),
      expect.objectContaining({
        persistent: true,
        headers: {
          [EVENT_VERSION_HEADER]: 1,
          [EVENT_TYPE_HEADER]: ROUTING_RMQ.SEND_MESSAGE,
        },
      }),
    )
  })
})
