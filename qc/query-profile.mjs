/**
 * Profiling truy vấn: chạy y hệt TRƯỚC và SAU khi sửa, ghi ra số liệu để so.
 *
 *   LABEL=before node qc/query-profile.mjs            # mọi kịch bản
 *   LABEL=after ONLY=assets-media,read node qc/query-profile.mjs
 *   node qc/query-profile-compare.mjs before after
 *
 * Mỗi kịch bản: bật profiler (level 2, system.profile 256MB) trên DB liên quan,
 * chụp serverStatus, chạy thao tác qua API/socket THẬT N lần, rồi gom
 * system.profile theo (collection, lệnh): số lệnh, keys/docs examined, thời
 * gian trong DB, plan, có $lookup không, bao nhiêu lệnh nằm trong transaction.
 * Thời gian wall-clock đo ở các lượt KHÔNG bật profiler (profiler tự làm chậm
 * Mongo), số liệu DB đo ở một lượt riêng có bật profiler.
 *
 * Cần: stack dev (`docker compose --profile scale up -d`, dừng daln-chat-3).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { api } from './calls-fixtures.mjs'
import { closeMongo, ensureDeleteGroup, ensureFixtures, mongo } from './query-profile-fixtures.mjs'

const require = createRequire(import.meta.url)
const { io } = require('socket.io-client')
const breq = createRequire(new URL('../backend/package.json', import.meta.url))
const { ObjectId } = breq('mongodb')

process.env.QC_RANDOM_XFF ??= '1'
const LABEL = process.env.LABEL ?? 'run'
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const SOCKET = process.env.SOCKET ?? 'http://localhost:8080/realtime'
const OUT = new URL('./.profile-runs/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null }

// ---------- đo phía Mongo ----------
async function serverTxn() {
  const { admin } = await mongo()
  const s = await admin.command({ serverStatus: 1 })
  return { started: Number(s.transactions.totalStarted), committed: Number(s.transactions.totalCommitted), aborted: Number(s.transactions.totalAborted) }
}

async function profilerOn(dbs) {
  const m = await mongo()
  for (const d of dbs) {
    const db = m[d]
    await db.command({ profile: 0 })
    await db.collection('system.profile').drop().catch(() => {})
    await db.createCollection('system.profile', { capped: true, size: 256 * 1024 * 1024 })
    await db.command({ profile: 2 })
  }
}

async function profilerOff(dbs, colls) {
  const m = await mongo()
  const rows = []
  for (const d of dbs) {
    const db = m[d]
    await db.command({ profile: 0 })
    // Chỉ các collection của kịch bản: cron unread, outbox poller, heartbeat
    // partition cũng chạy trong cửa sổ đo và không được tính vào thao tác.
    const ns = colls ? { $in: colls.map((c) => `${db.databaseName}.${c}`) } : { $not: /system\.|qc_fixture|_migrations/ }
    rows.push(...(await db.collection('system.profile').find({ $or: [{ ns }, { 'command.commitTransaction': { $exists: true } }, { 'command.abortTransaction': { $exists: true } }] }).toArray()))
    await db.collection('system.profile').drop().catch(() => {})
  }
  return summarize(rows)
}

function summarize(rows) {
  const groups = {}
  let txnOps = 0
  for (const o of rows) {
    if (o.txnNumber !== undefined) txnOps++
    const cmd = o.command ?? {}
    const verb = Object.keys(cmd)[0] ?? o.op
    if (['commitTransaction', 'abortTransaction', 'endSessions', 'hello', 'ping'].includes(verb)) continue
    const coll = o.ns.split('.').slice(1).join('.')
    const stages = (cmd.pipeline ?? []).map((s) => Object.keys(s)[0])
    const key = `${coll} ${verb}`
    const g = (groups[key] ??= { coll, verb, n: 0, keys: 0, docs: 0, ms: 0, ret: 0, plans: new Set(), lookup: false, txn: 0 })
    g.n++
    g.keys += o.keysExamined ?? 0
    g.docs += o.docsExamined ?? 0
    g.ms += o.millis ?? 0
    g.ret += o.nreturned ?? o.nModified ?? o.ninserted ?? o.ndeleted ?? 0
    if (o.planSummary) g.plans.add(o.planSummary.slice(0, 90))
    if (stages.includes('$lookup')) g.lookup = true
    if (o.txnNumber !== undefined) g.txn++
  }
  const list = Object.values(groups).map((g) => ({ ...g, plans: [...g.plans] })).sort((a, b) => b.docs - a.docs || b.ms - a.ms)
  return {
    commands: list.reduce((a, g) => a + g.n, 0),
    keys: list.reduce((a, g) => a + g.keys, 0),
    docs: list.reduce((a, g) => a + g.docs, 0),
    dbMs: list.reduce((a, g) => a + g.ms, 0),
    txnOps,
    collscan: list.some((g) => g.plans.some((p) => p.startsWith('COLLSCAN'))),
    lookup: list.some((g) => g.lookup),
    groups: list,
  }
}

/**
 * Chạy `op` `n` lần không bật profiler để lấy wall-clock, rồi `profiled` lần
 * có profiler để lấy số liệu DB. Số liệu DB chia cho số lượt => "mỗi thao tác".
 */
