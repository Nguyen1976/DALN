import type { Migration } from '@app/migrations'
import type { AnyBulkWriteOperation, Db, Document, ObjectId } from 'mongodb'

// Đánh số `seq` cho tin cũ (docs/design/message-seq-design.md §8).
//
// Mỗi hội thoại: tin xếp theo (createdAt, _id) — đúng thứ tự client vẫn hiển
// thị — được gán 1..n, kèm các cờ tab tài nguyên (hasMedia/hasFile/hasLink).
// Bộ đếm `conversation.lastSeq = n` (0 với hội thoại chưa có tin), thành viên
// có `latestSeq`, `lastReadSeq`, `lastMentionSeq`, `clearedHistorySeq`.
//
// Mốc đọc giữ nguyên BADGE hiện có: lastReadSeq = n − unreadCount, chứ không
// suy từ lastReadMessageId — số đếm cũ không tính tin của chính mình, còn
// vị trí của lastReadMessageId thì có.
//
// Chạy khi chat ĐÃ DỪNG ghi (seq-allocator từ chối hội thoại chưa có lastSeq,
// nên tin mới không chen vào được, nhưng dừng chat thì chắc chắn). Chạy lại
// được: hội thoại đã có lastSeq kiểu số và không còn tin thiếu seq thì bỏ qua.
// Unique (conversationId, seq) tạo SAU khi đánh số, vì trước đó mọi tin đều
// mang seq = null.

const BATCH = 1000
const LINK = /http|www\./
const INDEX = { conversationId: 1, seq: 1 }
const INDEX_OPTIONS = { name: 'message_conversation_seq', unique: true }

type Member = {
  _id: ObjectId
  unreadCount?: number
  lastReadSeq?: number | null
  lastMentionMessageId?: unknown
  clearedHistoryAt?: Date | null
}

/** Khoá so sánh cho ObjectId (hoặc chuỗi id) — Map không so được ObjectId. */
const idOf = (value: unknown): string =>
  value == null
    ? ''
    : typeof value === 'string'
      ? value
      : (value as ObjectId).toHexString()

