/**
 * Đo thông lượng gửi tin của đường chat.send có partition, kèm số đo tài nguyên
 * mỗi giây để biết điểm gãy nằm ở đâu.
 *
 *   MODE=hot    node throughput.mjs   # 1 nhóm, 2 người cùng gửi: trần của MỘT hội thoại (= một partition)
 *   MODE=spread node throughput.mjs   # 64 nhóm, đúng 4 nhóm mỗi partition, 16 người gửi + 16 người nhận
 *   STAGES='[{"name":"r1000","rate":1000,"sec":30}]' MODE=spread node throughput.mjs
 *   CHECK_ONLY=<run> node throughput.mjs  # kiểm lại DB cho một lần chạy đã lưu
 *
 * Mỗi giây ghi: CPU từng container (docker stats), CPU của chính k6, tin đang
 * nằm trong 16 queue, và từ Mongo: số insert, cache WiredTiger, số page phải đọc
 * từ đĩa lên cache; RAM khả dụng và swap của máy ảo Docker. Sau khi chạy, đếm
 * trong DB: mất, đảo thứ tự.
 * Kết quả: .scale-runs/throughput-<run>.json và một bảng theo từng nấc.
 */
import { spawn, execSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { register, api } from './calls-fixtures.mjs'

const MODE = process.env.MODE ?? 'spread'
const RUN = process.env.CHECK_ONLY ?? `${MODE}-${Date.now().toString(36)}`
const DIR = new URL('./.scale-runs/', import.meta.url).pathname
const FIXTURES = `${DIR}throughput-fixtures-${MODE}.json`
const PARTITIONS = 16
const GROUPS_PER_PARTITION = 4
const SENDERS = 16
const DIRECT = process.env.DIRECT ?? 'http://localhost:3002'
const DEFAULT_STAGES = {
  hot: [500, 1000, 1500, 2000, 2500, 3000].map((rate) => ({ name: `r${rate}`, rate, sec: 30 })),
  spread: [1000, 2000, 3000, 4000, 5000, 6000].map((rate) => ({ name: `r${rate}`, rate, sec: 30 })),
}
const STAGES = process.env.STAGES ? JSON.parse(process.env.STAGES) : DEFAULT_STAGES[MODE]
const WARMUP_SEC = 5 // bỏ 5 giây đầu mỗi nấc khi lấy trung bình
const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
const clearRateLimits = () =>
  sh(`docker exec daln-redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`)

function partitionOf(id) {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(id)) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % PARTITIONS
}

async function user(tag) {
  clearRateLimits()
  const u = await register(tag)
  return { id: u.id, email: u.email, account: u }
}

/** Dựng một lần rồi dùng lại: đăng ký tài khoản và tạo nhóm qua API thật. */
async function buildFixtures() {
  if (existsSync(FIXTURES)) return JSON.parse(readFileSync(FIXTURES, 'utf8'))
  const offline = await user('off')
  let users
  let vus
  if (MODE === 'hot') {
    const [a, b] = [await user('h1'), await user('h2')]
    const g = await api(a.account, 'POST', '/chat/create', { groupName: 'lt hot', memberIds: [b.id, offline.id] })
    users = [a, b, offline]
    vus = [
      { userId: a.id, share: 0.5, groups: [g.id] },
      { userId: b.id, share: 0.5, groups: [g.id] },
    ]
  } else {
    const senders = []
    const receivers = []
    for (let i = 0; i < SENDERS; i++) {
      senders.push(await user(`s${i}`))
      receivers.push(await user(`r${i}`))
    }
    const buckets = Array.from({ length: PARTITIONS }, () => [])
    const groupsOf = senders.map(() => [])
    for (let i = 0; buckets.some((b) => b.length < GROUPS_PER_PARTITION); i++) {
      const k = i % SENDERS
      const g = await api(senders[k].account, 'POST', '/chat/create', {
        groupName: `lt spread ${i}`,
        memberIds: [receivers[k].id, offline.id],
      })
      const p = partitionOf(g.id)
      if (buckets[p].length >= GROUPS_PER_PARTITION) continue
      buckets[p].push(g.id)
      groupsOf[k].push(g.id)
    }
    const total = PARTITIONS * GROUPS_PER_PARTITION
    users = [...senders, ...receivers, offline]
    vus = [
      ...senders.map((s, k) => ({ userId: s.id, share: groupsOf[k].length / total, groups: groupsOf[k] })),
      ...receivers.map((r) => ({ userId: r.id, share: 0, groups: [] })),
    ]
  }
  const fixtures = {
    password: 'MatKhau123',
    users: users.map(({ id, email }) => ({ id, email })),
    vus,
  }
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FIXTURES, JSON.stringify(fixtures, null, 2))
  return fixtures
}

