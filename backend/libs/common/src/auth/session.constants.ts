/**
 * Thông số của một phiên đăng nhập, dùng chung giữa guard, user-service và
 * realtime gateway.
 *
 * Tách khỏi `auth.guard.ts` để guard nhập được `session.store.ts` mà không tạo
 * vòng import — và để không ai còn phải chép tay con số như lúc user-service
 * hardcode '15m'/'7d' bên cạnh hằng số cùng tên trong guard.
 */

/** Access token: ngắn, và cookie hết hạn đúng lúc token hết hạn. */
export const ACCESS_TOKEN_TTL = '15m'
export const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Refresh token: cửa sổ KHÔNG HOẠT ĐỘNG. Mỗi lần rotate đẩy lại hạn này, nên
 * người dùng thường xuyên không bị đá ra giữa lúc đang dùng.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
export const REFRESH_TOKEN_MAX_AGE_MS = REFRESH_TOKEN_TTL_SECONDS * 1000

/**
 * Trần tuyệt đối: bất kể hoạt động liên tục đến đâu, quá mốc này là buộc đăng
 * nhập lại. NIST SP 800-63B yêu cầu reauthentication tuyệt đối ≤ 30 ngày ở AAL1.
 */
export const ABSOLUTE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Chỉ mục phiên chỉ là lưới dọn rác nên sống lâu hơn phiên dài nhất. */
export const SESSION_INDEX_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * Sau khi rotate, token vừa bị thay vẫn được chấp nhận thêm 30 giây.
 *
 * Không có cửa sổ này thì hai request song song sau mốc 15 phút — chuyện thường
 * ngày ở app chat với nhiều tab và một socket — sẽ cùng mang token cũ, và request
 * đến sau bị hiểu là token bị đánh cắp. Người dùng vô tội bị đăng xuất sạch.
 */
export const ROTATION_GRACE_MS = 30 * 1000

/**
 * Cookie refresh chỉ đi tới user-service, không đi khắp hệ thống.
 *
 * Trước đây cả hai cookie đều `path=/`, nên refresh token 7 ngày đi kèm MỌI
 * request tới mọi service và cả handshake WebSocket — bề mặt lộ lọt rộng nhất
 * có thể cho thứ có giá trị nhất.
 *
 * Vì sao `/user` mà không phải `/user/refresh` vốn hẹp hơn: trình duyệt so path
 * theo tiền tố, nên cookie hẹp tới mức đó sẽ KHÔNG được gửi tới `/user/logout`,
 * và logout mất đường xác định phiên cần xoá. Bấm đăng xuất mà phiên vẫn sống
 * trong Redis là đúng cái bug ta đang đi sửa.
 *
 * `/user` vẫn giữ phần thắng lớn nhất: chat, notification, recommendation và
 * handshake WebSocket không còn thấy refresh token. Kong route `/user` dùng
 * `strip_path: false` nên đường trình duyệt gọi đúng là tiền tố này.
 */
export const REFRESH_COOKIE_PATH = '/user'

/**
 * Cookie phiên có gắn cờ Secure hay không. Mặc định bật khi NODE_ENV=production.
 * COOKIE_SECURE=false cho phép production chạy qua HTTP thuần (truy cập bằng IP,
 * chưa có TLS): trên origin http:// trình duyệt lặng lẽ bỏ cookie Secure, và đăng
 * nhập trông như hỏng mà không có lỗi nào.
 */
export function isSecureCookie(): boolean {
  const flag = process.env.COOKIE_SECURE?.trim().toLowerCase()
  if (flag === 'true') return true
  if (flag === 'false') return false
  return process.env.NODE_ENV === 'production'
}
