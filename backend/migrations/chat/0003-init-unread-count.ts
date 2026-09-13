import type { Migration } from '@app/migrations'

// Đặt conversationMember.unreadCount = 0 cho dòng còn null/thiếu. unreadCount
// là Int bắt buộc trong schema, và cron cộng unread dùng $inc — $inc lên
// null sẽ lỗi.
//
// Trước đây ConversationMemberRepository chạy đúng lệnh này lúc runtime
// (forceBackfillUnreadCount) ở lần dùng đầu tiên của mọi tiến trình. Giờ
// chạy một lần ở bước deploy.

const FILTER = {
  $or: [{ unreadCount: null }, { unreadCount: { $exists: false } }],
}

const migration: Migration = {
  id: '0003-init-unread-count',
  description: 'Đặt conversationMember.unreadCount = 0 cho dòng null/thiếu',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const members = db.collection('conversationMember')
    if (dryRun) {
      const n = await members.countDocuments(FILTER)
      log(`${n} conversationMember thiếu unreadCount sẽ được đặt 0`)
      return
    }
    const res = await members.updateMany(FILTER, { $set: { unreadCount: 0 } })
    log(`Đã đặt unreadCount = 0 cho ${res.modifiedCount} conversationMember`)
  },
}

export default migration
