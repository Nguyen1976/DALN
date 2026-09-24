import { JwtService } from '@nestjs/jwt'
import { TokenExpiredError } from 'jsonwebtoken'

/**
 * Phân giải cookie access token thành danh tính người dùng.
 *
 * Hàm này TỪNG nhận cả cặp (access, refresh) và tự lùi sang refresh khi access
 * hết hạn. Việc đó đã chuyển hẳn sang `POST /user/refresh`, vì làm mới ngầm trên
 * một request bất kỳ khiến không thể rotate refresh token: N request song song
 * sau mốc 15 phút đều mang token cũ, và mỗi cái lại tự cấp cookie mới.
 *
 * Nên ở đây chỉ còn đúng một việc: token này có hợp lệ không, và nếu có thì là
 * ai. Việc phiên còn sống hay đã bị thu hồi thuộc `SessionStore` — đó là state,
 * không phải chữ ký.
 */

/** Những gì user-service ký vào access token. */
export type JwtPayload = {
  userId: string
  email: string
  username: string
  /** Phiên mà token này thuộc về. Thu hồi phiên là xoá `sess:<sid>`. */
  sid: string
}

export type AccessTokenResolution =
  | { ok: true; payload: JwtPayload }
  | { ok: false; code: TokenErrorCode }

export type TokenErrorCode =
  /** Không có cookie access nào. Chưa đăng nhập, hoặc đã quá 15 phút. */
  | 'ACCESS_TOKEN_MISSING'
  /** Còn cookie nhưng đã hết hạn -> client gọi /user/refresh rồi thử lại. */
  | 'ACCESS_TOKEN_EXPIRED'
  /** Sai chữ ký, méo mó, thiếu `sid`, hoặc không phải access token. */
  | 'TOKEN_INVALID'

/** Lỗi thuộc về state của phiên, không thuộc về chữ ký của token. */
export type SessionErrorCode =
  /** Phiên đã bị thu hồi hoặc chết già -> đăng xuất. */
  | 'SESSION_REVOKED'
  /** Không kiểm tra được vì hạ tầng lỗi -> 503, client thử lại, KHÔNG đăng xuất. */
  | 'SESSION_CHECK_UNAVAILABLE'

export type AuthErrorCode = TokenErrorCode | SessionErrorCode

/** Giá trị claim `typ` của access token. Refresh token không còn là JWT. */
export const ACCESS_TOKEN_TYPE = 'at'

export function resolveAccessToken(
  jwtService: JwtService,
  accessToken?: string | null,
): AccessTokenResolution {
  if (!accessToken) {
    return { ok: false, code: 'ACCESS_TOKEN_MISSING' }
  }

  let decoded: unknown
  try {
    decoded = jwtService.verify(accessToken)
  } catch (err) {
    // Hết hạn là chuyện bình thường mỗi 15 phút và có đường cứu (refresh).
    // Sai chữ ký thì không: đó là token bị giả mạo, trả lời khác đi.
    return {
      ok: false,
      code:
        err instanceof TokenExpiredError
          ? 'ACCESS_TOKEN_EXPIRED'
          : 'TOKEN_INVALID',
    }
  }

  const payload = toJwtPayload(decoded)
  if (!payload) {
    return { ok: false, code: 'TOKEN_INVALID' }
  }

  return { ok: true, payload }
}

/**
 * Chỉ nhận token đúng hình dạng ta ký ra.
 *
 * `typ` phải là access: hai token từng dùng chung secret và chung payload nên
 * hoán đổi được cho nhau — đưa refresh token vào chỗ access là dùng được. Giờ
 * refresh không còn là JWT nữa, nhưng claim này khoá lại khả năng đó vĩnh viễn.
 *
 * `sid` phải có: token cấp trước khi có cơ chế phiên thì không thu hồi được, và
 * "không thu hồi được" phải là 401 chứ không phải một ngoại lệ được dung thứ.
 */
function toJwtPayload(decoded: unknown): JwtPayload | null {
  if (!decoded || typeof decoded !== 'object') return null
  const raw = decoded as Record<string, unknown>

  if (raw.typ !== ACCESS_TOKEN_TYPE) return null
  if (typeof raw.userId !== 'string' || !raw.userId) return null
  if (typeof raw.sid !== 'string' || !raw.sid) return null

  return {
    userId: raw.userId,
    email: typeof raw.email === 'string' ? raw.email : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    sid: raw.sid,
  }
}

/** Đọc một cookie từ header thô — dùng chung cho HTTP lẫn handshake WebSocket. */
export function readCookie(
  cookieHeader: string | undefined,
  key: string,
): string | null {
  if (!cookieHeader) return null

  for (const chunk of cookieHeader.split(';')) {
    const [cookieKey, ...valueParts] = chunk.trim().split('=')
    if (cookieKey === key) {
      return decodeURIComponent(valueParts.join('='))
    }
  }

  return null
}
