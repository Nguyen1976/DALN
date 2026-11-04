/**
 * Dữ liệu cho bộ profiling truy vấn (query-profile.mjs).
 *
 * Dựng một lần, đánh dấu bằng document `qc_fixture/query-profile` trong
 * chat-service, các lần chạy sau dùng lại. Riêng nhóm D (kịch bản xoá) bị xoá
 * mỗi lần đo nên `ensureDeleteGroup()` dựng lại khi cần.
 *
 * Tin nhắn chèn THẲNG vào Mongo (300.000 tin qua API mất hàng giờ), nhưng mọi
 * người, nhóm, quan hệ bạn bè của A/B/C đều tạo qua API thật để dữ liệu đúng
 * như ứng dụng tự ghi. senderId của tin luôn là thành viên thật của nhóm.
 */
import { createRequire } from 'node:module'
import { api, befriend, fixtures, register } from './calls-fixtures.mjs'

const require = createRequire(new URL('../backend/package.json', import.meta.url))
const { MongoClient, ObjectId } = require('mongodb')

const MONGO = process.env.MONGO ?? 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true'
const MARKER = 'query-profile'
export const SIZES = {
  group: Number(process.env.QP_GROUP ?? 300_000),
  deleteGroup: Number(process.env.QP_DELETE ?? 100_000),
  fakeUsers: Number(process.env.QP_FAKE_USERS ?? 20_000),
  fakeFriendships: Number(process.env.QP_FAKE_FRIENDSHIPS ?? 200_000),
  fakeRequests: Number(process.env.QP_FAKE_REQUESTS ?? 5_000),
  extraMembers: 20,
}

let client
export async function mongo() {
  client ??= await new MongoClient(MONGO).connect()
  return { chat: client.db('chat-service'), user: client.db('user-service'), admin: client.db('admin') }
}
export async function closeMongo() {
  await client?.close()
  client = undefined
}

/** Dữ liệu đo cũ: tin k6 (`lt|…`), tin seed của hội thoại không còn tồn tại, media mồ côi. */
export async function cleanupOldBenchData(log = console.log) {
  const { chat } = await mongo()
  const convIds = (await chat.collection('conversation').find({}, { projection: { _id: 1 } }).toArray()).map((c) => c._id)
  const orphan = { conversationId: { $nin: convIds } }
  const k6 = { content: { $regex: '^lt\\|' } }
  const [nOrphan, nK6] = await Promise.all([chat.collection('message').countDocuments(orphan), chat.collection('message').countDocuments(k6)])
  log(`dọn: ${nOrphan} tin của hội thoại không tồn tại, ${nK6} tin k6`)
  if (nOrphan) await chat.collection('message').deleteMany(orphan)
  if (nK6) await chat.collection('message').deleteMany(k6)
  const mediaMsgIds = await chat.collection('messageMedia').distinct('messageId')
  const alive = new Set((await chat.collection('message').find({ _id: { $in: mediaMsgIds } }, { projection: { _id: 1 } }).toArray()).map((m) => String(m._id)))
  const dead = mediaMsgIds.filter((id) => !alive.has(String(id)))
  if (dead.length) {
    const r = await chat.collection('messageMedia').deleteMany({ messageId: { $in: dead } })
    log(`dọn: ${r.deletedCount} messageMedia mồ côi`)
  }
  log(`còn ${await chat.collection('message').estimatedDocumentCount()} tin`)
}