/** Tin của hội thoại theo (createdAt, _id), từng trang — không giữ con trỏ mở. */
async function* messagesInOrder(db: Db, conversationId: unknown) {
  let after: { createdAt: Date; _id: unknown } | null = null
  for (;;) {
    const filter: Document = { conversationId }
    if (after) {
      filter.$or = [
        { createdAt: { $gt: after.createdAt } },
        { createdAt: after.createdAt, _id: { $gt: after._id } },
      ]
    }
    const page = await db
      .collection('message')
      .find(filter, {
        projection: { _id: 1, createdAt: 1, type: 1, content: 1, seq: 1 },
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(BATCH)
      .toArray()
    if (!page.length) return
    yield page
    const last = page[page.length - 1]
    after = { createdAt: last.createdAt as Date, _id: last._id }
  }
}

async function needsNumbering(db: Db, conversation: Document) {
  if (typeof conversation.lastSeq !== 'number') return true
  const total = await db
    .collection('message')
    .countDocuments({ conversationId: conversation._id })
  const numbered = await db.collection('message').countDocuments({
    conversationId: conversation._id,
    seq: { $type: 'number' },
  })
  return numbered < total
}

async function numberConversation(db: Db, conversation: Document) {
  const conversationId = conversation._id as ObjectId
  // Hội thoại đã có tin mang seq (lần chạy trước dở dang): unique index có thể
  // đã tồn tại, gán thẳng 1..n sẽ đụng số cũ. Đi hai lượt: số âm rồi số dương.
  const partial =
    (await db
      .collection('message')
      .countDocuments({ conversationId, seq: { $type: 'number' } })) > 0
  const wanted = new Set([idOf(conversation.lastMessageId)])
  const members = (await db
    .collection('conversationMember')
    .find({ conversationId })
    .toArray()) as Member[]
  for (const member of members) wanted.add(idOf(member.lastMentionMessageId))

  const seqOfId = new Map<string, number>()
  const seqAtTime: { at: number; seq: number }[] = []
  let n = 0
  for (const pass of partial ? [-1, 1] : [1]) {
    n = 0
    for await (const page of messagesInOrder(db, conversationId)) {
      const kinds = new Map<string, Set<string>>()
      const media = await db
        .collection('messageMedia')
        .find(
          { messageId: { $in: page.map((m) => m._id) } },
          { projection: { messageId: 1, mediaType: 1 } },
        )
        .toArray()
      for (const row of media) {
        const set = kinds.get(idOf(row.messageId)) ?? new Set<string>()
        set.add(String(row.mediaType))
        kinds.set(idOf(row.messageId), set)
      }
      const ops = page.map((message): AnyBulkWriteOperation => {
        n += 1
        const id = idOf(message._id)
        if (wanted.has(id)) seqOfId.set(id, n)
        seqAtTime.push({
          at: new Date(message.createdAt as Date).getTime(),
          seq: n,
        })
        const set = kinds.get(id) ?? new Set<string>()
        const type = String(message.type ?? 'TEXT')
        if (type === 'IMAGE' || type === 'VIDEO' || type === 'FILE')
          set.add(type)
        return {
          updateOne: {
            filter: { _id: message._id },
            update: {
              $set: {
                seq: pass * n,
                hasMedia: set.has('IMAGE') || set.has('VIDEO'),
                hasFile: set.has('FILE'),
                hasLink:
                  typeof message.content === 'string' &&
                  LINK.test(message.content),
              },
            },
          },
        }
      })
      await db.collection('message').bulkWrite(ops, { ordered: false })
    }
    if (pass === -1) seqAtTime.length = 0
  }

  await db.collection('conversation').updateOne(
    { _id: conversationId },
    {
      $set: {
        lastSeq: n,
        lastMessageSeq:
          seqOfId.get(idOf(conversation.lastMessageId)) ?? (n || null),
      },
    },
  )
  const seqAt = (date: Date) => {
    const t = new Date(date).getTime()
    let best = 0
    for (const row of seqAtTime)
      if (row.at <= t && row.seq > best) best = row.seq
    return best
  }
  if (members.length) {
    await db.collection('conversationMember').bulkWrite(
      members.map(
        (member): AnyBulkWriteOperation => ({
          updateOne: {
            filter: { _id: member._id },
            update: { $set: memberMarks(member, n, seqOfId, seqAt) },
          },
        }),
      ),
      { ordered: false },
    )
  }
  return n
}

function memberMarks(
  member: Member,
  lastSeq: number,
  seqOfId: Map<string, number>,
  seqAt: (date: Date) => number,
) {
  const unread = Math.min(lastSeq, Math.max(0, Number(member.unreadCount ?? 0)))
  return {
    latestSeq: lastSeq,
    // Lần chạy lại (đánh số bổ sung): mốc đã có thì giữ — sau lần đầu,
    // unreadCount không còn được cập nhật nên không suy lại từ nó.
    lastReadSeq:
      typeof member.lastReadSeq === 'number'
        ? Math.min(member.lastReadSeq, lastSeq)
        : lastSeq - unread,
    lastMentionSeq: seqOfId.get(idOf(member.lastMentionMessageId)) ?? null,
    clearedHistorySeq: member.clearedHistoryAt
      ? seqAt(member.clearedHistoryAt)
      : null,
  }
}

const migration: Migration = {
  id: '0008-message-seq',
  description:
    'Đánh số seq cho tin theo hội thoại, cờ tab tài nguyên, mốc đọc theo seq',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const conversations = await db
      .collection('conversation')
      .find({}, { projection: { _id: 1, lastSeq: 1, lastMessageId: 1 } })
      .toArray()
    const todo: Document[] = []
    for (const conversation of conversations) {
      if (await needsNumbering(db, conversation)) todo.push(conversation)
    }

    if (dryRun) {
      log(
        `${conversations.length} hội thoại, ${todo.length} hội thoại cần đánh số (dry-run, không ghi)`,
      )
      return
    }

    let messages = 0
    for (const conversation of todo)
      messages += await numberConversation(db, conversation)

    await db.collection('message').createIndex(INDEX, INDEX_OPTIONS)

    // Hội thoại không cần đánh số lại vẫn có thể có dòng thành viên chưa mang
    // mốc seq (thêm vào giữa hai lần chạy): đặt cho họ "đã đọc hết".
    const unmarked = await db
      .collection('conversationMember')
      .find(
        { $or: [{ lastReadSeq: { $exists: false } }, { lastReadSeq: null }] },
        { projection: { _id: 1, conversationId: 1 } },
      )
      .toArray()
    if (unmarked.length) {
      const lastSeq = new Map(
        (
          await db
            .collection('conversation')
            .find({}, { projection: { _id: 1, lastSeq: 1 } })
            .toArray()
        ).map((c) => [idOf(c._id), Number(c.lastSeq ?? 0)]),
      )
      await db.collection('conversationMember').bulkWrite(
        unmarked.map((row): AnyBulkWriteOperation => {
          const seq = lastSeq.get(idOf(row.conversationId)) ?? 0
          return {
            updateOne: {
              filter: { _id: row._id },
              update: { $set: { latestSeq: seq, lastReadSeq: seq } },
            },
          }
        }),
        { ordered: false },
      )
    }

    // Kiểm sau migration: không còn hội thoại thiếu bộ đếm, tin thiếu số, dòng
    // thành viên thiếu mốc. Lệch thì dừng deploy thay vì để chat từ chối tin.
    const [convTotal, convOk, msgTotal, msgOk, memTotal, memOk] =
      await Promise.all([
        db.collection('conversation').countDocuments({}),
        db
          .collection('conversation')
          .countDocuments({ lastSeq: { $type: 'number' } }),
        db.collection('message').countDocuments({}),
        db.collection('message').countDocuments({ seq: { $type: 'number' } }),
        db.collection('conversationMember').countDocuments({}),
        db.collection('conversationMember').countDocuments({
          lastReadSeq: { $type: 'number' },
          latestSeq: { $type: 'number' },
        }),
      ])
    if (convOk !== convTotal || msgOk !== msgTotal || memOk !== memTotal) {
      throw new Error(
        `0008 chưa xong: hội thoại ${convOk}/${convTotal}, tin ${msgOk}/${msgTotal}, thành viên ${memOk}/${memTotal}`,
      )
    }
    log(
      `${todo.length} hội thoại được đánh số (${messages} tin), ${unmarked.length} dòng thành viên được đặt mốc`,
    )
  },
}

export default migration
