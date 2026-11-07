import type { Migration } from '@app/migrations'

// Thu hồi trước đây không sửa preview ở danh sách hội thoại, nên những hội thoại
// có tin cuối đã thu hồi vẫn lưu nguyên nội dung mà người gửi đã rút lại. Tin nhắn
// thì đã xoá nội dung; bản sao này là chỗ duy nhất còn sót.
//
// Duyệt theo conversation chứ không theo message: `isRevoked` không có index và
// message nhiều hơn conversation vài bậc. Chạy lại vô hại.

const REVOKED_PREVIEW = 'Tin nhắn đã bị thu hồi'
const BATCH = 500

const migration: Migration = {
  id: '0011-revoked-last-message-preview',
  description: 'Xoá nội dung đã thu hồi còn sót trong preview của hội thoại',
  mode: 'background',
  async up({ db, dryRun, log }) {
    const conversations = db
      .collection('conversation')
      .find(
        {
          lastMessageId: { $ne: null },
          lastMessageText: { $ne: REVOKED_PREVIEW },
        },
        { projection: { lastMessageId: 1 } },
      )
      .batchSize(BATCH)

    let fixed = 0
    const repair = async (ids: unknown[]) => {
      if (!ids.length) return
      const revoked = await db
        .collection('message')
        .find({ _id: { $in: ids }, isRevoked: true } as never, {
          projection: { _id: 1 },
        })
        .map((row) => row._id)
        .toArray()
      if (!revoked.length) return
      fixed += revoked.length
      if (dryRun) return
      await db
        .collection('conversation')
        .updateMany({ lastMessageId: { $in: revoked } } as never, {
          $set: { lastMessageText: REVOKED_PREVIEW },
        })
    }

    let batch: unknown[] = []
    for await (const conversation of conversations) {
      batch.push(conversation.lastMessageId)
      if (batch.length === BATCH) {
        await repair(batch)
        batch = []
      }
    }
    await repair(batch)
    log(`${dryRun ? 'Sẽ sửa' : 'Đã sửa'} preview của ${fixed} hội thoại`)
  },
}

export default migration
