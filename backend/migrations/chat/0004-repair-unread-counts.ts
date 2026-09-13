import type { ObjectId } from 'mongodb'
import type { Migration } from '@app/migrations'

// Sửa unreadCount bị kẹt số ảo. Thay cho scripts/repair-unread-counts.mongosh.js
// (đã chạy tay trên prod, nên ở prod migration này không còn gì để sửa).
//
// Vì sao: trước bản sửa race giữa đọc tin và cron unread, người đang mở hội
// thoại đọc tin N ngay (unread = 0) nhưng tối đa 5 giây sau cron vẫn cộng +1
// cho chính tin N, và mọi lần đọc lại N bị bỏ qua nên số ảo không bao giờ về 0.
//
// Với mỗi thành viên còn trong nhóm có lastReadMessageId và unreadCount > 0:
// đếm tin trong hội thoại do NGƯỜI KHÁC gửi, có _id > lastReadMessageId. Chỉ
// HẠ unreadCount xuống số đó khi nó nhỏ hơn, không bao giờ nâng lên. Dòng chưa
// có marker thì để nguyên.
//
// mode 'background': đếm từng thành viên nên có thể lâu, và không phải điều
// kiện để app mới chạy (app tự lành ở lần đọc kế tiếp). Lệnh ghi là
// compare-and-set — kèm điều kiện dòng chưa đổi từ lúc đọc — nên chạy song song
// với app đang hoạt động cũng không đè số mới.

type MemberDoc = {
  _id: ObjectId
  conversationId: ObjectId
  userId: ObjectId
  lastReadMessageId: ObjectId
  unreadCount: number
}

const migration: Migration = {
  id: '0004-repair-unread-counts',
  description:
    'Hạ conversationMember.unreadCount bị kẹt số ảo về số tin chưa đọc thật',
  mode: 'background',
  async up({ db, dryRun, log, eachBatch }) {
    const members = db.collection<MemberDoc>('conversationMember')
    const messages = db.collection('message')
    let scanned = 0
    let fixable = 0
    let written = 0

    await eachBatch<MemberDoc>(
      {
        collection: 'conversationMember',
        filter: {
          isActive: true,
          lastReadMessageId: { $type: 'objectId' },
          unreadCount: { $gt: 0 },
        },
        projection: {
          conversationId: 1,
          userId: 1,
          lastReadMessageId: 1,
          unreadCount: 1,
        },
        batchSize: 200,
        pauseMs: 100,
      },
      async (batch) => {
        for (const member of batch) {
          scanned += 1
          const actual = await messages.countDocuments({
            conversationId: member.conversationId,
            senderId: { $ne: member.userId },
            _id: { $gt: member.lastReadMessageId },
          })
          if (actual >= member.unreadCount) continue

          fixable += 1
          log(
            `  ${String(member._id)} (conv ${String(member.conversationId)}, user ${String(member.userId)}): ` +
              `${member.unreadCount} -> ${actual}`,
          )
          if (dryRun) continue

          const res = await members.updateOne(
            {
              _id: member._id,
              unreadCount: member.unreadCount,
              lastReadMessageId: member.lastReadMessageId,
            },
            { $set: { unreadCount: actual } },
          )
          written += res.modifiedCount
        }
      },
    )

    log(
      `${scanned} dòng có marker và unreadCount > 0, ${fixable} dòng cần sửa` +
        (dryRun ? ' (dry-run, không ghi)' : `, đã ghi ${written}`),
    )
  },
}

export default migration
