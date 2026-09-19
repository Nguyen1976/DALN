import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { WebhookReceiver } from 'livekit-server-sdk'
import { RealtimeGateway } from './realtime/realtime.gateway'

@Controller()
export class RealtimeGatewayController {
  constructor(private readonly realtimeGateway: RealtimeGateway) {}

  /**
   * Webhook LiveKit — nguồn sự thật cuối về "ai đang trong phòng".
   *
   * LiveKit ký body bằng chính `LIVEKIT_API_SECRET` và gửi JWT trong header
   * `Authorization`; `WebhookReceiver.receive` kiểm chữ ký đó trên body THÔ. Body
   * phải là raw (chưa qua JSON parser) nên `main.ts` gắn `express.raw()` riêng cho
   * đúng path này — `req.body` do đó là Buffer.
   *
   * Trả 200 nhanh dù chữ ký hỏng/chưa cấu hình: LiveKit chỉ cần biết đã nhận,
   * và ta không muốn nó thử lại dồn dập. Sự kiện chỉ được xử lý khi verify đạt.
   */
  @Post('livekit/webhook')
  @HttpCode(200)
  async handleLivekitWebhook(
    @Req() req: Request,
    @Headers('authorization') authHeader?: string,
  ): Promise<{ ok: boolean }> {
    const apiKey = process.env.LIVEKIT_API_KEY?.trim()
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim()
    if (!apiKey || !apiSecret) return { ok: false }

    const body = (req as Request & { body?: unknown }).body
    const rawBody = Buffer.isBuffer(body)
      ? body.toString('utf8')
      : typeof body === 'string'
        ? body
        : ''
    if (!rawBody) return { ok: false }

    try {
      const receiver = new WebhookReceiver(apiKey, apiSecret)
      const event = await receiver.receive(rawBody, authHeader)
      await this.realtimeGateway.applyLivekitWebhook(event)
    } catch {
      // Chữ ký sai hoặc body hỏng — bỏ qua, vẫn 200 để LiveKit không thử lại.
      return { ok: false }
    }

    return { ok: true }
  }
}
