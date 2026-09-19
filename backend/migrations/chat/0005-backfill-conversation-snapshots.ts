import type { ObjectId } from 'mongodb'
import type { Migration } from '@app/migrations'

// Điền các bản phi chuẩn hoá mà danh sách hội thoại đọc, cho dữ liệu có từ
// trước khi chúng tồn tại:
//
// 1. conversationMember.lastReadMessageId: dòng tạo qua create() cũ thiếu hẳn
//    field. Prisma MongoDB phân biệt null với "không có field", nên mọi truy
//    vấn marker phải kèm `isSet: false`. Có field (null) ở mọi dòng thì bỏ
//    được nhánh đó.
// 2. conversationMember.peer* của hội thoại DIRECT: tên/ảnh đối phương đọc từ
//    chính dòng thành viên. Dòng cũ không có nên ConversationMapper phải dò
//    `members` — mà danh sách không kéo members.
// 3. conversation.lastMessage*: hội thoại có tin nhưng chưa có bản tóm tắt tin
//    cuối. Trước đây mỗi trang danh sách chạy một findFirst cho TỪNG hội thoại
//    như vậy để bù lúc runtime.
//
// mode 'deploy': code mới bỏ các nhánh bù runtime, nên dữ liệu phải có trước
// khi app lên. Lọc đúng dòng còn thiếu nên chạy lại không làm gì thêm.

type MemberDoc = {
  _id: ObjectId
  conversationId: ObjectId
  userId: ObjectId
  lastReadMessageId?: ObjectId | null
  username?: string | null
  fullName?: string | null
  avatar?: string | null
  peerUserId?: ObjectId | null
}

type MessageDoc = {
  _id: ObjectId
  conversationId: ObjectId
  senderId: ObjectId
  isDeleted?: boolean
  isRevoked?: boolean
  content?: string | null
  type?: string
  createdAt: Date
}

const MEDIA_LABELS: Record<string, string> = {
  IMAGE: 'Hình ảnh',
  VIDEO: 'Video',
  FILE: 'Tệp đính kèm',
}

/** Same text the chat service writes for the list preview. */
function previewOf(message: MessageDoc): string {
  const content = (message.content ?? '').trim()
  if (content) return content
  return MEDIA_LABELS[message.type ?? ''] ?? ''
}

const MISSING = (field: string) => ({
  $or: [{ [field]: null }, { [field]: { $exists: false } }],
})

const migration: Migration = {
  id: '0005-backfill-conversation-snapshots',
  description:
    'Điền lastReadMessageId, peer* (DIRECT) và tin cuối của hội thoại còn thiếu',
  mode: 'deploy',
  async up({ db, dryRun, log, eachBatch }) {
    const members = db.collection<MemberDoc>('conversationMember')
    const messages = db.collection<MessageDoc>('message')
    const conversations = db.collection('conversation')

    // 1. lastReadMessageId: null where the field is missing.
    const noMarker = { lastReadMessageId: { $exists: false } }
    if (dryRun) {
      log(
        `${await members.countDocuments(noMarker)} thành viên thiếu lastReadMessageId`,
      )
    } else {
      const res = await members.updateMany(noMarker, {
        $set: { lastReadMessageId: null },
      })
      log(`Đã thêm lastReadMessageId: null cho ${res.modifiedCount} thành viên`)
    }

    // 2. peer* on both rows of every direct conversation missing them.
    let peers = 0
    await eachBatch(
      {
        collection: 'conversation',
        filter: { type: 'DIRECT' },
        projection: { _id: 1 },
        batchSize: 200,
      },
      async (batch) => {
        for (const conversation of batch) {
          const rows = await members
            .find(
              { conversationId: conversation._id },
              {
                projection: {
                  userId: 1,
                  username: 1,
                  fullName: 1,
                  avatar: 1,
                  peerUserId: 1,
                },
              },
            )
            .toArray()
          for (const row of rows) {
            if (row.peerUserId) continue
            const peer = rows.find((other) => !other.userId.equals(row.userId))
            if (!peer) continue
            peers += 1
            if (dryRun) continue
            await members.updateOne(
              { _id: row._id },
              {
                $set: {
                  peerUserId: peer.userId,
                  peerUsername: peer.username ?? null,
                  peerFullName: peer.fullName ?? null,
                  peerAvatar: peer.avatar ?? null,
                },
              },
            )
          }
        }
      },
    )
    log(
      `${dryRun ? 'Sẽ điền' : 'Đã điền'} peer* cho ${peers} thành viên DIRECT`,
    )

    // 3. The last-message snapshot of conversations that have messages. A
    // plain cursor: eachBatch checkpoints by collection, and step 2 has
    // already walked `conversation` to its end.
    let snapshots = 0
    const missing = conversations.find(MISSING('lastMessageId'), {
      projection: { _id: 1 },
    })
    for await (const conversation of missing) {
      const [latest] = await messages
        .find({
          conversationId: conversation._id,
          isDeleted: { $ne: true },
          isRevoked: { $ne: true },
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(1)
        .toArray()
      if (!latest) continue

      const sender = await members.findOne(
        { conversationId: conversation._id, userId: latest.senderId },
        { projection: { username: 1, fullName: 1, avatar: 1 } },
      )
      snapshots += 1
      if (dryRun) continue
      await conversations.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessageId: latest._id,
            lastMessageAt: latest.createdAt,
            lastMessageText: previewOf(latest),
            lastMessageSenderId: String(latest.senderId),
            lastMessageSenderName:
              sender?.fullName || sender?.username || String(latest.senderId),
            lastMessageSenderAvatar: sender?.avatar ?? null,
          },
        },
      )
    }
    log(`${dryRun ? 'Sẽ điền' : 'Đã điền'} tin cuối cho ${snapshots} hội thoại`)
  },
}

export default migration
