/**
 * QC đồng bộ chat: lấy bù khi mất đúng một sự kiện, tab thứ hai của người gửi,
 * preview sau khi thu hồi, quyền vào room của hội thoại.
 *
 *   node qc/chat-sync-browser.mjs
 *   ONLY=S1,S4 node qc/chat-sync-browser.mjs
 *
 * Cần: stack dev, Vite ở 5174, Chrome. Tài khoản mới mỗi lần chạy.
 */
import puppeteer from 'puppeteer-core'
import { createRequire } from 'node:module'
import { api, befriend, fixtures, register } from './calls-fixtures.mjs'

process.env.QC_RANDOM_XFF ??= '1'
const require = createRequire(import.meta.url)
const { io } = require('socket.io-client')

const APP = process.env.APP ?? 'http://localhost:5174'
const SOCKET = process.env.SOCKET ?? 'http://localhost:8080/realtime'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const REVOKED_PREVIEW = 'Tin nhắn đã bị thu hồi'
/** Lâu hơn một nhịp cron unread (5 giây) ghi tin cuối xuống Mongo. */
const CRON_MS = 6500
const SCENARIO_MS = 60000

const results = []
let current = ''
const check = (cond, label, detail = '') => {
  results.push({ scenario: current, label, pass: Boolean(cond) })
  console.log(`  ${cond ? '✅' : '❌'} ${label}${!cond && detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
async function until(fn, ms = 8000, step = 200) {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last } catch {}
    await sleep(step)
  }
  return last ?? false
}

// ---------- trình duyệt ----------
async function skipOnboarding(page) {
  if (!page.url().includes('/onboarding')) return
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Bỏ qua/.test(b.textContent ?? ''))?.click())
  await until(async () => !page.url().includes('/onboarding'), 10000)
}

async function openBrowser(account) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860 })
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('input[name="email"]', { timeout: 15000 })
  await page.type('input[name="email"]', account.email)
  await page.type('input[name="password"]', account.password)
  await page.click('button[type="submit"]')
  await until(async () => !page.url().includes('/auth'), 20000)
  await sleep(1200)
  await skipOnboarding(page)
  return { browser, page }
}

async function openConversation(page, id) {
  await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  await sleep(600)
  if (page.url().includes('/onboarding')) {
    await skipOnboarding(page)
    await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  }
  await page.waitForSelector('textarea[aria-label="Nhập tin nhắn"]', { timeout: 15000 })
  await sleep(800)
}

async function typeAndSend(page, content) {
  // Tab nền không nhận click (S2 có hai tab trong một trình duyệt).
  await page.bringToFront()
  const box = await page.$('textarea[aria-label="Nhập tin nhắn"]')
  await box.click()
  await box.type(content)
  await page.click('[aria-label="Gửi tin nhắn"]')
}

const countIn = (page, needle) =>
  page.evaluate((n) => [...document.querySelectorAll('[id^="message-"]')].filter((el) => el.innerText.includes(n)).length, needle)
const positions = (page, needles) =>
  page.evaluate((ns) => {
    const items = [...document.querySelectorAll('[id^="message-"]')].map((el) => el.innerText)
    return ns.map((n) => items.findIndex((t) => t.includes(n)))
  }, needles)
const sidebarText = (page, conversationId) =>
  page.evaluate((id) => document.querySelector(`[data-conversation-id="${id}"]`)?.innerText ?? null, conversationId)
const inOrder = (p) => p.every((v, i) => v >= 0 && (i === 0 || p[i - 1] < v))

/** Mất đúng một sự kiện: socket của app bỏ qua `event` có nội dung chứa `needle`. */
const dropEvent = (page, event, needle) =>
  page.evaluate(async (ev, n) => {
    const { socket } = await import('/src/lib/socket.ts')
    const original = socket.onevent
    socket.onevent = function (packet) {
      const [name, payload] = packet.data
      if (name === ev && payload?.message?.content?.includes(n)) {
        socket.onevent = original
        return
      }
      return original.call(this, packet)
    }
  }, event, needle)

/** Ghi lại mọi tin server trả về cho các lần lấy bù (`afterSeq`). */
const countSyncRequests = (page) => {
  const seen = []
  page.on('request', (r) => {
    const m = /afterSeq=(\d+)/.exec(r.url())
    if (m) seen.push(Number(m[1]))
  })
  return seen
}

// ---------- socket từ Node ----------
async function connect(account) {
  const s = io(SOCKET, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: account.cookie } })
  await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej) })
  return s
}
function send(s, conversationId, content) {
  return new Promise((res, rej) => {
    const clientMessageId = `cs-${uid()}`
    const timer = setTimeout(() => rej(new Error(`ack timeout: ${content}`)), 15000)
    const onAck = (p) => {
      if (p.clientMessageId !== clientMessageId) return
      clearTimeout(timer)
      s.off('message:ack', onAck)
      res(p.message)
    }
    s.on('message:ack', onAck)
    s.emit('message:create', { conversationId, type: 'TEXT', content, clientMessageId })
  })
}
/** Các sự kiện `event` mà socket `s` nhận được, gom vào một mảng. */
const collect = (s, event) => {
  const got = []
  s.on(event, (p) => got.push(p))
  return got
}
const previewOf = async (account, conversationId) => {
  const c = await api(account, 'GET', `/chat/conversations/${conversationId}`)
  return c?.lastMessageText ?? c?.conversation?.lastMessageText
}

// ---------- kịch bản ----------
const scenarios = []
const scenario = (id, title, fn) => scenarios.push({ id, title, fn })

scenario('S1', 'Mất đúng một tin: tin sau nhảy cóc thì lấy bù được tin mất', async ({ A, fx, sockB }) => {
  await openConversation(A.page, fx.directId)
  const syncs = countSyncRequests(A.page)
  const tag = `s1-${uid()}`
  const [one, lost, three] = [`${tag}-one`, `${tag}-lost`, `${tag}-three`]
  await send(sockB, fx.directId, one)
  await until(async () => (await countIn(A.page, one)) === 1)
  await dropEvent(A.page, 'message:new', lost)
  const first = await send(sockB, fx.directId, lost)
  await sleep(600)
  check((await countIn(A.page, lost)) === 0, 'Tiền đề: sự kiện đã bị mất, A chưa thấy tin')
  await send(sockB, fx.directId, three)
  const recovered = await until(async () => (await countIn(A.page, lost)) === 1, 6000)
  check(recovered, 'A tự lấy lại được tin bị mất, không tải lại trang', `afterSeq đã gửi: ${JSON.stringify(syncs)}, tin mất có seq ${first.seq}`)
  check(inOrder(await positions(A.page, [one, lost, three])), 'Ba tin đúng thứ tự', JSON.stringify(await positions(A.page, [one, lost, three])))
  check((await countIn(A.page, three)) === 1, 'Tin nhảy cóc không bị trùng')
})

scenario('S1b', 'Mất tin rồi chính mình gửi tiếp (ACK nhảy cóc): vẫn lấy bù được', async ({ A, fx, sockB }) => {
  await openConversation(A.page, fx.directId)
  const tag = `s1b-${uid()}`
  const [lost, mine] = [`${tag}-lost`, `${tag}-mine`]
  await dropEvent(A.page, 'message:new', lost)
  await send(sockB, fx.directId, lost)
  await sleep(500)
  await typeAndSend(A.page, mine)
  const recovered = await until(async () => (await countIn(A.page, lost)) === 1, 6000)
  check(recovered, 'ACK có seq nhảy cóc cũng kích hoạt lấy bù')
  check(inOrder(await positions(A.page, [lost, mine])), 'Tin bị mất nằm trước tin của mình', JSON.stringify(await positions(A.page, [lost, mine])))
})

scenario('S1c', 'Hai khoảng trống liên tiếp, cách nhau hơn nhịp gom: lấy đủ cả hai', async ({ A, fx, sockB }) => {
  await openConversation(A.page, fx.directId)
  const tag = `s1c-${uid()}`
  const [lost1, mid, lost2, end] = ['l1', 'mid', 'l2', 'end'].map((t) => `${tag}-${t}`)
  await dropEvent(A.page, 'message:new', lost1)
  await send(sockB, fx.directId, lost1)
  await send(sockB, fx.directId, mid)
  await until(async () => (await countIn(A.page, mid)) === 1)
  await dropEvent(A.page, 'message:new', lost2)
  await send(sockB, fx.directId, lost2)
  await send(sockB, fx.directId, end)
  const all = [lost1, mid, lost2, end]
  const done = await until(async () => inOrder(await positions(A.page, all)), 6000)
  check(done, 'Đủ cả hai tin bị mất, đúng thứ tự', JSON.stringify(await positions(A.page, all)))
})

scenario('S2', 'Tab thứ hai của người gửi thấy tin vừa gửi', async ({ A, fx, sockB }) => {
  await openConversation(A.page, fx.directId)
  const tab2 = await A.browser.newPage()
  await tab2.setViewport({ width: 1280, height: 860 })
  await openConversation(tab2, fx.directId)
  const tag = `s2-${uid()}`
  await typeAndSend(A.page, tag)
  const shown = await until(async () => (await countIn(tab2, tag)) === 1, 5000)
  check(shown, 'Tab 2 thấy tin gửi từ tab 1', `tab 2 có ${await countIn(tab2, tag)} bản`)
  check((await countIn(A.page, tag)) === 1, 'Tab 1 vẫn đúng một bản')
  // Tiền tố khác: `countIn` tìm theo chuỗi con, `${tag}-peer` sẽ khớp cả `tag`.
  const after = `s2peer-${uid()}`
  await send(sockB, fx.directId, after)
  const both = await until(async () => inOrder(await positions(tab2, [tag, after])), 5000)
  check(both, 'Tin sau của người kia nằm sau tin đó ở tab 2', JSON.stringify(await positions(tab2, [tag, after])))
  check((await countIn(tab2, tag)) === 1, 'Tab 2 không bị trùng sau khi có tin mới')
  await tab2.close()
})

scenario('S3', 'Thu hồi tin cuối đã ghi xuống DB: preview không còn nội dung cũ', async ({ B, fx, sockA }) => {
  await openConversation(B.page, fx.directId)
  const secret = `s3-secret-${uid()}`
  const message = await send(sockA, fx.directId, secret)
  await sleep(CRON_MS)
  check((await previewOf(fx.b, fx.directId)) === secret, 'Tiền đề: preview trong DB là tin vừa gửi', await previewOf(fx.b, fx.directId))
  await api(fx.a, 'POST', '/chat/messages/revoke', { conversationId: fx.directId, messageId: message.id })
  const stored = await previewOf(fx.b, fx.directId)
  check(stored === REVOKED_PREVIEW, 'API trả preview "đã thu hồi"', stored)
  await B.page.reload({ waitUntil: 'networkidle2' })
  const text = await until(() => sidebarText(B.page, fx.directId))
  check(text && !text.includes(secret) && text.includes(REVOKED_PREVIEW), 'Sidebar sau khi tải lại không còn nội dung đã thu hồi', text)
})

scenario('S3b', 'Thu hồi ngay sau khi gửi, trước nhịp cron: cron không ghi đè', async ({ B, fx, sockA }) => {
  const secret = `s3b-secret-${uid()}`
  const message = await send(sockA, fx.directId, secret)
  await api(fx.a, 'POST', '/chat/messages/revoke', { conversationId: fx.directId, messageId: message.id })
  await sleep(CRON_MS)
  const stored = await previewOf(fx.b, fx.directId)
  check(stored === REVOKED_PREVIEW, 'Sau nhịp cron preview vẫn là "đã thu hồi"', stored)
  await openConversation(B.page, fx.directId)
  const text = await until(() => sidebarText(B.page, fx.directId))
  check(text && !text.includes(secret), 'Sidebar không có nội dung đã thu hồi', text)
})

scenario('S3c', 'Thu hồi tin cũ hơn tin cuối: tin cuối giữ nguyên', async ({ fx, sockA }) => {
  const older = await send(sockA, fx.directId, `s3c-old-${uid()}`)
  const newest = `s3c-new-${uid()}`
  await send(sockA, fx.directId, newest)
  await api(fx.a, 'POST', '/chat/messages/revoke', { conversationId: fx.directId, messageId: older.id })
  await sleep(CRON_MS)
  check((await previewOf(fx.b, fx.directId)) === newest, 'Preview vẫn là tin mới nhất', await previewOf(fx.b, fx.directId))
  const later = `s3c-later-${uid()}`
  await send(sockA, fx.directId, later)
  await sleep(CRON_MS)
  check((await previewOf(fx.b, fx.directId)) === later, 'Tin gửi sau đó vẫn thành tin cuối', await previewOf(fx.b, fx.directId))
})

scenario('S4', 'Người ngoài không vào được room của hội thoại', async ({ fx, sockA, sockB }) => {
  const outsider = await register('o')
  const sockO = await connect(outsider)
  try {
    const heardTyping = collect(sockO, 'user:typing')
    const heardRead = collect(sockO, 'user:read_batch')
    const aTyping = collect(sockA, 'user:typing')
    const aRead = collect(sockA, 'user:read_batch')
    sockA.emit('conversation:join', { conversationId: fx.groupId })
    sockB.emit('conversation:join', { conversationId: fx.groupId })
    sockO.emit('conversation:join', { conversationId: fx.groupId })
    await sleep(800)

    sockB.emit('user:typing', { conversationId: fx.groupId, status: 'start' })
    const message = await send(sockB, fx.groupId, `s4-${uid()}`)
    sockB.emit('message:read', { conversationId: fx.groupId, lastMessageId: message.id, seq: message.seq })
    await sleep(1800)
    check(aTyping.some((p) => p.userId === fx.b.id), 'Tiền đề: thành viên A nghe được B đang gõ')
    check(aRead.some((p) => p.users?.some((u) => u.userId === fx.b.id)), 'Tiền đề: thành viên A thấy B đã đọc')
    check(heardTyping.length === 0, 'Người ngoài không nghe được đang gõ', JSON.stringify(heardTyping))
    check(heardRead.length === 0, 'Người ngoài không thấy ai đã đọc', JSON.stringify(heardRead))

    aTyping.length = 0
    aRead.length = 0
    sockO.emit('user:typing', { conversationId: fx.groupId, status: 'start' })
    sockO.emit('message:read', { conversationId: fx.groupId, lastMessageId: message.id, seq: 999999 })
    await sleep(1800)
    check(!aTyping.some((p) => p.userId === outsider.id), 'Người ngoài không giả được "đang gõ"', JSON.stringify(aTyping))
    check(!aRead.some((p) => p.users?.some((u) => u.userId === outsider.id)), 'Người ngoài không giả được "đã xem"', JSON.stringify(aRead))
  } finally {
    sockO.disconnect()
  }
})

scenario('S4b', 'Bị xoá khỏi nhóm thì không còn nghe room', async ({ fx, sockA, sockB }) => {
  const group = await api(fx.a, 'POST', '/chat/create', { groupName: `CS ${uid()}`, memberIds: [fx.b.id, fx.c.id] })
  const sockC = await connect(fx.c)
  try {
    const heard = collect(sockC, 'user:typing')
    for (const s of [sockA, sockB, sockC]) s.emit('conversation:join', { conversationId: group.id })
    await sleep(800)
    sockB.emit('user:typing', { conversationId: group.id, status: 'start' })
    await sleep(600)
    check(heard.length === 1, 'Tiền đề: C đang là thành viên thì nghe được', JSON.stringify(heard))

    await api(fx.a, 'POST', '/chat/remove-member', { conversationId: group.id, targetUserId: fx.c.id })
    await sleep(1000)
    heard.length = 0
    sockB.emit('user:typing', { conversationId: group.id, status: 'stop' })
    await sleep(600)
    check(heard.length === 0, 'C bị xoá: socket đang mở không còn nghe room', JSON.stringify(heard))

    sockC.emit('conversation:join', { conversationId: group.id })
    await sleep(600)
    sockB.emit('user:typing', { conversationId: group.id, status: 'start' })
    await sleep(600)
    check(heard.length === 0, 'C bị xoá: join lại cũng bị từ chối', JSON.stringify(heard))
  } finally {
    sockC.disconnect()
  }
})

scenario('S4d', 'Được thêm lại khi đang mở hội thoại: tự vào lại room, không cần tải lại', async ({ fx, sockB }) => {
  const group = await api(fx.a, 'POST', '/chat/create', { groupName: `CS ${uid()}`, memberIds: [fx.b.id, fx.c.id] })
  const C = await openBrowser(fx.c)
  try {
    await openConversation(C.page, group.id)
    await api(fx.a, 'POST', '/chat/remove-member', { conversationId: group.id, targetUserId: fx.c.id })
    await sleep(1500)
    await api(fx.a, 'POST', '/chat/add-member', { conversationId: group.id, memberIds: [fx.c.id] })
    await sleep(1500)
    sockB.emit('conversation:join', { conversationId: group.id })
    await sleep(500)
    sockB.emit('user:typing', { conversationId: group.id, status: 'start' })
    const typing = await until(() => C.page.evaluate(() => /đang (nhập|gõ|soạn)/i.test(document.body.innerText)), 5000)
    check(typing, 'C thấy B đang gõ sau khi được thêm lại')
    sockB.emit('user:typing', { conversationId: group.id, status: 'stop' })
  } finally {
    await C.browser.close()
  }
})

scenario('S4c', 'Mở hội thoại trên trình duyệt: gõ và "đã xem" vẫn hoạt động', async ({ A, B, fx }) => {
  await openConversation(A.page, fx.directId)
  await openConversation(B.page, fx.directId)
  const box = await B.page.$('textarea[aria-label="Nhập tin nhắn"]')
  await box.click()
  await box.type('dang go')
  const typing = await until(() => A.page.evaluate(() => /đang (nhập|gõ|soạn)/i.test(document.body.innerText)), 5000)
  check(typing, 'A thấy B đang gõ')
  await B.page.evaluate(() => document.querySelector('textarea[aria-label="Nhập tin nhắn"]').select())
  await B.page.keyboard.press('Backspace')
  const tag = `s4c-${uid()}`
  await typeAndSend(A.page, tag)
  const seen = await until(() => A.page.evaluate((id) => [...document.querySelectorAll('[data-seen-by]')].some((el) => el.getAttribute('data-seen-by').includes(id)), fx.b.id), 8000)
  check(seen, 'A thấy dấu "đã xem" của B')
})

// ---------- chạy ----------
const fx = await fixtures()
await befriend(fx.b, fx.c).catch(() => {})
const A = await openBrowser(fx.a)
const B = await openBrowser(fx.b)
const sockA = await connect(fx.a)
const sockB = await connect(fx.b)
for (const { id, title, fn } of scenarios) {
  if (ONLY && !ONLY.has(id)) continue
  current = id
  console.log(`\n== ${id}. ${title} ==`)
  try {
    await Promise.race([
      fn({ A, B, fx, sockA, sockB }),
      sleep(SCENARIO_MS).then(() => { throw new Error(`quá ${SCENARIO_MS / 1000} giây`) }),
    ])
  } catch (error) {
    check(false, `kịch bản ném lỗi`, error?.message ?? error)
  }
}
sockA.disconnect()
sockB.disconnect()
await A.browser.close()
await B.browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\nKết quả: ${results.length - failed.length}/${results.length} đạt`)
for (const f of failed) console.log(`  ❌ [${f.scenario}] ${f.label}`)
process.exit(failed.length ? 1 : 0)