let rateLimited = false
async function measure(id, { dbs, colls, n, op, profiled = Math.min(5, n), setup, settle = 0 }) {
  if (ONLY && !ONLY.has(id)) return null
  process.stdout.write(`▶ ${id} … `)
  const ctx = setup ? await setup() : {}
  const wall = []
  let error = null
  try {
    await op(ctx, -1) // lượt khởi động: không tính
    for (let i = 0; i < n; i++) {
      const t = performance.now()
      await op(ctx, i)
      wall.push(performance.now() - t)
    }
    if (settle) await sleep(settle)
    const t0 = await serverTxn()
    await profilerOn(dbs)
    for (let i = 0; i < profiled; i++) await op(ctx, n + i)
    if (settle) await sleep(settle)
    const db = await profilerOff(dbs, colls)
    const t1 = await serverTxn()
    const per = (x) => Math.round((x / profiled) * 10) / 10
    const rec = {
      id, n, profiled,
      wallP50: pct(wall, 50), wallP95: pct(wall, 95),
      perOp: { commands: per(db.commands), keys: per(db.keys), docs: per(db.docs), dbMs: per(db.dbMs), txnOps: per(db.txnOps), txnStarted: per(t1.started - t0.started), txnAborted: per(t1.aborted - t0.aborted) },
      collscan: db.collscan, lookup: db.lookup, groups: db.groups,
    }
    console.log(`p50 ${rec.wallP50?.toFixed(1)}ms · ${rec.perOp.commands} lệnh · ${rec.perOp.docs} docs · ${rec.perOp.txnStarted} txn/thao tác${rec.lookup ? ' · $lookup' : ''}${rec.collscan ? ' · COLLSCAN' : ''}`)
    return rec
  } catch (e) {
    if (e?.status === 429) rateLimited = true
    error = e?.status === 429 ? 'rate-limited' : String(e?.message ?? e).slice(0, 300)
    console.log(`LỖI: ${error}`)
    return { id, error }
  }
}

// ---------- socket ----------
async function connect(account) {
  const socket = io(SOCKET, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: account.cookie } })
  await new Promise((res, rej) => { socket.once('connect', res); socket.once('connect_error', rej) })
  return socket
}

