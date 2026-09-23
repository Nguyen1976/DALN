/**
 * Che phần trước `@`, giữ 2 ký tự đầu và 2 ký tự cuối.
 *
 * Đủ để chủ tài khoản nhận ra địa chỉ của mình mà không đọc được hết nếu liên
 * kết rơi vào tay người khác. Tên quá ngắn thì che sạch: giữ 2 đầu + 2 cuối
 * của một chuỗi 4 ký tự là không che gì cả.
 */
export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return '****'

  const local = normalized.slice(0, at)
  const domain = normalized.slice(at)

  if (local.length <= 4) return `${'*'.repeat(local.length)}${domain}`

  const stars = '*'.repeat(local.length - 4)
  return `${local.slice(0, 2)}${stars}${local.slice(-2)}${domain}`
}
