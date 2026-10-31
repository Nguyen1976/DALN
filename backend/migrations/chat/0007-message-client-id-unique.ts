import type { Migration } from '@app/migrations'

// Khoá chống trùng cho tin nhắn: mỗi (senderId, clientMessageId) chỉ một bản
// ghi. Khi RabbitMQ giao lại một tin đã ghi nhưng chưa kịp ack, hoặc client gửi
// lại cùng tin sau khi mất kết nối, lần ghi thứ hai chạm index này thay vì nhân
// bản tin.
//
// Partial: tin hệ thống, tin poll và mọi tin cũ không có clientMessageId. Unique
// index thường coi field thiếu là null, nên chỉ cho đúng MỘT tin như vậy tồn tại.
// Prisma không khai báo được partial index nên index sống ở đây.

const KEY = { senderId: 1, clientMessageId: 1 }
const OPTIONS = {
  name: 'message_sender_client_id',
  unique: true,
  partialFilterExpression: { clientMessageId: { $type: 'string' } },
}

const migration: Migration = {
  id: '0007-message-client-id-unique',
  description: 'Unique (senderId, clientMessageId) cho tin có clientMessageId',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    if (dryRun) {
      log(`Sẽ tạo index ${OPTIONS.name} trên message`)
      return
    }
    await db.collection('message').createIndex(KEY, OPTIONS)
    log(`Đã tạo index ${OPTIONS.name}`)
  },
}

export default migration
