import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import type { Migration } from '@app/migrations'

// Sửa dữ liệu cũ khiến danh sách hội thoại hiện ID thay cho tên người gửi.
//
// Vì sao: trước bản vá 16/09, `addMemberToConversation` dùng THẲNG danh sách
// client gửi lên (`dto.members`). Client chỉ gửi userId thì dòng
// conversationMember được tạo với username/fullName = null. Sau đó mỗi tin của
// người ấy làm `lastMessageSenderName: displayNameOf(senderMember) || senderId`
// rơi về nhánh `|| senderId`, nên preview hiện một chuỗi ObjectId.
// Code hiện tại lấy hồ sơ từ user service (`userDirectory.getProfiles`) nên
// không sinh thêm dòng thiếu tên nữa — ở đây chỉ dọn phần đã lỡ ghi.
//
// Nguồn tên: chính chat-service, không cần đụng DB user —
//   1) một dòng conversationMember khác của cùng userId đã có tên;
//   2) hoặc trường phi chuẩn hoá `peer*` ở hội thoại DIRECT với người đó.
// Không tìm được tên thì để nguyên (lần người đó gửi tin/được thêm lại sau này
// sẽ tự có tên) — không bịa dữ liệu.
//
// mode 'background': chỉ là dọn hiển thị, app không cần nó để chạy.

type MemberDoc = {
  _id: ObjectId
  userId: ObjectId
  username?: string | null
  fullName?: string | null
  avatar?: string | null
  peerUserId?: ObjectId | null
  peerUsername?: string | null
  peerFullName?: string | null
  peerAvatar?: string | null
}

type Profile = { username: string | null; fullName: string | null; avatar: string | null }

const filled = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim() !== ''

const toObjectId = (value: ObjectId | string): ObjectId | null => {
  if (value instanceof ObjectId) return value
  return ObjectId.isValid(value) ? new ObjectId(value) : null
}

/** Dòng "chưa có tên": cả username lẫn fullName đều trống/thiếu. */
const MISSING_NAME = {
  $and: [
    { $or: [{ username: null }, { username: '' }, { username: { $exists: false } }] },
    { $or: [{ fullName: null }, { fullName: '' }, { fullName: { $exists: false } }] },
  ],
}

/**
 * Tìm tên của một user từ dữ liệu sẵn có trong chat-service.
 *
 * Lưu ý kiểu: `conversationMember.userId` là ObjectId, còn
 * `conversation.lastMessageSenderId` lại là STRING (schema không đánh
 * @db.ObjectId). Vì vậy luôn ép về ObjectId trước khi truy vấn thành viên.
 */
async function findProfile(
  db: Db,
  rawUserId: ObjectId | string,
): Promise<Profile | null> {
  const userId = toObjectId(rawUserId)
  if (!userId) return null
  const members = db.collection<MemberDoc>('conversationMember')

  const own = await members.findOne(
    {
      userId,
      $or: [
        { username: { $type: 'string', $ne: '' } },
        { fullName: { $type: 'string', $ne: '' } },
      ],
    },
    { projection: { username: 1, fullName: 1, avatar: 1 } },
  )
  if (own) {
    return {
      username: filled(own.username) ? own.username : null,
      fullName: filled(own.fullName) ? own.fullName : null,
      avatar: filled(own.avatar) ? own.avatar : null,
    }
  }

  const peer = await members.findOne(
    {
      peerUserId: userId,
      $or: [
        { peerUsername: { $type: 'string', $ne: '' } },
        { peerFullName: { $type: 'string', $ne: '' } },
      ],
    },
    { projection: { peerUsername: 1, peerFullName: 1, peerAvatar: 1 } },
  )
  if (peer) {
    return {
      username: filled(peer.peerUsername) ? peer.peerUsername : null,
      fullName: filled(peer.peerFullName) ? peer.peerFullName : null,
      avatar: filled(peer.peerAvatar) ? peer.peerAvatar : null,
    }
  }

  return null
}

const displayName = (profile: Profile) => profile.fullName || profile.username || ''

const migration: Migration = {
  id: '0006-backfill-member-display-name',
  description:
    'Điền tên còn thiếu ở conversationMember và sửa conversation.lastMessageSenderName đang là ObjectId',
  mode: 'background',
  async up({ db, dryRun, log }) {
    const members = db.collection<MemberDoc>('conversationMember')
    const conversations = db.collection('conversation')

    // (1) Dòng thành viên thiếu tên — thường rất ít, nên đọc thẳng.
    const broken = await members
      .find(MISSING_NAME, { projection: { userId: 1 } })
      .toArray()
    log(`conversationMember thiếu tên: ${broken.length}`)

    const resolved = new Map<string, Profile | null>()
    let memberFixed = 0
    for (const row of broken) {
      const key = String(row.userId)
      if (!resolved.has(key)) resolved.set(key, await findProfile(db, row.userId))
      const profile = resolved.get(key)
      if (!profile || !displayName(profile)) {
        log(`  bỏ qua ${key}: không tìm được tên trong chat-service`)
        continue
      }
      memberFixed += 1
      if (dryRun) {
        log(`  [dry-run] ${key} -> ${displayName(profile)}`)
        continue
      }
      await members.updateOne(
        { _id: row._id, ...MISSING_NAME },
        {
          $set: {
            username: profile.username,
            fullName: profile.fullName,
            ...(profile.avatar ? { avatar: profile.avatar } : {}),
          },
        },
      )
    }

    // (2) Hội thoại đang hiện ObjectId thay cho tên người gửi cuối.
    // Chặn `lastMessageSenderId: null` trước: `$toString(null)` ra null, nên
    // hội thoại chưa có tin nhắn nào cũng khớp `$expr` và làm sai số đếm.
    const stale = await conversations
      .find(
        {
          lastMessageSenderId: { $type: 'string', $ne: '' },
          $expr: {
            $eq: ['$lastMessageSenderName', { $toString: '$lastMessageSenderId' }],
          },
        },
        { projection: { lastMessageSenderId: 1 } },
      )
      .toArray()
    log(`conversation hiện ID thay cho tên: ${stale.length}`)

    let convFixed = 0
    for (const conv of stale) {
      const senderId = conv.lastMessageSenderId as string | null
      if (!senderId) continue
      const key = String(senderId)
      if (!resolved.has(key)) resolved.set(key, await findProfile(db, senderId))
      const profile = resolved.get(key)
      const name = profile ? displayName(profile) : ''
      if (!name) {
        log(`  bỏ qua hội thoại ${String(conv._id)}: chưa có tên cho ${key}`)
        continue
      }
      convFixed += 1
      if (dryRun) {
        log(`  [dry-run] hội thoại ${String(conv._id)} -> ${name}`)
        continue
      }
      await conversations.updateOne(
        { _id: conv._id, lastMessageSenderName: key },
        { $set: { lastMessageSenderName: name } },
      )
    }

    log(
      `${dryRun ? '[dry-run] ' : ''}đã sửa ${memberFixed} dòng thành viên, ${convFixed} hội thoại`,
    )
  },
}

export default migration
