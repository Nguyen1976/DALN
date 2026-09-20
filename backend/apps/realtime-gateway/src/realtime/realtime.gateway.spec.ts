import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import type { Server } from 'socket.io'
import { EVENT_TYPE_HEADER, EVENT_VERSION_HEADER } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { CallAck, RealtimeGateway } from './realtime.gateway'
import { GroupCallStore, isGroupCallId } from './group-call.store'
import type { ClientSocket } from './socket.types'

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: 'REDIS_CLIENT', useValue: redisStub },
        { provide: AmqpConnection, useValue: amqpStub },
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
   * Các quy tắc gọi thoại đều là quy tắc phân quyền, và chúng không cần socket
   * thật để kiểm: gateway phải tự quyết ai là người nhận, và mọi sự kiện sau đó
   * phải khớp một phiên mà người gửi thuộc về.
   */
  describe('gọi thoại 1-1', () => {
    const CALL_ID = '11111111-2222-4333-8444-555555555555'

    const session = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        callId: CALL_ID,
        callerId: 'caller',
        calleeId: 'callee',
        conversationId: 'conv-1',
        status: 'ringing',
        callType: 'audio',
        startedAt: Date.now(),
        ...overrides,
      })

    // The client still sends who it wants to ring; the gateway must not care.
    const ringVictim = {
      conversationId: 'conv-1',
      offer: { sdp: 'x' },
      targetUserId: 'victim',
    }

    it('chat service từ chối (403) -> ack CALL_FORBIDDEN, không ai đổ chuông', async () => {
      respond(403)

      const ack = await gateway.handleIncomingCall(
        ringVictim,
        socketOf('stranger'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
      expect(emitted).not.toHaveBeenCalled()
      expect(redisStub.set).not.toHaveBeenCalled()
    })

    it('đổ chuông người nhận do chat service trả, bỏ qua targetUserId của client', async () => {
      respond(200, { peerId: 'callee' })

      const ack = expectOk(
        await gateway.handleIncomingCall(ringVictim, socketOf('caller')),
      )

      expect(to).toHaveBeenCalledWith('user:callee')
      expect(to).not.toHaveBeenCalledWith('user:victim')
      expect(emitted).toHaveBeenCalledWith(
        'call.incoming_call',
        expect.objectContaining({ callId: ack.callId, callerId: 'caller' }),
      )
    })

    it('người nhận đang bận -> CALLEE_BUSY, không đổ chuông', async () => {
      respond(200, { peerId: 'callee' })
      // acquire(caller) thắng SET NX; isBusy(callee) đọc thấy cuộc gọi khác.
      redisStub.get.mockResolvedValueOnce('another-call-id')

      const ack = await gateway.handleIncomingCall(
        { conversationId: 'conv-1', offer: { sdp: 'x' } },
        socketOf('caller'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALLEE_BUSY' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('người gọi đang bận -> BUSY, không tạo phiên', async () => {
      respond(200, { peerId: 'callee' })
      // acquire(caller): SET NX thất bại rồi GET thấy callId khác -> đang bận.
      redisStub.set.mockResolvedValueOnce(null)
      redisStub.get.mockResolvedValueOnce('another-call-id')

      const ack = await gateway.handleIncomingCall(
        { conversationId: 'conv-1', offer: { sdp: 'x' } },
        socketOf('caller'),
      )

      expect(ack).toEqual(expect.objectContaining({ ok: false, code: 'BUSY' }))
      expect(emitted).not.toHaveBeenCalled()
    })

    it('sự kiện mang callId không có phiên thì bị bỏ', async () => {
      redisStub.get.mockResolvedValueOnce(null)

      const ack = await gateway.handleIceCandidate(
        { callId: CALL_ID, candidate: { candidate: 'a' } },
        socketOf('caller'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_NOT_FOUND' }),
      )
      expect(emitted).not.toHaveBeenCalled()
    })

    it('người ngoài phiên không chen được vào cuộc gọi', async () => {
      redisStub.get.mockResolvedValueOnce(session())

      const ack = await gateway.handleIceCandidate(
        { callId: CALL_ID, candidate: { candidate: 'a' } },
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
        { callId: CALL_ID, answer: { sdp: 'y' } },
        socketOf('caller'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
    })

    it('kết thúc: ghi kết quả bằng conversationId của phiên, đúng một lần', async () => {
      const connectedAt = Date.now() - 42_000
      redisStub.get.mockResolvedValue(
        session({ status: 'connected', connectedAt }),
      )
      // end() nay xoá HAI key mỗi lần (call: + callaccept:). Lần kết thúc đầu: cả
      // hai trả 1 (session còn) -> ghi kết quả; lần thứ hai: 0 -> không ghi lại.
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
      // Bên kia cũng phát `call.ended` — lần này DEL trả 0 nên không ghi nữa.
      await gateway.handleCallEnded({ callId: CALL_ID }, socketOf('callee'))

      const calls = publishedTo(ROUTING_RMQ.CALL_ENDED)
      expect(calls).toHaveLength(1)
      expect(calls[0][2]).toEqual(
        expect.objectContaining({
          conversationId: 'conv-1',
          callerId: 'caller',
          calleeId: 'callee',
          outcome: 'COMPLETED',
          durationSeconds: 42,
        }),
      )
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
      process.env.LIVEKIT_URL = 'ws://localhost:7880'
      process.env.LIVEKIT_API_KEY = 'devkey'
      process.env.LIVEKIT_API_SECRET = 'a'.repeat(32)
      process.env.INTERNAL_API_TOKEN = 'test-token'
      process.env.CHAT_SERVICE_URL = 'http://chat:3003'

      // Store thật trên Redis giả: kiểm cả logic phiên chứ không chỉ handler.
      store = new GroupCallStore(new FakeRedis() as never)
      Object.assign(gateway, { groupCallStore: store })
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
        { conversationId: 'conv-1' },
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
        { conversationId: 'conv-1' },
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
          { conversationId: 'conv-1', callType: 'video' },
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
          { conversationId: 'conv-1', callType: 'audio' },
          socketOf('bob'),
        ),
      )
      expect(audioAck.callType).toBe('video')
    })

    it('được phép -> tạo phiên, đổ chuông thành viên khác, ack có token/room/url', async () => {
      respond(200, { members, type: 'GROUP' })

      const ack = expectOk(
        await gateway.handleGroupCallStart(
          { conversationId: 'conv-1' },
          socketOf('alice'),
        ),
      )

      expect(isGroupCallId(ack.callId)).toBe(true)
      expect(ack.roomName).toBe('conv_conv-1')
      expect(ack.url).toBe('ws://localhost:7880')
      expect(typeof ack.token).toBe('string')

      // Đổ chuông Bob, không tự đổ chuông người gọi (Alice).
      expect(to).toHaveBeenCalledWith('user:bob')
      expect(to).not.toHaveBeenCalledWith('user:alice')
      expect(emitted).toHaveBeenCalledWith(
        'group_call.incoming',
        expect.objectContaining({
          callId: ack.callId,
          conversationId: 'conv-1',
          roomName: 'conv_conv-1',
          from: { id: 'alice', username: 'Alice' },
        }),
      )
    })

    it('LiveKit chưa cấu hình -> ack LIVEKIT_UNCONFIGURED', async () => {
      delete process.env.LIVEKIT_API_SECRET
      respond(200, { members, type: 'GROUP' })

      const ack = await gateway.handleGroupCallStart(
        { conversationId: 'conv-1' },
        socketOf('alice'),
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'LIVEKIT_UNCONFIGURED' }),
      )
    })

    it('accept: thành viên -> cấp token; người ngoài -> NOT_MEMBER', async () => {
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })

      // accept giờ revalidate quyền hiện tại qua chat -> mock trả members.
      respond(200, { members, type: 'GROUP' })

      const ok = expectOk(
        await gateway.handleGroupCallAccept(
          { callId: created.callId },
          socketOf('bob'),
        ),
      )
      expect(typeof ok.token).toBe('string')
      expect(ok.url).toBe('ws://localhost:7880')

      const denied = await gateway.handleGroupCallAccept(
        { callId: created.callId },
        socketOf('stranger'),
      )
      expect(denied).toEqual(
        expect.objectContaining({ ok: false, code: 'NOT_MEMBER' }),
      )
    })

    it('webhook room_finished: ghi group-call-log, phát ended, xoá phiên', async () => {
      const created = await store.getOrCreate({
        conversationId: 'conv-1',
        startedBy: 'alice',
        members,
      })
      await store.addParticipant('conv-1', { id: 'alice', username: 'Alice' })
      await store.addParticipant('conv-1', { id: 'bob', username: 'Bob' })
      respond(200)

      await gateway.applyLivekitWebhook({
        event: 'room_finished',
        room: { name: 'conv_conv-1' },
      })

      const logCall = fetchMock.mock.calls.find(([url]) =>
        url.includes('/chat/internal/group-call-log'),
      )
      expect(logCall?.[1]?.method).toBe('POST')
      const body = JSON.parse(logCall?.[1]?.body as string) as Record<
        string,
        unknown
      >
      expect(body).toEqual(
        expect.objectContaining({
          conversationId: 'conv-1',
          participantCount: 2,
        }),
      )
      expect(typeof body.durationSeconds).toBe('number')

      expect(emitted).toHaveBeenCalledWith(
        'group_call.ended',
        expect.objectContaining({
          callId: created.callId,
          conversationId: 'conv-1',
        }),
      )
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