/** Bộ đo chạy song song: mỗi nguồn đẩy mẫu {t, ...} vào `samples`. */
function startSamplers(samples, k6Pid) {
  const procs = []
  const stats = spawn('docker', ['stats', '--format', '{{json .}}'])
  let buf = ''
  stats.stdout.on('data', (d) => {
    buf += d.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      const json = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()
      if (!json.startsWith('{')) continue
      const s = JSON.parse(json)
      samples.push({ t: Date.now(), src: 'cpu', name: s.Name, cpu: parseFloat(s.CPUPerc) })
    }
  })
  procs.push(stats)

  const mongoLoop = `
    let p = db.serverStatus()
    while (true) {
      sleep(1000)
      const s = db.serverStatus(), c = s.wiredTiger.cache, pc = p.wiredTiger.cache
      print(JSON.stringify({
        ins: s.opcounters.insert - p.opcounters.insert,
        cacheMB: c['bytes currently in the cache'] / 1e6,
        dirtyMB: c['tracked dirty bytes in the cache'] / 1e6,
        readIn: c['pages read into cache'] - pc['pages read into cache'],
        evicted: c['unmodified pages evicted'] + c['modified pages evicted'] - pc['unmodified pages evicted'] - pc['modified pages evicted'],
      }))
      p = s
    }`
  const mongo = spawn('docker', ['exec', 'daln-mongo', 'mongosh', 'chat-service', '--quiet', '--eval', mongoLoop])
  let mbuf = ''
  mongo.stdout.on('data', (d) => {
    mbuf += d.toString()
    const lines = mbuf.split('\n')
    mbuf = lines.pop()
    for (const line of lines) if (line.startsWith('{')) samples.push({ t: Date.now(), src: 'mongo', ...JSON.parse(line) })
  })
  procs.push(mongo)

  // Bộ nhớ của cả máy ảo Docker (mọi container dùng chung): thiếu RAM thì kernel
  // kill tiến trình nặng nhất — đã đo được Mongo và RabbitMQ bị kill như vậy.
  const mem = spawn('docker', [
    'exec',
    'daln-redis',
    'sh',
    '-c',
    'while true; do grep -E "MemAvailable|SwapTotal|SwapFree" /proc/meminfo | tr -s " " | paste -sd" "; sleep 1; done',
  ])
  mem.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      const kb = (name) => Number(line.match(new RegExp(`${name}: (\\d+)`))?.[1])
      if (!line.includes('MemAvailable')) continue
      samples.push({
        t: Date.now(),
        src: 'mem',
        availMB: kb('MemAvailable') / 1024,
        swapUsedMB: (kb('SwapTotal') - kb('SwapFree')) / 1024,
      })
    }
  })
  procs.push(mem)

  const auth = 'Basic ' + Buffer.from('user:user').toString('base64')
  const timer = setInterval(async () => {
    try {
      const qs = await (
        await fetch('http://localhost:15672/api/queues/%2F?columns=name,messages_ready,messages_unacknowledged', {
          headers: { Authorization: auth },
        })
      ).json()
      const send = qs.filter((q) => q.name.startsWith('chat.send.p'))
      samples.push({
        t: Date.now(),
        src: 'queue',
        ready: send.reduce((a, q) => a + (q.messages_ready ?? 0), 0),
        unacked: send.reduce((a, q) => a + (q.messages_unacknowledged ?? 0), 0),
      })
    } catch {}
    try {
      samples.push({ t: Date.now(), src: 'k6cpu', cpu: Number(sh(`ps -o %cpu= -p ${k6Pid}`)) })
    } catch {}
  }, 1000)
  return () => {
    clearInterval(timer)
    for (const p of procs) p.kill()
  }
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const max = (xs) => (xs.length ? Math.max(...xs) : 0)

function summarize(samples, t0, k6) {
  const rows = []
  let at = t0
  for (const stage of STAGES) {
    const from = at + WARMUP_SEC * 1000
    const to = at + stage.sec * 1000
    at = to
    const win = samples.filter((s) => s.t >= from && s.t < to)
    const cpuOf = (re) => {
      const byName = {}
      for (const s of win.filter((s) => s.src === 'cpu' && re.test(s.name))) (byName[s.name] ??= []).push(s.cpu)
      return Object.values(byName).map(avg)
    }
    const all = {}
    for (const s of win.filter((s) => s.src === 'cpu')) (all[s.name] ??= []).push(s.cpu)
    const m = win.filter((s) => s.src === 'mongo')
    const q = win.filter((s) => s.src === 'queue')
    const metric = (name, stat) => k6.metrics[`${name}{stage:${stage.name}}`]?.[stat]
    rows.push({
      stage: stage.name,
      target: stage.rate,
      stored: Math.round(avg(m.map((s) => s.ins))),
      ackP95: Math.round(metric('ack_latency', 'p(95)') ?? NaN),
      ackP99: Math.round(metric('ack_latency', 'p(99)') ?? NaN),
      deliverP95: Math.round(metric('deliver_latency', 'p(95)') ?? NaN),
      queueMax: max(q.map((s) => s.ready + s.unacked)),
      chatCpu: cpuOf(/^daln-chat/).map(Math.round),
      gwCpu: cpuOf(/^daln-realtime/).map(Math.round),
      mongoCpu: Math.round(avg(cpuOf(/^daln-mongo$/))),
      kongCpu: Math.round(avg(cpuOf(/^daln-kong$/))),
      rabbitCpu: Math.round(avg(cpuOf(/^daln-rabbitmq$/))),
      dockerCpu: Math.round(Object.values(all).map(avg).reduce((a, b) => a + b, 0)),
      k6Cpu: Math.round(avg(win.filter((s) => s.src === 'k6cpu').map((s) => s.cpu))),
      mongoCacheMB: Math.round(max(m.map((s) => s.cacheMB))),
      mongoReadIn: Math.round(avg(m.map((s) => s.readIn))),
      memAvailMinMB: Math.round(Math.min(...win.filter((s) => s.src === 'mem').map((s) => s.availMB))),
      swapUsedMaxMB: Math.round(max(win.filter((s) => s.src === 'mem').map((s) => s.swapUsedMB))),
    })
  }
  return rows
}

