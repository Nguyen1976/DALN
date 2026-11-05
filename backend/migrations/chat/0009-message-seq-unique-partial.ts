import type { Migration } from '@app/migrations'

// Unique (conversationId, seq) phải sống qua `prisma db push`.
//
// db push chạy ở MỖI lần deploy và xoá mọi index thường không khai báo trong
// schema — kể cả unique `message_conversation_seq` mà 0008 tạo (thử trên Mongo
// 7.0: sau một lần push, index biến mất; 0008 không chạy lại nên không ai tạo
// lại). Mất nó là mất cả lưới an toàn của batch writer (E11000 khi trùng seq ->
// cấp lại) lẫn index cho phân trang theo seq.
//
// Index partial thì db push để yên (Prisma không khai báo được partial index,
// như message_sender_client_id của 0007). Nên: unique partial chỉ trên tin có
// seq; truy vấn dùng index thường `@@index([conversationId, seq])` của schema
// (Prisma bọc where trong `$expr`, không dùng được index partial).

const KEY = { conversationId: 1, seq: 1 }
const OPTIONS = {
  name: 'message_conversation_seq_unique',
  unique: true,
  partialFilterExpression: { seq: { $type: 'number' } },
}
/** Bản không partial mà 0008 tạo. */
const LEGACY = 'message_conversation_seq'

const migration: Migration = {
  id: '0009-message-seq-unique-partial',
  description: 'Unique (conversationId, seq) dạng partial để db push không xoá',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    if (dryRun) {
      log(`Sẽ tạo ${OPTIONS.name}, xoá ${LEGACY} nếu còn`)
      return
    }
    await db.collection('message').createIndex(KEY, OPTIONS)
    log(`Đã có index ${OPTIONS.name}`)
    try {
      await db.collection('message').dropIndex(LEGACY)
      log(`Đã xoá index ${LEGACY}`)
    } catch (error) {
      // Không có: db push đã xoá nó trước khi migration này chạy.
      const code = (error as { code?: number }).code
      if (code !== 27 && code !== 26) throw error
    }
  },
}

export default migration
