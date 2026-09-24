import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'
import { readCookie, resolveAccessToken } from './resolve-tokens'
import { SessionStore } from './session.store'
import { timingSafeEqual } from 'crypto'

/** So sánh chuỗi theo thời gian hằng định để không rò rỉ độ dài/nội dung token. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Cửa vào duy nhất của mọi request HTTP có đăng nhập.
 *
 * Guard này TỪNG tự cấp lại access token khi thấy access hết hạn mà refresh còn
 * hạn. Việc đó đã chuyển sang `POST /user/refresh`: làm mới ngầm trên request
 * bất kỳ khiến refresh token không thể rotate, vì N request song song sau mốc
 * 15 phút đều mang token cũ và mỗi cái lại tự set một cookie mới.
 *
 * Đổi lại, guard nhận một việc mới: hỏi Redis xem phiên còn sống không. Đó là
 * cái giá của việc thu hồi có hiệu lực NGAY — một round-trip mỗi request. Không
 * có bước này thì xoá phiên chỉ giết được refresh token, còn access token đã
 * phát ra vẫn gọi API được tới 15 phút nữa.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name)

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private sessions: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true
    }

    const request = context.switchToHttp().getRequest<Request>()
    if (request?.url === '/metrics') {
      return true
    }
    if (!request) {
      throw new UnauthorizedException({
        message: 'UNAUTHORIZED',
        code: 'REQUEST_CONTEXT_INVALID',
      })
    }

    // Kiểm tra TRƯỚC `without-login` để @InternalOnly() luôn thắng, kể cả khi
    // controller cha có @WithoutLogin().
    const internalOnly = this.reflector.getAllAndOverride<boolean>(
      'internal-only',
      [context.getHandler(), context.getClass()],
    )

    if (internalOnly) return this.assertInternalCaller(request)

    const withoutLogin = this.reflector.getAllAndOverride<boolean>(
      'without-login',
      [context.getHandler(), context.getClass()],
    )

    // Endpoint công khai không được chạm Redis: đăng nhập và quên mật khẩu phải
    // dùng được cả khi tầng phiên đang có sự cố.
    if (withoutLogin) return true

    // cookie-parser fills `cookies` where it is mounted; the raw header is
    // the fallback where it is not.
    const cookies = (request.cookies ?? {}) as Partial<Record<string, string>>
    const accessToken =
      cookies.accessToken || readCookie(request.headers?.cookie, 'accessToken')

    const resolved = resolveAccessToken(this.jwtService, accessToken)

    if (!resolved.ok) {
      throw new UnauthorizedException({
        message: 'UNAUTHORIZED',
        code: resolved.code,
      })
    }

    await this.assertSessionAlive(resolved.payload.sid)

    request['user'] = resolved.payload
    return true
  }

  /**
   * Phiên còn sống không — và quan trọng hơn: phân biệt "đã bị thu hồi" với
   * "không kiểm tra được".
   *
   * Trả 401 cho cả hai sẽ khiến một cú nấc của Redis đăng xuất toàn bộ người
   * dùng, vì interceptor của frontend coi mọi 401 là phiên chấm dứt. 503 nói
   * đúng sự thật — lỗi ở phía chúng ta, hãy thử lại — nên không ai bị đá ra, mà
   * việc thu hồi cũng không hề bị bỏ qua âm thầm.
   */
  private async assertSessionAlive(sid: string): Promise<void> {
    let alive: boolean
    try {
      alive = await this.sessions.isAlive(sid)
    } catch (error) {
      this.logger.error(`không kiểm tra được phiên ${sid}`, error)
      throw new ServiceUnavailableException({
        message: 'SESSION_CHECK_UNAVAILABLE',
        code: 'SESSION_CHECK_UNAVAILABLE',
      })
    }

    if (!alive) {
      throw new UnauthorizedException({
        message: 'UNAUTHORIZED',
        code: 'SESSION_REVOKED',
      })
    }
  }

  /**
   * Xác thực lời gọi nội bộ bằng shared secret. Fail-closed: thiếu biến môi
   * trường thì chặn hết, tránh trường hợp cấu hình sót lại mở toang endpoint.
   */
  private assertInternalCaller(request: Request): boolean {
    const expected = process.env.INTERNAL_API_TOKEN?.trim()

    if (!expected) {
      this.logger.error(
        'INTERNAL_API_TOKEN chưa được cấu hình — từ chối mọi lời gọi nội bộ',
      )
      throw new ForbiddenException({
        message: 'FORBIDDEN',
        code: 'INTERNAL_API_NOT_CONFIGURED',
      })
    }

    const provided = request.headers['x-internal-token']
    const token = Array.isArray(provided) ? provided[0] : provided

    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new ForbiddenException({
        message: 'FORBIDDEN',
        code: 'INTERNAL_TOKEN_INVALID',
      })
    }

    return true
  }
}