/** `count` tin cho `conversationId`, người gửi xoay vòng, createdAt tăng đều tới `endAt`. */
export async function insertMessages(conversationId, senderIds, count, { endAt = Date.now(), tag = 'qcp' } = {}) {
  const { chat } = await mongo()
  const conv = new ObjectId(conversationId)
  const step = 2000 // 2 s một tin: 300.000 tin trải ~7 ngày
  const start = endAt - count * step
  // Sau migration 0008 hội thoại có bộ đếm `lastSeq`: giữ chỗ cả khoảng như
  // ứng dụng làm, để tin chèn thẳng không đụng unique (conversationId, seq).
  // Trước migration (đo baseline) không có bộ đếm thì chèn như dữ liệu cũ.
  const counter = await chat.collection('conversation').findOneAndUpdate(
    { _id: conv, lastSeq: { $type: 'number' } },
    { $inc: { lastSeq: count } },
    { returnDocument: 'after' },
  )
  const firstSeq = counter ? counter.lastSeq - count + 1 : null
  const CHUNK = 5000
  let last = null
  for (let from = 0; from < count; from += CHUNK) {
    const docs = []
    const medias = []
    for (let i = from; i < Math.min(count, from + CHUNK); i++) {
      const at = new Date(start + i * step)
      const _id = new ObjectId(Math.floor(at.getTime() / 1000))
      const senderId = new ObjectId(senderIds[i % senderIds.length])
      const kind = i % 100 < 2 ? 'IMAGE' : i % 100 === 2 ? 'FILE' : 'TEXT'
      const link = i % 100 >= 3 && i % 100 < 6
      const content = link ? `${tag} ${i} xem https://example.com/${tag}/${i}` : kind === 'TEXT' ? `${tag} ${i}` : null
      docs.push({
        _id, conversationId: conv, senderId, type: kind, content,
        mentionUserIds: [], isRevoked: false, isDeleted: false, isSystem: false,
        createdAt: at, updatedAt: at,
        ...(firstSeq !== null
          ? { seq: firstSeq + i, hasMedia: kind === 'IMAGE', hasFile: kind === 'FILE', hasLink: link }
          : {}),
      })
      if (kind !== 'TEXT') {
        medias.push({
          _id: new ObjectId(), messageId: _id, mediaType: kind,
          objectKey: `${tag}/${conversationId}/${i}.${kind === 'IMAGE' ? 'jpg' : 'pdf'}`,
          url: `http://localhost:9000/qc/${tag}/${i}`, mimeType: kind === 'IMAGE' ? 'image/jpeg' : 'application/pdf',
          size: 1024, fileName: kind === 'FILE' ? `${tag}-${i}.pdf` : null, sortOrder: 0, createdAt: at,
        })
      }
      last = { _id, at, senderId, content, seq: firstSeq !== null ? firstSeq + i : null }
    }
    await chat.collection('message').insertMany(docs, { ordered: false })
    if (medias.length) await chat.collection('messageMedia').insertMany(medias, { ordered: false })
  }
  await chat.collection('conversation').updateOne(
    { _id: conv },
    { $set: { lastMessageId: last._id, lastMessageAt: last.at, lastMessageText: last.content ?? '[tệp]', lastMessageSenderId: String(last.senderId), updatedAt: last.at, ...(last.seq !== null ? { lastMessageSeq: last.seq } : {}) } },
  )
  // Mốc đã đọc dời tới tin cuối: dữ liệu dựng sẵn không được tạo ra badge
  // 300.000 tin chưa đọc làm nhiễu các kịch bản khác.
  await chat.collection('conversationMember').updateMany(
    { conversationId: conv },
    { $set: { lastMessageAt: last.at, lastReadMessageId: last._id, unreadCount: 0, ...(last.seq !== null ? { latestSeq: last.seq, lastReadSeq: last.seq } : {}) } },
  )
}

