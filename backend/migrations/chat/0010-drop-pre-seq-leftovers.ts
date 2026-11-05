import type { Migration } from '@app/migrations'

// Dọn những gì `seq` (0008) thay thế mà không còn code nào đọc. Để lại thì
// chúng không chỉ tốn chỗ: chúng LỆCH — unreadCount lưu trong DB không còn ai
// tăng (đo trên dev: 514/1350 dòng còn số cũ khác số thật), lastReadMessageId
// không tiến theo khi cron đẩy mốc đọc của người gửi.
//
// - conversationMember: unreadCount (= latestSeq − lastReadSeq), lastReadMessageId
//   và lastReadAt (mốc đọc là lastReadSeq), clearedHistoryAt (clearedHistorySeq);
// - message: isDeleted (không đường nào đặt true; "xoá phía mình" là
//   DeleteMessage, "thu hồi" là isRevoked).
//
// Index cũ (phân trang theo (createdAt, _id), lastReadAt, username,
// conversation.lastMessageAt) đã bỏ khỏi schema: `prisma db push` tự xoá chúng.
// mode 'background': code mới không đọc các field này, dọn sau khi app đã lên.

const UNSET: Record<string, string[]> = {
  conversationMember: [
    'unreadCount',
    'lastReadMessageId',
    'lastReadAt',
    'clearedHistoryAt',
  ],
  message: ['isDeleted'],
}

const migration: Migration = {
  id: '0010-drop-pre-seq-leftovers',
  description: 'Bỏ các field cũ mà seq đã thay (unreadCount, lastRead*, ...)',
  mode: 'background',
  async up({ db, dryRun, log }) {
    for (const [collection, fields] of Object.entries(UNSET)) {
      const filter = { $or: fields.map((f) => ({ [f]: { $exists: true } })) }
      if (dryRun) {
        const n = await db.collection(collection).countDocuments(filter)
        log(`Sẽ bỏ ${fields.join(', ')} khỏi ${n} document ${collection}`)
        continue
      }
      const { modifiedCount } = await db
        .collection(collection)
        .updateMany(filter, {
          $unset: Object.fromEntries(fields.map((f) => [f, ''])),
        })
      log(`${collection}: bỏ ${fields.join(', ')} ở ${modifiedCount} document`)
    }
  },
}

export default migration
