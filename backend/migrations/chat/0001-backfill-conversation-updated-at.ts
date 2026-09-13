import type { Migration } from '@app/migrations'

// Điền conversation.updatedAt còn null/thiếu bằng createdAt (hoặc thời điểm
// chạy nếu thiếu cả createdAt). Prisma khai báo updatedAt là DateTime bắt
// buộc, nên dòng cũ thiếu field làm findMany ném P2032.
//
// Trước đây ConversationRepository chạy đúng lệnh này lúc runtime
// (forceBackfillConversationUpdatedAt) ở lần dùng đầu tiên của MỌI tiến
// trình, mãi mãi. Giờ chạy một lần ở bước deploy.

const FILTER = {
  $or: [{ updatedAt: null }, { updatedAt: { $exists: false } }],
}

const UPDATE = [{ $set: { updatedAt: { $ifNull: ['$createdAt', '$$NOW'] } } }]

const migration: Migration = {
  id: '0001-backfill-conversation-updated-at',
  description: 'Điền conversation.updatedAt null/thiếu bằng createdAt',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const conversations = db.collection('conversation')
    if (dryRun) {
      const n = await conversations.countDocuments(FILTER)
      log(`${n} conversation thiếu updatedAt sẽ được điền`)
      return
    }
    const res = await conversations.updateMany(FILTER, UPDATE)
    log(`Đã điền updatedAt cho ${res.modifiedCount} conversation`)
  },
}

export default migration
