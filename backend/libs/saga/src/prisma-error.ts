// Tiện ích nhận diện lỗi vi phạm ràng buộc UNIQUE của Prisma (P2002).
// Dùng cho cơ chế idempotency "chèn mù & bắt exception": khi 2 message trùng
// messageId tới đồng thời, DB unique index đảm bảo chỉ 1 bản ghi inbox được tạo,
// bản còn lại ném P2002 -> rơi vào catch -> bỏ qua xử lý.

export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const code = (error as { code?: unknown }).code
  if (code === 'P2002') return true

  // Phòng trường hợp lỗi Mongo gốc lọt ra ngoài Prisma (duplicate key E11000).
  const message = (error as { message?: unknown }).message
  if (typeof message === 'string' && message.includes('E11000')) return true

  return false
}
