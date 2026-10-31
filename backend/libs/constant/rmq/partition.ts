/**
 * Đường gửi tin chia theo hội thoại: tin của cùng một hội thoại luôn vào cùng
 * một queue, và mỗi queue chỉ có một consumer active (single-active-consumer),
 * nên thứ tự trong hội thoại được giữ dù chạy nhiều instance chat.
 *
 * Số partition cố định: đổi nó là đổi ánh xạ hội thoại → queue, tin cũ và tin
 * mới của một hội thoại có thể nằm ở hai queue khác nhau trong lúc chuyển.
 */
export const PARTITION_COUNT = 16

export const SEND_EXCHANGE = 'chat.send'

export const partitionQueue = (p: number) => `chat.send.p${p}`

export const partitionRoutingKey = (p: number) => `send.p${p}`

const encoder = new TextEncoder()

/** FNV-1a 32-bit trên byte UTF-8 của conversationId, lấy mod PARTITION_COUNT. */
export function partitionOf(conversationId: string): number {
  let hash = 0x811c9dc5
  for (const byte of encoder.encode(conversationId)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % PARTITION_COUNT
}
