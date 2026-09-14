import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { EVENT_TYPE_HEADER, EVENT_VERSION_HEADER } from '@app/common/rmq'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import { ROUTING_RMQ } from 'libs/constant/rmq/routing'
import { RealtimeGateway } from './realtime.gateway'

/**
 * Smoke test: the gateway constructs against stubbed JWT, Redis and RabbitMQ.
 *
 * Also pins the rules that do not need a live socket to check — a client with
 * no authenticated user must not be able to publish a message, and what does
 * get published carries the event version header.
 */
describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway

  const amqpStub = { publish: jest.fn() }
  const redisStub = {
    smembers: jest.fn().mockResolvedValue([]),
    sadd: jest.fn(),
    srem: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  }

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
  })

  /**
   * Các quy tắc gọi thoại đều là quy tắc phân quyền, và chúng không cần socket
   * thật để kiểm: gateway phải tự quyết ai là người nhận, và mọi sự kiện sau đó
   * phải khớp một phiên mà người gửi thuộc về.
   */
  describe('gọi thoại 1-1', () => {
    const CALL_ID = '11111111-2222-4333-8444-555555555555'
    let emitted: jest.Mock

    const session = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        callId: CALL_ID,
        callerId: 'caller',
        calleeId: 'callee',
        conversationId: 'conv-1',
        status: 'ringing',
        startedAt: Date.now(),
        ...overrides,
      })

    beforeEach(() => {
      emitted = jest.fn()
      gateway.server = { to: jest.fn().mockReturnValue({ emit: emitted }) } as any
      global.fetch = jest.fn()
      process.env.INTERNAL_API_TOKEN = 'test-token'
    })

    it('chat service từ chối (403) -> ack CALL_FORBIDDEN, không ai đổ chuông', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 })

      const ack = await gateway.handleIncomingCall(
        { conversationId: 'conv-1', offer: { sdp: 'x' }, targetUserId: 'victim' },
        { data: { userId: 'stranger' }, emit: jest.fn() } as any,
      )

      expect(ack).toEqual(
        expect.objectContaining({ ok: false, code: 'CALL_FORBIDDEN' }),
      )
      expect(emitted).not.toHaveBeenCalled()
      expect(redisStub.set).not.toHaveBeenCalled()
    })

    it('đổ chuông người nhận do chat service trả, bỏ qua targetUserId của client', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { peerId: 'callee' } }),
      })

      const ack: any = await gateway.handleIncomingCall(
        { conversationId: 'conv-1', offer: { sdp: 'x' }, targetUserId: 'victim' },
        { data: { userId: 'caller' }, emit: jest.fn() } as any,
      )

      expect(ack.ok).toBe(true)
      expect(gateway.server.to).toHaveBeenCalledWith('user:callee')
      expect(gateway.server.to).not.toHaveBeenCalledWith('user:victim')
      expect(emitted).toHaveBeenCalledWith(
        'call.incoming_call',
        expect.objectContaining({ callId: ack.callId, callerId: 'caller' }),
      )
    })

    it('sự kiện mang callId không có phiên thì bị bỏ', async () => {
      redisStub.get.mockResolvedValueOnce(null)

      const ack = await gateway.handleIceCandidate(
        { callId: CALL_ID, candidate: { candidate: 'a' } },
        { data: { userId: 'caller' }, emit: jest.fn() } as any,
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
        { data: { userId: 'stranger' }, emit: jest.fn() } as any,
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
        { data: { userId: 'caller' }, emit: jest.fn() } as any,
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
      redisStub.del.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

      await gateway.handleCallEnded(
        { callId: CALL_ID, conversationId: 'conv-KHAC', durationSeconds: 9999 },
        { data: { userId: 'caller' }, emit: jest.fn() } as any,
      )
      // Bên kia cũng phát `call.ended` — lần này DEL trả 0 nên không ghi nữa.
      await gateway.handleCallEnded(
        { callId: CALL_ID },
        { data: { userId: 'callee' }, emit: jest.fn() } as any,
      )

      const calls = amqpStub.publish.mock.calls.filter(
        ([, routingKey]) => routingKey === ROUTING_RMQ.CALL_ENDED,
      )
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

      await gateway.handleCallEnded(
        { callId: CALL_ID },
        { data: { userId: 'caller' }, emit: jest.fn() } as any,
      )

      const [, , payload] = amqpStub.publish.mock.calls.find(
        ([, routingKey]) => routingKey === ROUTING_RMQ.CALL_ENDED,
      )!
      expect(payload).toEqual(expect.objectContaining({ outcome: 'MISSED' }))
    })

    it('lý do unreachable được ghi lại để hiện "không kết nối được"', async () => {
      redisStub.get.mockResolvedValue(session())
      redisStub.del.mockResolvedValueOnce(1)

      await gateway.handleCallEnded(
        { callId: CALL_ID, reason: 'unreachable' },
        { data: { userId: 'caller' }, emit: jest.fn() } as any,
      )

      const [, , payload] = amqpStub.publish.mock.calls.find(
        ([, routingKey]) => routingKey === ROUTING_RMQ.CALL_ENDED,
      )!
      expect(payload).toEqual(
        expect.objectContaining({ outcome: 'UNREACHABLE' }),
      )
    })
  })

  it('khởi tạo được', () => {
    expect(gateway).toBeDefined()
  })

  it('không cho gửi tin nhắn khi socket chưa xác thực', async () => {
    const client: any = { data: {}, emit: jest.fn() }

    await gateway.handleCreateMessage(
      { conversationId: 'c1', clientMessageId: 'tmp-1', content: 'xin chao' },
      client,
    )

    expect(amqpStub.publish).not.toHaveBeenCalled()
    expect(client.emit).toHaveBeenCalledWith(
      expect.stringContaining('error'),
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('socket đã xác thực -> publish SEND_MESSAGE kèm header version, body giữ nguyên', async () => {
    const client: any = { data: { userId: 'u1' }, emit: jest.fn() }

    await gateway.handleCreateMessage(
      { conversationId: 'c1', clientMessageId: 'tmp-1', content: 'xin chao' },
      client,
    )

    expect(amqpStub.publish).toHaveBeenCalledWith(
      EXCHANGE_RMQ.REALTIME_EVENTS,
      ROUTING_RMQ.SEND_MESSAGE,
      expect.objectContaining({
        conversationId: 'c1',
        senderId: 'u1',
        text: 'xin chao',
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
