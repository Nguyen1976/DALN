import { Logger } from '@nestjs/common'

/**
 * Token nội bộ mặc định CHỈ cho dev. Đây là giá trị từng nằm công khai trong
 * `backend/.env.docker` (lịch sử git), nên container dev tạo từ trước vẫn mang
 * đúng giá trị này — giữ nguyên để container cũ và mới gọi được nhau. Không bao
 * giờ dùng ở production.
 */
export const DEV_INTERNAL_API_TOKEN = 'dev-internal-token-doi-o-production'

let warned = false

/**
 * Token cho các lời gọi `@InternalOnly()`, dùng CHUNG cho bên nhận (AuthGuard)
 * và bên gửi (internalFetch) để hai bên luôn khớp nhau.
 *
 * - Có `INTERNAL_API_TOKEN` thì dùng nó.
 * - Production thiếu thì trả `null`: bên nhận từ chối tất cả (fail-closed).
 * - Dev thiếu (`.env.docker` được git track nên cố ý để trống) thì dùng token
 *   dev mặc định và cảnh báo một lần — như cách `JWT_SECRET` đang làm — để
 *   `docker compose up` chạy được ngay mà không phải tự đặt biến.
 */
export function resolveInternalApiToken(): string | null {
  const fromEnv = process.env.INTERNAL_API_TOKEN?.trim()
  if (fromEnv) return fromEnv
  if (process.env.NODE_ENV === 'production') return null

  if (!warned) {
    warned = true
    new Logger('InternalApiToken').warn(
      'INTERNAL_API_TOKEN để trống — dùng token dev mặc định (chỉ dev). ' +
        'Production bắt buộc đặt giá trị riêng: `openssl rand -hex 32`.',
    )
  }
  return DEV_INTERNAL_API_TOKEN
}
