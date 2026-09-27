import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import type Redis from 'ioredis'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { parseRtkEvent, RtkWebhookVerifier } from './realtime/rtk-webhook'

@Controller()
export class RealtimeGatewayController {
  private readonly logger = new Logger(RealtimeGatewayController.name)

  constructor(
    private readonly realtimeGateway: RealtimeGateway,
    private readonly verifier: RtkWebhookVerifier,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * Webhook RealtimeKit — nguồn sự thật cuối về "ai đang trong phòng" gọi nhóm.
   *
   * Public URL: https://<domain>/api/realtime/rtk-webhook (nginx bỏ /api, Kong
   * chuyển /realtime nguyên vẹn tới gateway). Body phải là raw vì chữ ký tính trên
   * byte gốc — `main.ts` gắn `express.raw()` riêng cho path này.
   *
   * Sai chữ ký -> 401. Lỗi xử lý -> 500 và xoá khoá chống lặp để Cloudflare gửi
   * lại. Trùng `rtk-uuid` -> 200, không làm gì.
   */
  @Post('realtime/rtk-webhook')
  @HttpCode(200)
  async handleRtkWebhook(
    @Req() req: Request,
    @Headers('rtk-signature') signature?: string,
    @Headers('rtk-uuid') uuid?: string,
  ): Promise<{ ok: true }> {
    const body: unknown = req.body
    const raw = Buffer.isBuffer(body)
      ? body.toString('utf8')
      : typeof body === 'string'
        ? body
        : ''
    if (!raw || !(await this.verifier.verify(raw, signature))) {
      throw new UnauthorizedException()
    }

    const event = parseRtkEvent(raw)
    if (!event) return { ok: true }

    const dedupeKey = uuid ? `rtk:webhook:${uuid}` : null
    if (
      dedupeKey &&
      !(await this.redis.set(dedupeKey, '1', 'EX', 86400, 'NX'))
    ) {
      return { ok: true }
    }

    try {
      await this.realtimeGateway.applyRtkWebhook(event)
    } catch (error) {
      if (dedupeKey) await this.redis.del(dedupeKey).catch(() => 0)
      this.logger.error('xử lý webhook RealtimeKit lỗi', error)
      throw new InternalServerErrorException()
    }
    return { ok: true }
  }
}