async function insertFakeSocialGraph(a) {
  const { user } = await mongo()
  const now = new Date()
  const ids = []
  for (let from = 0; from < SIZES.fakeUsers; from += 5000) {
    const docs = []
    for (let i = from; i < Math.min(SIZES.fakeUsers, from + 5000); i++) {
      const _id = new ObjectId()
      ids.push(_id)
      docs.push({ _id, email: `qcp.fake${i}.${_id}@example.test`, username: `qcpfake${i}x${String(_id).slice(-6)}`, fullName: `QCP Fake ${i}`, password: 'x', isActive: true, interests: [], hasCompletedInterestOnboarding: true, createdAt: now, updatedAt: now })
    }
    await user.collection('User').insertMany(docs, { ordered: false })
  }
  const aId = new ObjectId(a.id)
  const pairs = []
  // A có 300 bạn (hai chiều, như respondToFriendRequest ghi), còn lại là nhiễu.
  for (let i = 0; i < 300; i++) pairs.push([aId, ids[i]], [ids[i], aId])
  for (let i = pairs.length; i < SIZES.fakeFriendships; i++) {
    const x = ids[(i * 7919) % ids.length]
    const y = ids[(i * 104729 + 13) % ids.length]
    if (String(x) !== String(y)) pairs.push([x, y])
  }
  for (let from = 0; from < pairs.length; from += 10000) {
    await user.collection('Friendship').insertMany(
      pairs.slice(from, from + 10000).map(([userId, friendId]) => ({ userId, friendId, createdAt: now })),
      { ordered: false },
    )
  }
  const reqs = []
  for (let i = 0; i < 200; i++) reqs.push({ fromUserId: ids[300 + i], toUserId: aId })
  for (let i = reqs.length; i < SIZES.fakeRequests; i++) reqs.push({ fromUserId: ids[(i * 31) % ids.length], toUserId: ids[(i * 17 + 5) % ids.length] })
  await user.collection('friendRequest').insertMany(
    reqs.map((r, i) => ({ ...r, status: 'PENDING', createdAt: new Date(now.getTime() - i * 1000), updatedAt: now })),
    { ordered: false },
  )
}

/** Dựng (hoặc đọc lại) toàn bộ dữ liệu. Trả về tài khoản đã đăng nhập và các id. */
export async function ensureFixtures(log = console.log) {
  const { chat } = await mongo()
  const saved = await chat.collection('qc_fixture').findOne({ _id: MARKER })
  const { login } = await import('./calls-fixtures.mjs')
  if (saved && !process.env.QP_REBUILD) {
    const [a, b, c] = await Promise.all(saved.accounts.map((acc) => login(acc.email)))
    const extra = await Promise.all(saved.extraEmails.map((e) => login(e)))
    return { ...saved, a, b, c, extra }
  }

  await cleanupOldBenchData(log)
  log('tạo tài khoản và nhóm qua API...')
  const fx = await fixtures()
  const extra = []
  for (let i = 0; i < SIZES.extraMembers; i++) {
    const u = await register(`x${i}`)
    await befriend(fx.a, u)
    extra.push(u)
  }
  const members = [fx.a.id, fx.b.id, fx.c.id]
  log(`chèn ${SIZES.group} tin vào nhóm G...`)
  await insertMessages(fx.groupId, members, SIZES.group, { tag: 'qcp' })
  log('chèn đồ thị bạn bè giả...')
  await insertFakeSocialGraph(fx.a)

  const doc = {
    _id: MARKER,
    createdAt: new Date(),
    accounts: [fx.a, fx.b, fx.c].map(({ email, id, username }) => ({ email, id, username })),
    extraEmails: extra.map((u) => u.email),
    extraIds: extra.map((u) => u.id),
    groupId: fx.groupId,
    directId: fx.directId,
    deleteGroupId: null,
    sizes: SIZES,
  }
  await chat.collection('qc_fixture').replaceOne({ _id: MARKER }, doc, { upsert: true })
  return { ...doc, a: fx.a, b: fx.b, c: fx.c, extra }
}

/** Nhóm D đầy tin cho kịch bản xoá; tạo mới nếu nhóm cũ đã bị xoá. */
export async function ensureDeleteGroup(fx, log = console.log) {
  const { chat } = await mongo()
  if (fx.deleteGroupId) {
    const alive = await chat.collection('conversation').findOne({ _id: new ObjectId(fx.deleteGroupId), deletedAt: { $exists: false } })
    if (alive) return fx.deleteGroupId
  }
  const group = await api(fx.a, 'POST', '/chat/create', { groupName: `QCP xoá ${Date.now().toString(36)}`, memberIds: [fx.b.id, fx.c.id] })
  log(`chèn ${SIZES.deleteGroup} tin vào nhóm D...`)
  await insertMessages(group.id, [fx.a.id, fx.b.id], SIZES.deleteGroup, { tag: 'qcpd' })
  await chat.collection('qc_fixture').updateOne({ _id: MARKER }, { $set: { deleteGroupId: group.id } })
  fx.deleteGroupId = group.id
  return group.id
}
