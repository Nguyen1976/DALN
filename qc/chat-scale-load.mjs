/**
 * QC tải cho nhiều instance chat + nhiều gateway (spec chat-scale-out §9, kịch bản 1–6).
 *
 *   node qc/chat-scale-load.mjs                      # chạy cả 6 kịch bản
 *   SCENARIO=crash-chat node qc/chat-scale-load.mjs  # một kịch bản
 *   CHECK_ONLY=<runId> node qc/chat-scale-load.mjs   # chỉ chạy lại checker
 *
 * Cần: stack dev chạy với `docker compose --profile scale up -d` (backend/).
 *
 * Client mô phỏng đúng frontend: không gửi khi đang rớt kết nối, nối lại thì gửi
 * lại mọi tin chưa ACK (cùng clientMessageId), SERVER_BUSY thì gửi lại sau
 * 2/4/8s. Checker đọc thẳng Mongo:
 *   mất    = đã nhận ACK mà không có trong DB
 *   trùng  = một clientMessageId có >1 bản ghi
 *   đảo    = trong cùng (hội thoại, người gửi), seq giảm khi xếp theo (createdAt, _id)
 * Tin từng bị SERVER_BUSY được phép đứng sau (client đã chủ động gửi lại), nên
 * không tính vào "đảo" mà báo riêng.
 */
import { createRequire } from 'node:module'
import { execSync, exec } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { api, befriend, register } from './calls-fixtures.mjs'

const require = createRequire(import.meta.url)
const { io } = require('socket.io-client')

const SOCKET = process.env.SOCKET ?? 'http://localhost:8080/realtime'
const BACKEND = new URL('../backend', import.meta.url).pathname
const RUNS = new URL('./.scale-runs/', import.meta.url).pathname
const DURATION = Number(process.env.DURATION ?? 30000)
const EVENT_AT = Number(process.env.EVENT_AT ?? 12000)
const CONVERSATIONS = Number(process.env.CONVERSATIONS ?? 24)
/** Tỉ lệ tin kèm ảnh. Tin ảnh xử lý chậm hơn (server kiểm tra file trên S3), nên
 *  tin chữ gửi ngay sau nó là chỗ thứ tự dễ vỡ nhất. */
const MEDIA_RATIO = Number(process.env.MEDIA_RATIO ?? 0.15)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const RMQ = 'http://localhost:15672/api'
const RMQ_AUTH = 'Basic ' + Buffer.from('user:user').toString('base64')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim()
const redis = (cmd) => sh(`docker exec daln-redis redis-cli ${cmd}`)
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)

/** Cùng hàm băm với gateway (libs/constant/rmq/partition.ts). */
function partitionOf(id) {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(id)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 16
}

const leases = () => redis(`mget ${Array.from({ length: 16 }, (_, p) => `chat:lease:p${p}`).join(' ')}`).split('\n')

// ── Trạng thái hạ tầng trước mỗi kịch bản ─────────────────────────────────────

const ALL_CHATS = ['daln-chat', 'daln-chat-2', 'daln-chat-3']
const ALL_GATEWAYS = ['daln-realtime', 'daln-realtime-2', 'daln-realtime-3']

function running(name) {
  try {
    return sh(`docker inspect -f '{{.State.Running}}' ${name}`) === 'true'
  } catch {
    return false
  }
}

async function waitForLog(container, pattern, sinceIso, ms = 120000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const n = sh(`docker logs --since ${sinceIso} ${container} 2>&1 | grep -c "${pattern}" || true`)
    if (n !== '0') return true
    await sleep(1000)
  }
  throw new Error(`${container}: không thấy "${pattern}" sau ${ms}ms`)
}

async function ensureInstances(chats) {
  const since = new Date().toISOString()
  const started = []
  for (const c of [...ALL_CHATS, ...ALL_GATEWAYS]) {
    const want = ALL_GATEWAYS.includes(c) || chats.includes(c)
    if (want && !running(c)) {
      sh(`docker start ${c}`)
      started.push(c)
    }
    if (!want && running(c)) sh(`docker stop ${c}`)
  }
  for (const c of started) await waitForLog(c, 'successfully started', since)
  // Chờ các chat chia xong 16 partition.
  const end = Date.now() + 60000
  while (Date.now() < end) {
    const owners = leases()
    if (owners.every(Boolean) && new Set(owners).size === chats.length) return
    await sleep(500)
  }
  throw new Error(`partition chưa chia xong cho ${chats.length} chat: ${leases().join(',')}`)
}

async function setMaxLength(n) {
  const res = await fetch(`${RMQ}/policies/%2F/chat-send-partitions`, {
    method: 'PUT',
    headers: { Authorization: RMQ_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pattern: '^chat\\.send\\.p\\d+$',
      definition: { 'dead-letter-exchange': 'daln.dlx', 'max-length': n, overflow: 'reject-publish' },
      'apply-to': 'queues',
      priority: 1,
    }),
  })
  if (!res.ok) throw new Error(`policy -> ${res.status}`)
}

