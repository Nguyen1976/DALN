/**
 * B17: `seq` không bao giờ trùng khi nhiều đường ghi chạy cùng lúc.
 *
 *   node qc/seq-concurrency-load.mjs
 *
 * Một nhóm, hai instance chat (`--profile scale`). B gửi 400 tin văn bản qua
 * socket (đi batch writer của instance giữ partition), song song A thêm/xoá
 * thành viên 20 lần — mỗi lần một tin hệ thống, ghi bởi instance nào nhận HTTP
 * (thường KHÁC instance giữ partition). Sau đó kiểm trong DB:
 *   - mọi tin có seq, không cặp (conversationId, seq) nào trùng;
 *   - đủ số tin; tin văn bản của B có seq tăng đúng thứ tự gửi.
 */
import { createRequire } from 'node:module'
import { api, befriend, fixtures, register } from './calls-fixtures.mjs'

process.env.QC_RANDOM_XFF ??= '1'
const require = createRequire(import.meta.url)
const { io } = require('socket.io-client')
const breq = createRequire(new URL('../backend/package.json', import.meta.url))
const { MongoClient, ObjectId } = breq('mongodb')
const SOCKET = process.env.SOCKET ?? 'http://localhost:8080/realtime'
const TEXTS = Number(process.env.TEXTS ?? 400)
const TOGGLES = Number(process.env.TOGGLES ?? 20)

let fail = 0
const check = (cond, label, detail = '') => {
  if (!cond) fail++
  console.log(`  ${cond ? '✅' : '❌'} ${label}${!cond && detail ? ` — ${detail}` : ''}`)
}

const fx = await fixtures()
const d = await register('d17')
await befriend(fx.a, d)
const g = await api(fx.a, 'POST', '/chat/create', { groupName: `QR seq ${Date.now().toString(36)}`, memberIds: [fx.b.id, d.id] })
console.log(`nhóm ${g.id}: ${TEXTS} tin văn bản song song ${TOGGLES} lần thêm/xoá thành viên`)

const sock = io(SOCKET, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: fx.b.cookie } })
await new Promise((res, rej) => { sock.once('connect', res); sock.once('connect_error', rej) })
const acked = new Map()
sock.on('message:ack', ({ clientMessageId, message }) => acked.set(clientMessageId, message))
const tag = `qr17-${Date.now().toString(36)}`

const texts = (async () => {
  for (let i = 0; i < TEXTS; i++) {
    sock.emit('message:create', { conversationId: g.id, type: 'TEXT', content: `${tag}-${String(i).padStart(4, '0')}`, clientMessageId: `${tag}-${i}` })
    if (i % 20 === 19) await new Promise((r) => setTimeout(r, 30))
  }
})()
const toggles = (async () => {
  for (let i = 0; i < TOGGLES; i++) {
    await api(fx.a, 'POST', '/chat/add-member', { conversationId: g.id, memberIds: [fx.c.id] })
    await api(fx.a, 'POST', '/chat/remove-member', { conversationId: g.id, targetUserId: fx.c.id })
  }
})()
await Promise.all([texts, toggles])
const end = Date.now() + 30000
while (acked.size < TEXTS && Date.now() < end) await new Promise((r) => setTimeout(r, 200))
sock.close()
check(acked.size === TEXTS, `ACK đủ ${TEXTS} tin văn bản`, `${acked.size}`)

const cli = await new MongoClient('mongodb://localhost:27017/?replicaSet=rs0&directConnection=true').connect()
const msgs = cli.db('chat-service').collection('message')
const conv = new ObjectId(g.id)
const total = await msgs.countDocuments({ conversationId: conv })
const unnumbered = await msgs.countDocuments({ conversationId: conv, seq: { $not: { $type: 'number' } } })
const dupes = await msgs.aggregate([{ $match: { conversationId: conv } }, { $group: { _id: '$seq', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray()
const system = await msgs.countDocuments({ conversationId: conv, isSystem: true })
const mine = await msgs.find({ conversationId: conv, content: { $regex: `^${tag}-` } }, { projection: { content: 1, seq: 1 } }).sort({ seq: 1 }).toArray()
const order = mine.map((m) => Number(m.content.slice(-4)))
const lastSeq = (await cli.db('chat-service').collection('conversation').findOne({ _id: conv })).lastSeq
await cli.close()

check(unnumbered === 0, 'Mọi tin đều có seq', `${unnumbered} tin thiếu`)
check(dupes.length === 0, '0 cặp (conversationId, seq) trùng', JSON.stringify(dupes.slice(0, 5)))
check(system >= TOGGLES * 2 + 1, `Có đủ tin hệ thống (tạo nhóm + ${TOGGLES * 2} lần thêm/xoá)`, `${system}`)
check(mine.length === TEXTS && order.every((n, i) => n === i), 'Tin văn bản của B có seq tăng đúng thứ tự gửi', `${mine.length} tin`)
check(lastSeq >= total, 'Bộ đếm lastSeq không nhỏ hơn số tin', `lastSeq=${lastSeq} tin=${total}`)
console.log(`\n${fail ? `${fail} FAIL` : 'PASS'} · ${total} tin · ${system} tin hệ thống · lastSeq ${lastSeq}`)
process.exit(fail ? 1 : 0)
