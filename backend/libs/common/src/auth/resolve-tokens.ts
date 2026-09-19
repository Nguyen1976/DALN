import { JwtService } from '@nestjs/jwt'
import { TokenExpiredError } from 'jsonwebtoken'

/**
 * Phân giải cặp cookie (accessToken, refreshToken) thành danh tính người dùng.
 *
 * Vì sao tách ra: logic này từng nằm ở HAI nơi — AuthGuard (có nhánh refresh)
 * và RealtimeGateway (không có). Kết quả là access token hết hạn thì HTTP tự
 * làm mới bình thường, còn WebSocket bị ngắt thẳng, và vì Socket.IO không tự
 * nối lại sau `io server disconnect` nên realtime chết hẳn tới khi tải lại
 * trang. Gộp về một hàm để hai đường không thể lệch nhau nữa.
 *
 * Hàm này CỐ Ý không cấp token mới: nó chỉ trả lời "ai đây, và có cần làm mới
 * không". Việc set cookie là đặc thù HTTP nên để AuthGuard làm — handshake
 * WebSocket không có `Response` để set.
 */

/** What the user service signs into both session tokens. */
export type JwtPayload = {
  userId: string
  email: string
  username: string
}

export type TokenResolution =
  | {
      ok: true
      payload: JwtPayload
      /** true = access hết hạn hoặc không còn, danh tính lấy từ refresh token -> nên cấp access mới. */
      usedRefresh: boolean
    }
  | { ok: false; code: TokenErrorCode }

export type TokenErrorCode =
  /** Không có cookie phiên nào — cả access lẫn refresh. Chưa đăng nhập. */
  | 'ACCESS_TOKEN_MISSING'
  /** Access hết hạn và không có refresh token đi kèm. */
  | 'REFRESH_TOKEN_MISSING'
  /** Phải dựa vào refresh, nhưng refresh hỏng hoặc hết hạn -> phiên chấm dứt thật. */
  | 'REFRESH_TOKEN_INVALID'
  /** Access sai chữ ký / méo mó (không phải hết hạn). */
  | 'TOKEN_INVALID'

export function resolveTokens(
  jwtService: JwtService,
  accessToken?: string | null,
  refreshToken?: string | null,
): TokenResolution {
  if (!accessToken) {
    // Cookie accessToken có maxAge đúng bằng TTL của JWT, nên trình duyệt xoá
    // nó đúng lúc token hết hạn: từ phút thứ 15 mọi request chỉ còn mang
    // refreshToken. "Không có access" vì thế thường là "access đã hết hạn",
    // không phải "chưa đăng nhập" — trả ACCESS_TOKEN_MISSING ở đây từng đá
    // người dùng ra ngoài dù refresh còn hạn 7 ngày.
    if (!refreshToken) {
      return { ok: false, code: 'ACCESS_TOKEN_MISSING' }
    }
    return resolveFromRefresh(jwtService, refreshToken)
  }

  try {
    return {
      ok: true,
      payload: jwtService.verify(accessToken) as JwtPayload,
      usedRefresh: false,
    }
  } catch (err) {
    // CHỈ hết hạn mới được đi tiếp sang refresh. Chữ ký sai là dấu hiệu token
    // bị giả mạo, không phải phiên cũ -> từ chối luôn.
    if (!(err instanceof TokenExpiredError)) {
      return { ok: false, code: 'TOKEN_INVALID' }
    }

    if (!refreshToken) {
      return { ok: false, code: 'REFRESH_TOKEN_MISSING' }
    }

    return resolveFromRefresh(jwtService, refreshToken)
  }
}

/** Nhánh làm mới dùng chung cho "access hết hạn" và "access đã bị xoá". */
function resolveFromRefresh(
  jwtService: JwtService,
  refreshToken: string,
): TokenResolution {
  try {
    return {
      ok: true,
      payload: jwtService.verify(refreshToken) as JwtPayload,
      usedRefresh: true,
    }
  } catch {
    return { ok: false, code: 'REFRESH_TOKEN_INVALID' }
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
