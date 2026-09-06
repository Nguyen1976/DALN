import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { Request, Response } from 'express'
import { resolveTokens } from './resolve-tokens'
import { timingSafeEqual } from 'crypto'

/** Thời hạn access token — phải khớp với lúc đăng nhập ở user service. */
export const ACCESS_TOKEN_TTL = '15m'
export const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000
export const REFRESH_TOKEN_TTL = '7d'
export const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** So sánh chuỗi theo thời gian hằng định để không rò rỉ độ dài/nội dung token. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name)

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true
    }

    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()
    if (request.url === '/metrics') {
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

    if (withoutLogin) return true

    const accessToken =
      request.cookies?.accessToken ||
      this.getCookieValue(request.headers?.cookie, 'accessToken')
    const refreshToken =
      request.cookies?.refreshToken ||
      this.getCookieValue(request.headers?.cookie, 'refreshToken')
    const resolved = resolveTokens(this.jwtService, accessToken, refreshToken)

    if (!resolved.ok) {
      throw new UnauthorizedException({
        message: 'UNAUTHORIZED',
        code: resolved.code,
      })
    }

    // Access hết hạn nhưng refresh còn hạn -> cấp access mới qua cookie.
    // Đây là phần RIÊNG của HTTP: handshake WebSocket không có Response nên
    // gateway chỉ dùng kết quả phân giải, không cấp lại token.
    if (resolved.usedRefresh) {
      // Bản thay thế phải ngắn hạn đúng bằng bản nó thay. Cấp access 7 ngày ở
      // đây từng biến mỗi lần refresh ngầm thành một chứng chỉ sống cả tuần.
      const newAccessToken = this.jwtService.sign(
        {
          userId: resolved.payload.userId,
          email: resolved.payload.email,
          username: resolved.payload.username,
        },
        { expiresIn: ACCESS_TOKEN_TTL },
      )

      response.cookie('accessToken', newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: ACCESS_TOKEN_MAX_AGE_MS,
        path: '/',
      })
    }

    request['user'] = resolved.payload
    return true
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

  private getCookieValue(
    cookieHeader: string | undefined,
    key: string,
  ): string | null {
    if (!cookieHeader) return null

    const chunks = cookieHeader.split(';')
    for (const chunk of chunks) {
      const [cookieKey, ...cookieValueParts] = chunk.trim().split('=')
      if (cookieKey === key) {
        return decodeURIComponent(cookieValueParts.join('='))
      }
    }

    return null
  }
}
