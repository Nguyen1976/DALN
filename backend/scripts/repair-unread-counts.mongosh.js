// Sửa unreadCount bị kẹt số ảo. Chạy MỘT lần, sau khi deploy bản backend sửa
// race giữa đọc tin và cron unread: trước bản đó, người đang mở hội thoại đọc
// tin N ngay (unread=0) nhưng tối đa 5 giây sau cron vẫn cộng +1 cho chính tin
// N, và mọi lần đọc lại N bị bỏ qua nên con số ảo đó không bao giờ về 0.
//
// Với mỗi thành viên còn trong nhóm có lastReadMessageId và unreadCount > 0:
// đếm tin trong hội thoại do NGƯỜI KHÁC gửi, có _id > lastReadMessageId. Chỉ
// HẠ unreadCount xuống số đó khi nó nhỏ hơn, không bao giờ nâng lên. Dòng chưa
// có marker thì để nguyên.
//
// Mặc định CHỈ BÁO CÁO. Đặt APPLY=1 để ghi. Lệnh ghi kèm điều kiện dòng chưa
// đổi từ lúc đọc, nên chạy lúc hệ thống đang hoạt động cũng không đè số mới.
//
//   docker cp scripts/repair-unread-counts.mongosh.js daln-prod-mongo:/tmp/
//   docker exec daln-prod-mongo mongosh --quiet chat-service /tmp/repair-unread-counts.mongosh.js
//   docker exec -e APPLY=1 daln-prod-mongo mongosh --quiet chat-service /tmp/repair-unread-counts.mongosh.js
//
// Dev: thay daln-prod-mongo bằng daln-mongo.

const apply = process.env.APPLY === '1'

const members = db.conversationMember
  .find(
    {
      isActive: true,
      lastReadMessageId: { $type: 'objectId' },
      unreadCount: { $gt: 0 },
    },
    { conversationId: 1, userId: 1, lastReadMessageId: 1, unreadCount: 1 },
  )
  .toArray()

const todo = []
for (const member of members) {
  const actual = db.message.countDocuments({
    conversationId: member.conversationId,
    senderId: { $ne: member.userId },
    _id: { $gt: member.lastReadMessageId },
  })
  if (actual < member.unreadCount) todo.push({ member, actual })
}

print(
  `${members.length} dòng có marker và unreadCount > 0, ${todo.length} dòng cần sửa` +
    (apply ? '' : ' (chạy thử — đặt APPLY=1 để ghi)'),
)

let written = 0
for (const { member, actual } of todo) {
  print(
    `  ${String(member._id)} (conv ${String(member.conversationId)}, user ${String(member.userId)}): ` +
      `${member.unreadCount} -> ${actual}`,
  )
  if (apply) {
    const res = db.conversationMember.updateOne(
      {
        _id: member._id,
        unreadCount: member.unreadCount,
        lastReadMessageId: member.lastReadMessageId,
      },
      { $set: { unreadCount: actual } },
    )
    written += res.modifiedCount
  }
}

if (apply) print(`Đã ghi ${written}/${todo.length} dòng.`)