/** Gửi tin qua socket và chờ ACK; trả về tin đã lưu. */
function sendAndAck(socket, payload) {
  return new Promise((res, rej) => {
    const clientMessageId = `qcp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const onAck = (p) => { if (p.clientMessageId === clientMessageId) { socket.off('message:ack', onAck); res(p.message) } }
    socket.on('message:ack', onAck)
    socket.emit('message:create', { ...payload, clientMessageId })
    setTimeout(() => rej(new Error('ack timeout')), 15000)
  })
}

// ---------- kịch bản ----------
async function main() {
  const fx = await ensureFixtures()
  const { chat } = await mongo()
  const results = []
  const push = (r) => r && results.push(r)
  const G = fx.groupId

  for (const kind of ['MEDIA', 'DOC', 'LINK']) {
    push(await measure(`assets-${kind.toLowerCase()}`, {
      dbs: ['chat'], colls: ['message', 'messageMedia', 'conversationMember', 'DeleteMessage', 'poll', 'pollVote'], n: 10,
      op: async () => {
        const p1 = await api(fx.a, 'GET', `/chat/assets?conversationId=${G}&kind=${kind}&limit=30`)
        if (!p1.items.length) throw new Error(`tab ${kind} rỗng`)
        if (p1.nextCursor) await api(fx.a, 'GET', `/chat/assets?conversationId=${G}&kind=${kind}&limit=30&cursor=${encodeURIComponent(p1.nextCursor)}`)
      },
    }))
  }

  push(await measure('history-first', {
    dbs: ['chat'], colls: ['message', 'messageMedia', 'conversationMember', 'DeleteMessage', 'poll', 'pollVote'], n: 20,
    op: async () => { const p = await api(fx.a, 'GET', `/chat/messages/${G}?limit=50`); if (p.items.length !== 50) throw new Error('trang đầu thiếu tin') },
  }))

  push(await measure('history-deep', {
    dbs: ['chat'], colls: ['message', 'messageMedia', 'conversationMember', 'DeleteMessage', 'poll', 'pollVote'], n: 10,
    setup: async () => {
      // Đi 60 trang (3.000 tin) để lấy cursor ở độ sâu đó — đúng như người dùng cuộn lên.
      let cursor = null
      for (let i = 0; i < 60; i++) {
        const p = await api(fx.a, 'GET', `/chat/messages/${G}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        cursor = p.nextCursor
      }
      return { cursor }
    },
    op: async ({ cursor }) => { const p = await api(fx.a, 'GET', `/chat/messages/${G}?limit=50&cursor=${encodeURIComponent(cursor)}`); if (p.items.length !== 50) throw new Error('trang sâu thiếu tin') },
  }))

  push(await measure('read', {
    dbs: ['chat'], colls: ['message', 'conversationMember'], n: 30, profiled: 10, settle: 1500,
    setup: async () => {
      // B gửi 42 tin mới; A đọc lần lượt từ cũ tới mới, mỗi lần một id MỚI hơn
      // mốc đang có, để cả hai lần đo đều đi đường "mốc tiến lên".
      const socketB = await connect(fx.b)
      const ids = []
      for (let i = 0; i < 42; i++) ids.push((await sendAndAck(socketB, { conversationId: G, type: 'TEXT', content: `qcp đọc ${i}` })).id)
      socketB.close()
      return { socket: await connect(fx.a), ids }
    },
    op: async ({ socket, ids }, i) => { socket.emit('message:read', { conversationId: G, lastMessageId: ids[i + 1] }); await sleep(120) },
  }))

  push(await measure('mention', {
    dbs: ['chat'], colls: ['message', 'conversationMember', 'conversation'], n: 10, profiled: 5,
    setup: async () => ({ socket: await connect(fx.b) }),
    op: async ({ socket }) => { await sendAndAck(socket, { conversationId: G, type: 'TEXT', content: `@${fx.a.username} qcp nhắc` }) },
  }))

  push(await measure('friends-list', { dbs: ['user'], colls: ['Friendship', 'friendRequest', 'User'], n: 20, op: async () => { await api(fx.a, 'GET', '/user/list-friends?limit=50') } }))
  push(await measure('friends-search', { dbs: ['user'], colls: ['Friendship', 'friendRequest', 'User'], n: 20, op: async () => { await api(fx.a, 'GET', '/user/search?keyword=qcpfake1') } }))
  push(await measure('friend-requests', {
    dbs: ['user'], colls: ['Friendship', 'friendRequest', 'User'], n: 20,
    op: async () => { await api(fx.a, 'GET', '/user/list-friend-requests?direction=received&limit=50'); await api(fx.a, 'GET', '/user/list-friend-requests?direction=sent&limit=50') },
  }))
  push(await measure('friendship-between', { dbs: ['user'], colls: ['Friendship', 'friendRequest', 'User'], n: 20, op: async () => { await api(fx.a, 'GET', `/user?userId=${fx.b.id}`) } }))

  push(await measure('add-members', {
    dbs: ['chat'], colls: ['conversationMember', 'conversation', 'message'], n: 2, profiled: 1,
    op: async () => {
      const g = await api(fx.a, 'POST', '/chat/create', { groupName: `QCP thêm ${Date.now().toString(36)}`, memberIds: [fx.b.id, fx.c.id] })
      await api(fx.a, 'POST', '/chat/add-member', { conversationId: g.id, memberIds: fx.extraIds })
    },
  }))

  if (!ONLY || ONLY.has('delete-group')) {
    const D = await ensureDeleteGroup(fx)
    const before = await chat.collection('message').countDocuments({ conversationId: new ObjectId(D) })
    process.stdout.write(`▶ delete-group (${before} tin) … `)
    const t0 = await serverTxn()
    await profilerOn(['chat'])
    const start = performance.now()
    let apiMs = null
    let error = null
    try { await api(fx.a, 'POST', '/chat/delete-conversation', { conversationId: D }); apiMs = performance.now() - start } catch (e) { error = String(e.message).slice(0, 300) }
    // Tới khi D biến khỏi danh sách của B, và tới khi DB hết tin của D (tối đa 5 phút).
    let hiddenMs = null
    let purgedMs = null
    while (performance.now() - start < 300_000) {
      if (hiddenMs === null) {
        const list = await api(fx.b, 'GET', '/chat/conversations?limit=100')
        if (!list.items.some((c) => c.id === D)) hiddenMs = performance.now() - start
      }
      const left = await chat.collection('message').countDocuments({ conversationId: new ObjectId(D) })
      if (left === 0 && hiddenMs !== null) { purgedMs = performance.now() - start; break }
      if (error && performance.now() - start > 30_000) break
      await sleep(500)
    }
    const db = await profilerOff(['chat'], ['message', 'messageMedia', 'DeleteMessage', 'poll', 'pollVote', 'conversation', 'conversationMember'])
    const t1 = await serverTxn()
    const left = await chat.collection('message').countDocuments({ conversationId: new ObjectId(D) })
    const rec = { id: 'delete-group', messages: before, apiMs, hiddenMs, purgedMs, left, error, perOp: { commands: db.commands, docs: db.docs, dbMs: db.dbMs, txnStarted: t1.started - t0.started, txnAborted: t1.aborted - t0.aborted }, groups: db.groups.slice(0, 8) }
    console.log(error ? `LỖI ${error} · còn ${left} tin` : `API ${apiMs?.toFixed(0)}ms · ẩn ${hiddenMs?.toFixed(0)}ms · dọn xong ${purgedMs?.toFixed(0)}ms · còn ${left}`)
    results.push(rec)
  }

  for (const [id, mode, rate, sec] of [['cron-load', 'spread', 1000, 20], ['send-spread', 'spread', 2000, 25], ['send-hot', 'hot', 2000, 25]]) {
    if (ONLY && !ONLY.has(id)) continue
    // Ba lần, lấy trung vị: nhiễu của laptop xấp xỉ ngưỡng 10% đang so.
    const runs = []
    for (let k = 0; k < 3; k++) {
      process.stdout.write(`▶ ${id} #${k + 1} … `)
      const t0 = await serverTxn()
      const out = execFileSync('node', ['throughput.mjs'], {
        cwd: new URL('.', import.meta.url).pathname,
        env: { ...process.env, MODE: mode, STAGES: JSON.stringify([{ name: id, rate, sec }]) },
        maxBuffer: 64 * 1024 * 1024,
      }).toString()
      const t1 = await serverTxn()
      const row = out.split('\n').find((l) => l.startsWith('│') && l.includes(`'${id}'`)) ?? ''
      const cells = row.split('│').map((c) => c.trim())
      const summary = JSON.parse((out.match(/\{"sent".*\}/) ?? ['{}'])[0])
      const r = { stored: Number(cells[4]), ackP95: Number(cells[5]), summary, txnStarted: t1.started - t0.started, txnAborted: t1.aborted - t0.aborted }
      console.log(`${r.stored} msg/s · ack p95 ${r.ackP95}ms · txn ${r.txnStarted} (abort ${r.txnAborted}) · lost ${summary.lost ?? '?'} · reorder ${summary.reorder ?? '?'}`)
      runs.push(r)
    }
    const med = (f) => pct(runs.map(f), 50)
    results.push({
      id, mode, rate, sec, runs,
      stored: med((r) => r.stored), ackP95: med((r) => r.ackP95), txnStarted: med((r) => r.txnStarted), txnAborted: med((r) => r.txnAborted),
      summary: { lost: Math.max(...runs.map((r) => r.summary.lost ?? 0)), reorder: Math.max(...runs.map((r) => r.summary.reorder ?? 0)) },
    })
  }

  if (rateLimited) console.log('⚠ có kịch bản bị 429: lần chạy này KHÔNG hợp lệ')
  const file = `${OUT}${LABEL}.json`
  const prev = (() => { try { return JSON.parse(require('node:fs').readFileSync(file, 'utf8')) } catch { return null } })()
  const merged = ONLY && prev ? { ...prev, results: [...prev.results.filter((r) => !ONLY.has(r.id)), ...results] } : { label: LABEL, at: new Date().toISOString(), results }
  writeFileSync(file, JSON.stringify(merged, null, 2))
  console.log(`→ ${file}`)
  await closeMongo()
  process.exit(0)
}

main().catch(async (e) => { console.error(e); await closeMongo(); process.exit(1) })