// ── Kịch bản ─────────────────────────────────────────────────────────────────

const SCENARIOS = {
  steady: { chats: ['daln-chat', 'daln-chat-2'], event: null },
  'crash-chat': { chats: ['daln-chat', 'daln-chat-2'], event: () => sh('docker kill daln-chat-2') },
  'stop-chat': { chats: ['daln-chat', 'daln-chat-2'], event: () => exec('docker stop daln-chat-2') },
  'add-chat': {
    chats: ['daln-chat', 'daln-chat-2'],
    // --no-deps: không chạy lại db-push/migrate — ở dev chúng sinh lại Prisma
    // client vào source đang mount và làm mọi chat đang chạy hot-reload.
    event: () => exec('docker compose --profile scale up -d --no-deps chat-3', { cwd: BACKEND }),
  },
  'kill-gateway': { chats: ['daln-chat', 'daln-chat-2'], event: () => sh('docker kill daln-realtime-2') },
  // Broker quá tải: memory alarm chặn mọi publisher trong 8s. Gateway không
  // nhận được confirm sau 5s -> SERVER_BUSY -> client gửi lại sau 2/4/8s.
  // (max-length của policy chỉ chặn tin "ready": khi consumer còn chỗ trong
  // prefetch, broker giao thẳng nên tải tăng đột ngột không chạm tới giới hạn.)
  overload: {
    chats: ['daln-chat', 'daln-chat-2'],
    event: () => {
      sh('docker exec daln-rabbitmq rabbitmqctl set_vm_memory_high_watermark absolute 1')
      setTimeout(() => sh('docker exec daln-rabbitmq rabbitmqctl set_vm_memory_high_watermark 0.4'), 8000)
    },
    expectBusy: true,
  },
  // Queue đầy thật: tạm dừng (pause) cả hai chat, đặt max-length = 1. Khi prefetch
  // (20/partition) đã đầy, tin "ready" chạm giới hạn -> broker nack
  // (reject-publish) -> gateway báo SERVER_BUSY. Tải rải trên ~14 partition
  // (~3-4 tin/s mỗi cái) nên cần ~12s để vượt prefetch; client vẫn kịp gửi lại
  // trong chuỗi 2/4/8s sau khi thả ra.
  'queue-full': {
    chats: ['daln-chat', 'daln-chat-2'],
    event: async () => {
      await setMaxLength(1)
      sh('docker pause daln-chat daln-chat-2')
      setTimeout(() => {
        sh('docker unpause daln-chat daln-chat-2')
        void setMaxLength(20000)
      }, 12000)
    },
    expectBusy: true,
    // Tin ảnh cần presign qua HTTP của chat — chat đang pause thì vòng gửi treo
    // ở bước upload và không còn tin nào đổ vào queue.
    mediaRatio: 0,
  },
}

// ── Dữ liệu QC ───────────────────────────────────────────────────────────────

async function makeFixtures() {
  redis(`eval "for _,k in ipairs(redis.call('keys','rl:*')) do redis.call('del',k) end" 0`)
  const users = []
  for (const tag of ['a', 'b', 'c', 'd', 'e', 'f']) users.push(await register(tag))
  const [owner, ...others] = users
  for (const other of others) await befriend(owner, other)
  const groups = []
  for (let i = 0; i < CONVERSATIONS; i++) {
    const members = [...others].sort(() => Math.random() - 0.5).slice(0, 2)
    const g = await api(owner, 'POST', '/chat/create', {
      groupName: `QC scale ${i}`,
      memberIds: members.map((m) => m.id),
    })
    groups.push({ id: g.id, members: [owner.id, ...members.map((m) => m.id)] })
  }
  return { users, groups }
}

// ── Một lần chạy ─────────────────────────────────────────────────────────────

