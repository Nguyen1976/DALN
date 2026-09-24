import { Logger } from '@nestjs/common'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import helmet from 'helmet'

const logger = new Logger('HttpSecurity')

/**
 * Origin được phép gọi API kèm cookie.
 *
 * Trước đây mọi service đặt `origin: true`, tức PHẢN CHIẾU bất kỳ Origin nào
 * kèm `credentials: true`. Thứ duy nhất ngăn một trang lạ đọc dữ liệu người
 * dùng là `sameSite: 'lax'` trên cookie phiên — mà OWASP nói rõ SameSite là
 * lớp phòng vệ phụ, không phải lớp duy nhất.
 *
 * Danh sách lấy từ `CORS_ORIGINS` (phân cách bằng dấu phẩy). Không đặt thì
 * dùng danh sách dev; ở production có cảnh báo, vì khi đó Kong đang là lớp
 * allowlist thật (xem `kong/kong.yml`) và service không nên tự nới ra.
 */
export function allowedOrigins(): string[] {
  const fromEnv = process.env.CORS_ORIGINS?.trim()
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  }

  if (process.env.NODE_ENV === 'production') {
    logger.warn(
      'CORS_ORIGINS chưa được cấu hình — chỉ còn allowlist của Kong đứng trước',
    )
  }

  // Vite hay nhảy cổng khi 5173 bị chiếm, nên cho sẵn cả 5174 — giống lý lẽ
  // đã ghi trong kong.yml, để dev không gặp "Network Error" khó hiểu.
  return [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ]
}

/** CORS cho một service HTTP: allowlist + cookie. */
export function corsOptions(): CorsOptions {
  return {
    origin: allowedOrigins(),
    credentials: true,
  }
}

/**
 * Header bảo mật cho một API trả JSON.
 *
 * CSP bị tắt có chủ ý: các service này không trả HTML, nên CSP ở đây không bảo
 * vệ được gì, còn CSP của trang web thuộc về nginx phục vụ SPA. Những thứ CÓ
 * tác dụng với một API — nosniff, HSTS, không referrer, chặn nhúng iframe —
 * đều nằm trong bộ mặc định của helmet.
 */
export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: false,
    // API và SPA khác origin nên cần tải được chéo; chặn ở đây sẽ phá ảnh/tệp
    // tải từ trình duyệt.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
}