function checkDb() {
  const js = `
    const last = {}
    let reorder = 0
    let stored = 0
    db.message.find({ clientMessageId: { $regex: '^lt-${RUN}-' } }, { clientMessageId: 1, conversationId: 1 })
      .sort({ conversationId: 1, createdAt: 1, _id: 1 })
      .forEach((d) => {
        stored++
        const [, , , , vu, seq] = d.clientMessageId.split('-')
        const key = d.conversationId + ':' + vu
        if (last[key] !== undefined && Number(seq) < last[key]) reorder++
        last[key] = Number(seq)
      })
    const s = db.message.stats()
    print(JSON.stringify({ stored, reorder, collectionDocs: s.count, indexMB: Math.round(s.totalIndexSize / 1e6) }))`
  return JSON.parse(execFileSync('docker', ['exec', 'daln-mongo', 'mongosh', 'chat-service', '--quiet', '--eval', js]).toString())
}

if (process.env.CHECK_ONLY) {
  // Chạy lại riêng bước kiểm DB cho một lần chạy đã lưu (vd. sau khi queue rút hết).
  const saved = JSON.parse(readFileSync(`${DIR}throughput-${RUN}.json`, 'utf8'))
  const k6Summary = JSON.parse(readFileSync(`${DIR}throughput-${RUN}.k6.json`, 'utf8'))
  const count = (name) => k6Summary.metrics[name]?.count ?? 0
  const db = checkDb()
  console.log(JSON.stringify({ run: RUN, sent: count('sent'), failed: count('failed'), ...db, lost: count('sent') - count('failed') - db.stored }))
  process.exit(0)
}

const fixtures = await buildFixtures()
const cookies = {}
for (const u of fixtures.users) {
  clearRateLimits()
  // Đăng nhập thẳng vào service user: Kong giới hạn 200 request/phút mỗi IP cho /user.
  const res = await fetch(`${DIRECT}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: fixtures.password }),
  })
  if (!res.ok) throw new Error(`login ${u.email} -> ${res.status}`)
  cookies[u.id] = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}
const COOKIES = `${DIR}throughput-cookies-${MODE}.json`
writeFileSync(COOKIES, JSON.stringify(cookies))
const t0 = Date.now() + 20000
const summaryFile = `${DIR}throughput-${RUN}.k6.json`
console.log(`run=${RUN} vus=${fixtures.vus.length} stages=${STAGES.map((s) => s.rate).join(',')} start in 20s`)
const k6 = spawn(
  'k6',
  ['run', '--quiet', '--summary-export', summaryFile, new URL('./throughput.k6.js', import.meta.url).pathname],
  {
    env: {
      ...process.env,
      FIXTURES,
      COOKIES,
      RUN,
      T0: String(t0),
      STAGES: JSON.stringify(STAGES),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
)
const samples = []
const stop = startSamplers(samples, k6.pid)
await new Promise((r) => k6.on('exit', r))
await new Promise((r) => setTimeout(r, 3000))
stop()

const k6Summary = JSON.parse(readFileSync(summaryFile, 'utf8'))
const rows = summarize(samples, t0, k6Summary)
writeFileSync(`${DIR}throughput-${RUN}.json`, JSON.stringify({ run: RUN, mode: MODE, t0, stages: STAGES, rows, samples }))
console.table(rows)
const db = checkDb()
const count = (name) => k6Summary.metrics[name]?.count ?? 0
const totals = {
  sent: count('sent'),
  acked: count('acked'),
  failed: count('failed'),
  timeouts: count('ack_timeouts'),
  ...db,
  lost: count('sent') - count('failed') - db.stored,
}
writeFileSync(`${DIR}throughput-${RUN}.json`, JSON.stringify({ run: RUN, mode: MODE, t0, stages: STAGES, rows, totals, samples }))
console.log(JSON.stringify(totals))