async function run(name, fx) {
  const sc = SCENARIOS[name]
  log(`== ${name}: chuẩn bị ${sc.chats.join(', ')} + 3 gateway`)
  await ensureInstances(sc.chats)
  await sleep(2000)

  const runId = `${name}-${Date.now().toString(36)}`
  const sent = new Map() // clientMessageId -> record
  const seqOf = new Map() // `${conv}|${sender}` -> seq
  let busyEvents = 0
  let otherErrors = 0
  let reconnects = 0
  let sending = true

  const clients = await Promise.all(
    fx.users.map(async (user) => {
      const socket = io(SOCKET, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: user.cookie } })
      await new Promise((res, rej) => {
        socket.once('connect', res)
        socket.once('connect_error', rej)
      })
      const groups = fx.groups.filter((g) => g.members.includes(user.id))
      const emit = (rec) =>
        socket.emit('message:create', {
          conversationId: rec.conv,
          type: rec.media ? 'IMAGE' : 'TEXT',
          content: rec.content,
          clientMessageId: rec.id,
          medias: rec.media ? [rec.media] : [],
        })
      socket.on('message:ack', ({ clientMessageId, message }) => {
        const rec = sent.get(clientMessageId)
        if (rec && !rec.ackAt) {
          rec.ackAt = Date.now()
          rec.ackId = message.id
        }
      })
      socket.on('message:error', (p) => {
        const rec = sent.get(p.clientMessageId)
        if (p.code === 'SERVER_BUSY' && rec) {
          busyEvents++
          rec.busy = (rec.busy ?? 0) + 1
          const delay = [2000, 4000, 8000][rec.busy - 1]
          if (delay) setTimeout(() => socket.connected && emit(rec), delay)
          else rec.gaveUp = true
        } else otherErrors++
      })
      // Như frontend: lần 'connect' đầu bỏ qua, các lần sau là nối lại.
      socket.on('connect', () => {
        reconnects++
        for (const rec of sent.values()) if (rec.sender === user.id && !rec.ackAt) emit(rec)
      })
      /** Upload một ảnh thật lên MinIO như frontend làm trước khi gửi tin ảnh. */
      const upload = async (conversationId) => {
        const presign = await api(user, 'POST', '/chat/media/presign', { conversationId, type: 'IMAGE', mimeType: 'image/png', fileName: 'qc.png', size: String(PNG.length) })
        const put = await fetch(presign.uploadUrl, { method: 'PUT', body: PNG, headers: { 'Content-Type': 'image/png' } })
        if (!put.ok) throw new Error(`upload -> ${put.status}`)
        return { mediaType: 'IMAGE', objectKey: presign.objectKey, url: presign.publicUrl, mimeType: 'image/png', size: String(PNG.length), fileName: 'qc.png' }
      }
      return { user, socket, groups, emit, upload }
    }),
  )

  const loops = clients.map(async ({ user, socket, groups, emit, upload }) => {
    while (sending) {
      if (socket.connected && groups.length) {
        const g = groups[rand(0, groups.length - 1)]
        const key = `${g.id}|${user.id}`
        for (let i = rand(1, 4); i > 0 && sending; i--) {
          // Upload TRƯỚC khi lấy seq: seq phản ánh đúng thứ tự client emit.
          const media = Math.random() < (sc.mediaRatio ?? MEDIA_RATIO) ? await upload(g.id).catch(() => null) : null
          if (!socket.connected) break
          const seq = (seqOf.get(key) ?? 0) + 1
          seqOf.set(key, seq)
          const id = `qc-${runId}-${user.id.slice(-6)}-${g.id.slice(-6)}-${seq}`
          const rec = { id, conv: g.id, sender: user.id, seq, content: `qc:${runId}:${user.id}:${seq}`, sentAt: Date.now(), media }
          sent.set(id, rec)
          emit(rec)
          await sleep(media ? 1 : rand(5, 30))
        }
      }
      await sleep(rand(80, 250))
    }
  })

  // Theo dõi chủ partition mỗi 100ms.
  const before = leases()
  const timeline = []
  let last = before.join(',')
  const watcher = setInterval(() => {
    const now = leases()
    if (now.join(',') !== last) {
      timeline.push({ at: Date.now(), owners: now })
      last = now.join(',')
    }
  }, 100)

  const started = Date.now()
  let eventAt = null
  if (sc.event) {
    await sleep(EVENT_AT)
    eventAt = Date.now()
    log(`   sự kiện: ${name}`)
    await sc.event()
  }
  await sleep(Math.max(0, DURATION - (Date.now() - started)))
  sending = false
  await Promise.all(loops)

  // Chờ ACK nốt (tối đa 40s: crash cần ~6-8s để partition có chủ mới).
  const ackDeadline = Date.now() + 40000
  while (Date.now() < ackDeadline && [...sent.values()].some((r) => !r.ackAt && !r.gaveUp)) await sleep(500)
  clearInterval(watcher)
  for (const c of clients) c.socket.close()
  await sleep(1500)

  mkdirSync(RUNS, { recursive: true })
  const record = { name, runId, sent: [...sent.values()], before, after: leases(), timeline, eventAt, busyEvents, otherErrors, reconnects, expectBusy: !!sc.expectBusy }
  writeFileSync(`${RUNS}${runId}.json`, JSON.stringify(record))
  return check(record)
}

// ── Checker ──────────────────────────────────────────────────────────────────

