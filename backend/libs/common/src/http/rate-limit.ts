import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { RedisService } from '@app/redis/redis.service'

/**
 * Hạn mức gọi cho từng endpoint.
 *
 * Vì sao tự viết thay vì dùng @nestjs/throttler: repo đã có sẵn đúng pattern
 * này cho luồng đặt lại mật khẩu (`claimPasswordResetIpSlot` = INCR + EXPIRE
 * theo cửa sổ), nên thêm một thư viện chỉ để làm lại việc đó là thêm một mặt
 * phải bảo trì. Ở đây còn cần hai thứ mà throttler không cho sẵn: đếm theo
 * ĐỊA CHỈ EMAIL (chống nhắm vào một tài khoản từ nhiều IP) và hình dạng 429
 * kèm `retryAfterSeconds` mà frontend đã biết đọc từ luồng gửi lại OTP.
 *
 * Lớp duy nhất đang tồn tại là Kong `rate-limiting` 200/phút — mà `limit_by: ip`
 * trong khi compose không set `KONG_TRUSTED_IPS`, nên Kong thấy IP của docker
 * gateway cho MỌI request: 200/phút là một cái xô dùng chung cho toàn hệ thống,
 * không phải per-client.
 */
export interface RateLimitRule {
  /** Tên xô, đi vào key Redis — đặt theo endpoint. */
  bucket: string
  /** Số lần cho phép trong một cửa sổ. */
  limit: number
  /** Độ dài cửa sổ, tính bằng giây. */
  windowSeconds: number
  /**
   * Đếm theo cái gì.
   *
   * `ip` chặn một máy dội vào nhiều tài khoản; `email` chặn nhiều máy dội vào
   * một tài khoản. Tấn công thật thường là loại thứ hai, nên hầu hết endpoint
   * đăng nhập nên có cả hai.
   */
  by: ('ip' | 'email')[]
}

export const RATE_LIMIT_KEY = 'rate-limit'

export const RateLimit = (rule: RateLimitRule) =>
  SetMetadata(RATE_LIMIT_KEY, rule)

/**
 * INCR + EXPIRE + TTL trong một lệnh nguyên tử.
 *
 * Tách thành ba round-trip sẽ có khe: hai request cùng thấy `n == 1` rồi cùng
 * đặt EXPIRE, hoặc tệ hơn là một request tăng bộ đếm rồi chết trước khi kịp
 * đặt hạn — để lại một bộ đếm không bao giờ hết hạn và khoá vĩnh viễn.
 *
 * Trả về số giây phải chờ (> 0 nghĩa là đã vượt hạn mức), hoặc 0 nếu còn lượt.
 */
const CLAIM_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if n > tonumber(ARGV[1]) then
  local ttl = redis.call('TTL', KEYS[1])
  if ttl < 0 then ttl = tonumber(ARGV[2]) end
  return ttl
end
return 0
`

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true

    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (!rule) return true

    const request = context.switchToHttp().getRequest<Request>()

    for (const subject of this.subjectsOf(rule, request)) {
      const retryAfterSeconds = await this.claim(subject, rule)
      if (retryAfterSeconds > 0) {
        throw new HttpException(
          {
            message: 'TOO_MANY_REQUESTS',
            code: 'RATE_LIMITED',
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }

    return true
  }

  /** Các key cần kiểm cho request này. Thiếu dữ liệu thì bỏ qua chiều đó. */
  private subjectsOf(rule: RateLimitRule, request: Request): string[] {
    const subjects: string[] = []

    if (rule.by.includes('ip')) {
      // `trust proxy` đã được đặt ở bootstrap nên đây là IP client thật.
      const ip = request.ip?.trim()
      if (ip) subjects.push(`ip:${ip}`)
    }

    if (rule.by.includes('email')) {
      const body = request.body as { email?: unknown } | undefined
      const email =
        typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (email) subjects.push(`email:${email}`)
    }

    return subjects
  }

  /**
   * Fail-OPEN khi Redis lỗi, và log to.
   *
   * Cân nhắc có chủ ý: fail-closed sẽ biến một sự cố của tầng hạn mức thành
   * sập hẳn đường đăng nhập, mà bản thân việc đăng nhập đã cần Redis để tạo
   * phiên rồi — chặn thêm ở đây không bảo vệ được gì mà chỉ mất thêm dịch vụ.
   */
  private async claim(subject: string, rule: RateLimitRule): Promise<number> {
    try {
      const result = await this.redis.eval(
        CLAIM_SCRIPT,
        [`rl:${rule.bucket}:${subject}`],
        [rule.limit, rule.windowSeconds],
      )
      return Number(result) || 0
    } catch (error) {
      this.logger.error(
        `không kiểm được hạn mức ${rule.bucket} cho ${subject} — cho qua`,
        error instanceof Error ? error.stack : String(error),
      )
      return 0
    }
  }
}
