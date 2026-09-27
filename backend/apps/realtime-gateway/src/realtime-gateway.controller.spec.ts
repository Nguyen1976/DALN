import { Test } from '@nestjs/testing'
import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { RealtimeGatewayController } from './realtime-gateway.controller'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { RtkWebhookVerifier } from './realtime/rtk-webhook'

describe('RealtimeGatewayController', () => {
  const gatewayStub = {
    applyRtkWebhook: jest.fn().mockResolvedValue(undefined),
  }
  const verifierStub = { verify: jest.fn().mockResolvedValue(true) }
  const redisStub = {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }
  let controller: RealtimeGatewayController

  const body = JSON.stringify({
    event: 'meeting.participantJoined',
    meeting: { id: 'm1' },
    participant: { customParticipantId: 'u1.aa' },
  })
  const req = (raw: string) =>
    ({ body: Buffer.from(raw) }) as unknown as Request

  beforeEach(async () => {
    jest.clearAllMocks()
    verifierStub.verify.mockResolvedValue(true)
    redisStub.set.mockResolvedValue('OK')
    gatewayStub.applyRtkWebhook.mockResolvedValue(undefined)
    const module = await Test.createTestingModule({
      controllers: [RealtimeGatewayController],
      providers: [
        { provide: RealtimeGateway, useValue: gatewayStub },
        { provide: RtkWebhookVerifier, useValue: verifierStub },
        { provide: 'REDIS_CLIENT', useValue: redisStub },
      ],
    }).compile()
    controller = module.get(RealtimeGatewayController)
  })

  it('chữ ký sai -> 401, không xử lý', async () => {
    verifierStub.verify.mockResolvedValue(false)
    await expect(
      controller.handleRtkWebhook(req(body), 'sig', 'uuid-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(gatewayStub.applyRtkWebhook).not.toHaveBeenCalled()
  })

  it('hợp lệ -> áp sự kiện đã chuẩn hoá', async () => {
    await expect(
      controller.handleRtkWebhook(req(body), 'sig', 'uuid-1'),
    ).resolves.toEqual({ ok: true })
    expect(gatewayStub.applyRtkWebhook).toHaveBeenCalledWith({
      event: 'meeting.participantJoined',
      meetingId: 'm1',
      customParticipantId: 'u1.aa',
    })
    expect(redisStub.set).toHaveBeenCalledWith(
      'rtk:webhook:uuid-1',
      '1',
      'EX',
      86400,
      'NX',
    )
  })

  it('trùng rtk-uuid -> 200, không xử lý lại', async () => {
    redisStub.set.mockResolvedValue(null)
    await controller.handleRtkWebhook(req(body), 'sig', 'uuid-1')
    expect(gatewayStub.applyRtkWebhook).not.toHaveBeenCalled()
  })

  it('xử lý lỗi -> 500 và xoá khoá chống lặp để Cloudflare gửi lại', async () => {
    gatewayStub.applyRtkWebhook.mockRejectedValue(new Error('redis down'))
    await expect(
      controller.handleRtkWebhook(req(body), 'sig', 'uuid-1'),
    ).rejects.toBeInstanceOf(InternalServerErrorException)
    expect(redisStub.del).toHaveBeenCalledWith('rtk:webhook:uuid-1')
  })
})