function readDb(runId) {
  const js = `JSON.stringify(db.message.find({content:{$regex:'^qc:${runId}:'}},{clientMessageId:1,content:1,createdAt:1,conversationId:1}).toArray().map(d=>({id:d.clientMessageId,_id:String(d._id),content:d.content,conv:String(d.conversationId),at:d.createdAt.getTime()})))`
  // `$regex` trong chuỗi ngoặc kép của shell sẽ bị thay rỗng: escape `$`.
  const script = js.replace(/\$/g, '\\$')
  return JSON.parse(sh(`docker exec daln-mongo mongosh chat-service --quiet --eval "${script}"`, { maxBuffer: 64 * 1024 * 1024 }))
}

function check(r) {
  // Bản ghi thiếu clientMessageId (chạy đối chứng CHAT_QC_DISABLE_DEDUP) nhận
  // diện bằng (hội thoại, nội dung) — cặp này là duy nhất cho mỗi tin của QC.
  const byContent = new Map(r.sent.map((s) => [`${s.conv}|${s.content}`, s.id]))
  const rows = readDb(r.runId).map((row) => ({ ...row, id: row.id ?? byContent.get(`${row.conv}|${row.content}`) }))
  const byId = new Map()
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row])

  const acked = r.sent.filter((s) => s.ackAt)
  const lost = acked.filter((s) => !byId.has(s.id)).length
  const unacked = r.sent.filter((s) => !s.ackAt).length
  const dup = [...byId.values()].filter((v) => v.length > 1).length

  const busyIds = new Set(r.sent.filter((s) => s.busy).map((s) => s.id))
  const seqById = new Map(r.sent.map((s) => [s.id, s]))
  const lanes = new Map()
  for (const row of rows) {
    const s = seqById.get(row.id)
    if (!s || busyIds.has(row.id)) continue
    const key = `${s.conv}|${s.sender}`
    lanes.set(key, [...(lanes.get(key) ?? []), { ...row, seq: s.seq }])
  }
  let reorder = 0
  for (const list of lanes.values()) {
    list.sort((a, b) => a.at - b.at || a._id.localeCompare(b._id))
    const seen = new Set()
    let max = 0
    for (const item of list) {
      if (seen.has(item.seq)) continue
      seen.add(item.seq)
      if (item.seq < max) reorder++
      max = Math.max(max, item.seq)
    }
  }

  const lat = acked.map((s) => s.ackAt - s.sentAt).sort((a, b) => a - b)
  const p = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : 0)

  // Chủ partition trước/sau và thời gian chuyển chủ.
  const moved = r.before.map((o, i) => (o !== r.after[i] ? i : -1)).filter((i) => i >= 0)
  let takeover = null
  if (r.eventAt && moved.length) {
    const doneAt = moved.map((pIdx) => {
      const t = r.timeline.find((e) => e.at >= r.eventAt && e.owners[pIdx] && e.owners[pIdx] !== r.before[pIdx])
      return t ? t.at : null
    })
    if (doneAt.every(Boolean)) takeover = Math.max(...doneAt) - r.eventAt
  }

  const busyOk = !r.expectBusy || r.busyEvents > 0
  const pass = lost === 0 && dup === 0 && reorder === 0 && unacked === 0 && busyOk
  console.log(
    `SCENARIO ${r.name} ${pass ? 'PASS' : 'FAIL'} sent=${r.sent.length} lost=${lost} dup=${dup} reorder=${reorder} unacked=${unacked}` +
      ` busy=${r.busyEvents}${busyIds.size ? `(${busyIds.size} msgs)` : ''} errors=${r.otherErrors} reconnects=${r.reconnects}` +
      ` takeover=${takeover ?? '-'}ms p50=${p(0.5)}ms p99=${p(0.99)}ms run=${r.runId}`,
  )
  const short = (o) => (o ? o.split('-').pop() : '∅')
  console.log(`   partitions before: ${r.before.map(short).join(' ')}`)
  console.log(`   partitions after : ${r.after.map(short).join(' ')}   moved: ${moved.join(',') || '-'}`)
  return pass
}

// ── main ─────────────────────────────────────────────────────────────────────

if (process.env.CHECK_ONLY) {
  const ok = check(JSON.parse(readFileSync(`${RUNS}${process.env.CHECK_ONLY}.json`, 'utf8')))
  process.exit(ok ? 0 : 1)
}

const names = process.env.SCENARIO ? process.env.SCENARIO.split(',') : Object.keys(SCENARIOS)
log('tạo tài khoản + nhóm...')
const fx = await makeFixtures()
log(`${fx.users.length} tài khoản, ${fx.groups.length} nhóm, rơi vào ${new Set(fx.groups.map((g) => partitionOf(g.id))).size}/16 partition`)
let failed = 0
for (const name of names) if (!(await run(name, fx))) failed++
await setMaxLength(20000)
process.exit(failed ? 1 : 0)
