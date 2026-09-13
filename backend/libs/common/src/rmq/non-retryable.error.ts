/**
 * Lỗi VĨNH VIỄN: thử lại bao nhiêu lần cũng ra đúng lỗi đó (version event chưa
 * hỗ trợ, payload sai, vi phạm nghiệp vụ...). `retryThenDeadLetter` gặp lỗi này
 * sẽ bỏ qua vòng retry và đẩy thẳng message sang dead-letter.
 *
 * LƯU Ý: `safeExecute` bọc mọi lỗi không phải HttpException thành
 * InternalServerErrorException, nên phải ném lỗi này NGOÀI safeExecute (hoặc
 * bắt rồi ném lại), nếu không nó bị coi là lỗi thường và bị retry.
 */
export class NonRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NonRetryableError'
  }
}

export function isNonRetryableError(error: unknown): boolean {
  if (error instanceof NonRetryableError) return true
  // Phòng khi có hai bản copy của class (bundle khác nhau) -> instanceof sai.
  return (
    (error as { name?: unknown } | null | undefined)?.name ===
    'NonRetryableError'
  )
}
