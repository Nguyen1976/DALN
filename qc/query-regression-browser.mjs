/**
 * QC trình duyệt hồi quy cho mọi tính năng dùng chung các truy vấn được tối ưu
 * (plan docs/superpowers/plans/2026-11-04-query-enhancements.md, Task 9).
 *
 *   node qc/query-regression-browser.mjs            # mọi kịch bản
 *   ONLY=B3,B4 node qc/query-regression-browser.mjs
 *
 * A và B mỗi người một Chrome, đăng nhập qua form như người dùng thật. Hành
 * động của "người kia" (B/C gửi tin, trả lời, nhắc tên) chạy qua socket thật từ
 * Node để thời điểm xác định; mọi phép kiểm đọc thứ người dùng THẤY trong
 * trình duyệt (và DB khi kiểm việc dọn dữ liệu). Tài khoản mới mỗi lần chạy.
 *
 * Cần: stack dev, Vite ở 5174, Chrome.
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { api, befriend, fixtures, register } from './calls-fixtures.mjs'

process.env.QC_RANDOM_XFF ??= '1'
const require = createRequire(import.meta.url)
const { io } = require('socket.io-client')
const breq = createRequire(new URL('../backend/package.json', import.meta.url))
const { MongoClient, ObjectId } = breq('mongodb')

const APP = process.env.APP ?? 'http://localhost:5174'
const SOCKET = process.env.SOCKET ?? 'http://localhost:8080/realtime'
const CHAT_DIRECT = process.env.CHAT_DIRECT ?? 'http://localhost:3003'
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token-doi-o-production'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const results = []
let current = ''
const check = (cond, label, detail = '') => {
  results.push({ scenario: current, label, pass: Boolean(cond), detail: cond ? '' : String(detail) })
  console.log(`  ${cond ? '✅' : '❌'} ${label}${!cond && detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 15000, step = 300) {
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

/** Trang danh sách hội thoại (route `/`). */
async function openHome(page) {
  await page.goto(`${APP}/`, { waitUntil: 'networkidle2' })
  await sleep(600)
  if (page.url().includes('/onboarding')) {
    await skipOnboarding(page)
    await page.goto(`${APP}/`, { waitUntil: 'networkidle2' })
  }
  await page.waitForSelector('[aria-label="Tìm cuộc trò chuyện"]', { timeout: 15000 })
  await sleep(500)
}

async function openConversation(page, id) {
  await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  await sleep(600)
  if (page.url().includes('/onboarding')) {
    await skipOnboarding(page)
    await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  }
  await page.waitForSelector('textarea[aria-label="Nhập tin nhắn"]', { timeout: 15000 })
  await sleep(500)
}

async function typeAndSend(page, content) {
  const box = await page.$('textarea[aria-label="Nhập tin nhắn"]')
  await box.click()
  await box.type(content)
  await page.click('[aria-label="Gửi tin nhắn"]')
}

/** Nội dung các bong bóng tin theo thứ tự trên màn hình (trên xuống dưới). */
const thread = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[id^="message-"]')].map((el) => el.innerText))
/** Vị trí đầu tiên của từng chuỗi trong khung chat; -1 nếu không có. */
const positions = (page, needles) =>
  page.evaluate((ns) => {
    const items = [...document.querySelectorAll('[id^="message-"]')].map((el) => el.innerText)
    return ns.map((n) => items.findIndex((t) => t.includes(n)))
  }, needles)
const countIn = (page, needle) =>
  page.evaluate((n) => [...document.querySelectorAll('[id^="message-"]')].filter((el) => el.innerText.includes(n)).length, needle)
const sidebarItem = (page, conversationId) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-conversation-id="${id}"]`)
    if (!el) return null
    return {
      unread: Number(el.getAttribute('data-unread') ?? 0),
      text: el.innerText,
      mention: el.querySelector('[aria-label^="Bạn được nhắc"]')?.getAttribute('aria-label') ?? null,
    }
  }, conversationId)
const seenBy = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-seen-by]')].map((el) => el.getAttribute('data-seen-by')).join(','))

/** Kéo khung chat lên đầu cho tới khi `needle` xuất hiện (tải trang cũ hơn). */
async function scrollUpUntil(page, needle, maxRounds = 40) {
  for (let i = 0; i < maxRounds; i++) {
    if ((await countIn(page, needle)) > 0) return true
    await page.evaluate(() => {
      const first = document.querySelector('[id^="message-"]')
      let el = first?.parentElement
      while (el && el.scrollHeight <= el.clientHeight + 4) el = el.parentElement
      if (el) el.scrollTop = 0
      first?.scrollIntoView({ block: 'start' })
    })
    await sleep(700)
  }
  return (await countIn(page, needle)) > 0
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}qr-${name}.png` }).catch(() => {})
}

/** Ngắt / nối lại đúng socket mà app đang dùng (module của Vite dev). */
const setSocket = (page, on) =>
  page.evaluate(async (connect) => {
    const { socket } = await import('/src/lib/socket.ts')
    if (connect) socket.connect()
    else socket.disconnect()
    return socket.connected
  }, on)

// ---------- socket từ Node ----------
async function connect(account) {
  const s = io(SOCKET, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: account.cookie } })
  await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej) })
  return s
}
function send(s, conversationId, content, extra = {}) {
  return new Promise((res, rej) => {
    const clientMessageId = `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const onAck = (p) => { if (p.clientMessageId === clientMessageId) { s.off('message:ack', onAck); res(p.message) } }
    s.on('message:ack', onAck)
    s.emit('message:create', { conversationId, type: 'TEXT', content, clientMessageId, ...extra })
    setTimeout(() => rej(new Error(`ack timeout: ${content}`)), 15000)
  })
}

// ---------- kịch bản ----------
const scenarios = []
const scenario = (id, title, fn) => scenarios.push({ id, title, fn })

scenario('B1', 'Gửi/nhận hai chiều đúng thứ tự, tải lại vẫn đúng', async ({ A, B, fx }) => {
  await openConversation(A.page, fx.directId)
  await openConversation(B.page, fx.directId)
  const tags = ['qr1-a', 'qr1-b', 'qr1-c'].map((t) => `${t}-${Date.now().toString(36)}`)
  for (const t of tags) { await typeAndSend(A.page, t); await sleep(400) }
  const onB = await until(async () => (await positions(B.page, tags)).every((p) => p >= 0) && positions(B.page, tags), 10000)
  check(onB && onB[0] < onB[1] && onB[1] < onB[2], 'B nhận đủ 3 tin của A, đúng thứ tự', JSON.stringify(onB))
  const reply = `qr1-reply-${Date.now().toString(36)}`
  await typeAndSend(B.page, reply)
  const onA = await until(async () => (await positions(A.page, [...tags, reply])).every((p) => p >= 0) && positions(A.page, [...tags, reply]), 10000)
  check(onA && onA[2] < onA[3], 'A thấy tin trả lời của B nằm sau 3 tin của mình', JSON.stringify(onA))
  await A.page.reload({ waitUntil: 'networkidle2' })
  const afterReload = await until(async () => (await positions(A.page, [...tags, reply])).every((p) => p >= 0) && positions(A.page, [...tags, reply]), 10000)
  check(afterReload && afterReload.every((p, i, a) => i === 0 || a[i - 1] < p), 'Sau khi tải lại, lịch sử giữ đúng thứ tự', JSON.stringify(afterReload))
})

scenario('B2', 'Cuộn lên tải trang cũ hơn: đủ, không trùng, không hụt', async ({ A, fx, sockB }) => {
  const g = await api(fx.a, 'POST', '/chat/create', { groupName: `QR trang ${Date.now().toString(36)}`, memberIds: [fx.b.id, fx.c.id] })
  const tag = `qr2-${Date.now().toString(36)}`
  for (let i = 0; i < 120; i++) await send(sockB, g.id, `${tag}-${String(i).padStart(3, '0')}`)
  await openConversation(A.page, g.id)
  const reached = await scrollUpUntil(A.page, `${tag}-000`)
  check(reached, 'Cuộn lên tới tin đầu tiên (#000)')
  const texts = (await thread(A.page)).map((t) => (t.match(new RegExp(`${tag}-(\\d{3})`)) ?? [])[1]).filter(Boolean)
  const nums = texts.map(Number)
  check(new Set(nums).size === 120, 'Đủ 120 tin, không trùng', `có ${new Set(nums).size} tin khác nhau / ${nums.length} bong bóng`)
  check(nums.every((n, i) => i === 0 || nums[i - 1] < n), 'Thứ tự tăng dần từ trên xuống')
  await shot(A.page, 'B2-pages')
})

scenario('B3', 'Badge chưa đọc, đọc về 0, tin của mình không tính, "đã xem"', async ({ A, B, fx, sockB }) => {
  await openConversation(A.page, fx.directId) // A đứng ở hội thoại khác, không phải G
  const tag = `qr3-${Date.now().toString(36)}`
  for (let i = 0; i < 7; i++) await send(sockB, fx.groupId, `${tag}-${i}`)
  const live = await until(async () => (await sidebarItem(A.page, fx.groupId))?.unread === 7 && 7, 12000)
  check(live === 7, 'Badge G = 7 ngay khi tin tới', JSON.stringify(await sidebarItem(A.page, fx.groupId)))
  await sleep(6500) // cron ghi xuống Mongo
  await A.page.reload({ waitUntil: 'networkidle2' })
  const persisted = await until(async () => (await sidebarItem(A.page, fx.groupId))?.unread, 8000)
  check(persisted === 7, 'Sau khi tải lại vẫn là 7 (đọc từ DB)', `thấy ${persisted}`)
  await openConversation(A.page, fx.groupId)
  await openConversation(B.page, fx.groupId)
  const zero = await until(async () => (await sidebarItem(A.page, fx.groupId))?.unread === 0, 8000)
  check(zero, 'Mở hội thoại thì badge về 0')
  const seen = await until(async () => (await seenBy(B.page)).includes(fx.a.id), 10000)
  check(seen, 'B thấy dấu "đã xem" của A')
  await typeAndSend(A.page, `${tag}-mine`)
  await sleep(6500)
  await A.page.goto(`${APP}/chat/${fx.directId}`, { waitUntil: 'networkidle2' })
  const own = await until(async () => { const it = await sidebarItem(A.page, fx.groupId); return it ? String(it.unread) : null }, 8000)
  check(own === '0', 'Tin A tự gửi không làm tăng badge của A (sau cron, sau tải lại)', `thấy ${own}`)
  await B.page.reload({ waitUntil: 'networkidle2' })
  const seenAfterReload = await until(async () => (await seenBy(B.page)).includes(fx.a.id), 10000)
  check(seenAfterReload, '"Đã xem" vẫn còn sau khi B tải lại trang (B15)')
})

scenario('B4', 'Mất kết nối rồi nối lại: tự lấy bù tin, không cần tải lại', async ({ A, fx, sockB }) => {
  await openConversation(A.page, fx.directId)
  await setSocket(A.page, false)
  await sleep(800)
  const tag = `qr4-${Date.now().toString(36)}`
  const tags = []
  for (let i = 0; i < 5; i++) { tags.push(`${tag}-${i}`); await send(sockB, fx.directId, `${tag}-${i}`) }
  await sleep(1500)
  check((await countIn(A.page, tag)) === 0, 'Trong lúc mất kết nối A chưa thấy tin (đúng là bị lỡ)')
  await setSocket(A.page, true)
  const got = await until(async () => (await positions(A.page, tags)).every((p) => p >= 0) && positions(A.page, tags), 8000)
  check(got && got.every((p, i, a) => i === 0 || a[i - 1] < p), 'Nối lại: đủ 5 tin bị lỡ, đúng thứ tự, không tải lại trang', JSON.stringify(got ?? (await positions(A.page, tags))))
  await shot(A.page, 'B4-resync')
})

scenario('B5', 'Trả lời rồi gửi thường liền nhau: tin cuối ở danh sách luôn là tin thường', async ({ A, fx, sockB }) => {
  await openConversation(A.page, fx.groupId)
  const anchor = await send(sockB, fx.directId, `qr5-anchor-${Date.now().toString(36)}`)
  let wrongLive = 0
  let last = ''
  for (let i = 0; i < 5; i++) {
    const plain = `qr5-plain-${i}-${Date.now().toString(36)}`
    sockB.emit('message:create', { conversationId: fx.directId, type: 'TEXT', content: `qr5-reply-${i}`, replyToMessageId: anchor.id, clientMessageId: `qr5r-${i}-${Date.now()}` })
    await send(sockB, fx.directId, plain)
    last = plain
    await sleep(800)
    const item = await sidebarItem(A.page, fx.directId)
    if (!item?.text.includes(plain)) wrongLive++
  }
  check(wrongLive === 0, 'Danh sách hội thoại của A luôn hiện tin thường là tin cuối', `${wrongLive}/5 lần sai`)
  await sleep(6500)
  await A.page.reload({ waitUntil: 'networkidle2' })
  const afterReload = await until(async () => (await sidebarItem(A.page, fx.directId))?.text, 8000)
  check(String(afterReload).includes(last), 'Sau khi tải lại (đọc từ DB) vẫn là tin thường cuối cùng', String(afterReload).slice(0, 120))
})

scenario('B6', 'Nhắc tên: badge nhắc, đọc thì tắt', async ({ A, fx, sockB }) => {
  await openConversation(A.page, fx.directId)
  await send(sockB, fx.groupId, `@${fx.a.username} qr6 nhắc bạn`)
  const mention = await until(async () => (await sidebarItem(A.page, fx.groupId))?.mention, 10000)
  check(Boolean(mention), 'A có badge nhắc ở hội thoại G', String(mention))
  await openConversation(A.page, fx.groupId)
  await sleep(1500)
  await A.page.goto(`${APP}/chat/${fx.directId}`, { waitUntil: 'networkidle2' })
  const cleared = await until(async () => { const it = await sidebarItem(A.page, fx.groupId); return it && !it.mention }, 8000)
  check(cleared, 'Đọc xong thì badge nhắc tắt (cả sau khi tải lại)')
})

scenario('B7', 'Tab Ảnh/Video, Tài liệu, Liên kết + tải thêm + lightbox + đi tới tin', async ({ A, fx, sockB }) => {
  const g = await api(fx.a, 'POST', '/chat/create', { groupName: `QR tài nguyên ${Date.now().toString(36)}`, memberIds: [fx.b.id, fx.c.id] })
  // Ảnh và file qua đúng luồng của app: presign -> PUT lên MinIO -> gửi tin.
  const upload = async (type, name, mime, bytes) => {
    const pre = await api(fx.a, 'POST', '/chat/media/presign', { conversationId: g.id, type, fileName: name, mimeType: mime, size: String(bytes.length) })
    const putRes = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })
    if (!putRes.ok) throw new Error(`PUT ${putRes.status}`)
    return pre
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const sockA = await connect(fx.a)
  const firstLink = await send(sockB, g.id, `qr7-link-first https://example.com/first`)
  for (let i = 0; i < 34; i++) await send(sockB, g.id, `qr7-link-${i} https://example.com/${i}`)
  for (let i = 0; i < 40; i++) await send(sockB, g.id, `qr7-filler-${i}`)
  let mediaOk = true
  try {
    const img = await upload('IMAGE', 'qr7.png', 'image/png', png)
    await send(sockA, g.id, 'qr7-image', { type: 'IMAGE', medias: [{ objectKey: img.objectKey, mediaType: 'IMAGE', mimeType: 'image/png', size: String(png.length), fileName: 'qr7.png', url: img.publicUrl, sortOrder: 0 }] })
    const doc = await upload('FILE', 'qr7-tai-lieu.pdf', 'application/pdf', Buffer.from('%PDF-1.4 qr7'))
    await send(sockA, g.id, 'qr7-file', { type: 'FILE', medias: [{ objectKey: doc.objectKey, mediaType: 'FILE', mimeType: 'application/pdf', size: '12', fileName: 'qr7-tai-lieu.pdf', url: doc.publicUrl, sortOrder: 0 }] })
  } catch (e) { mediaOk = false; check(false, 'Tải ảnh/file lên qua presign', e.message) }
  sockA.close()
  if (mediaOk) check(true, 'Tải ảnh và file lên qua presign + gửi tin media')

  await openConversation(A.page, g.id)
  await A.page.click('[aria-label="Thông tin cuộc trò chuyện"]')
  await sleep(1200)
  const tab = async (label) => {
    await A.page.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === l)?.click(), label)
    await sleep(1500)
  }
  const panelText = () => A.page.evaluate(() => document.body.innerText)
  await tab('Ảnh/Video')
  const mediaImgs = await A.page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => /qr7|qc|localhost:9000|minio/.test(i.src)).length)
  check(mediaImgs > 0, 'Tab Ảnh/Video có ảnh vừa gửi', `${mediaImgs} ảnh`)
  await tab('Tài liệu')
  check((await panelText()).includes('qr7-tai-lieu.pdf'), 'Tab Tài liệu có file vừa gửi')
  await tab('Liên kết')
  const linksPage1 = (await panelText()).match(/example\.com\/\d+/g)?.length ?? 0
  check(linksPage1 > 0, 'Tab Liên kết có link', `${linksPage1} link`)
  // Tải thêm: cuộn danh sách trong panel tới cuối cho tới khi thấy link đầu tiên.
  const sawFirst = await until(async () => {
    await A.page.evaluate(() => document.querySelectorAll('[data-asset-list], .overflow-y-auto').forEach((el) => { el.scrollTop = el.scrollHeight }))
    await A.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Tải thêm|Xem thêm/.test(b.innerText))?.click())
    return (await panelText()).includes('example.com/first')
  }, 15000, 800)
  check(sawFirst, 'Tab Liên kết tải thêm được trang sau (thấy link cũ nhất)')
  // Đi tới tin từ tab: link cũ nhất nằm trước 40 tin filler -> phải tải thêm lịch sử.
  await A.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('example.com/first'))?.click())
  const jumped = await until(async () => A.page.evaluate((id) => Boolean(document.getElementById(`message-${id}`)), firstLink.id), 20000)
  if (!jumped) await shot(A.page, 'B7-jump-fail')
  check(jumped, 'Bấm link trong tab thì khung chat nhảy tới tin gốc (B13)')
  await tab('Ảnh/Video')
  const opened = await A.page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find((i) => /localhost:9000|minio|qr7/.test(i.src))
    img?.closest('button')?.click()
    return Boolean(img)
  })
  const lightbox = opened && (await until(async () => A.page.$('[aria-label="Tới tin nhắn gốc"]'), 6000))
  check(Boolean(lightbox), 'Mở ảnh thì lightbox hiện, có nút "Tới tin nhắn gốc" (B13)')
  if (lightbox) {
    await A.page.click('[aria-label="Tới tin nhắn gốc"]')
    const there = await until(async () => (await countIn(A.page, 'qr7-image')) > 0 || A.page.evaluate(() => [...document.querySelectorAll('[id^="message-"] img')].length > 0), 8000)
    check(there, 'Từ lightbox nhảy về đúng tin ảnh')
  }
  await shot(A.page, 'B7-assets')
})

scenario('B8', 'Thêm/xoá/thêm lại thành viên, xoá nhóm', async ({ A, B, fx, sockB }) => {
  // Nhóm cần ít nhất 3 người: A, B và D; C là người được thêm/xoá/thêm lại.
  const d = await register('d8')
  await befriend(fx.a, d)
  const g = await api(fx.a, 'POST', '/chat/create', { groupName: `QR thành viên ${Date.now().toString(36)}`, memberIds: [fx.b.id, d.id] })
  for (let i = 0; i < 5; i++) await send(sockB, g.id, `qr8-before-${i}`)
  await api(fx.a, 'POST', '/chat/add-member', { conversationId: g.id, memberIds: [fx.c.id] })
  await openConversation(A.page, g.id)
  const sys = await until(async () => (await A.page.evaluate(() => document.body.innerText)).includes('đã thêm 1 thành viên'), 8000)
  check(sys, 'Tin hệ thống "đã thêm 1 thành viên" hiện trong khung chat')
  await A.page.click('[aria-label="Thông tin cuộc trò chuyện"]')
  check(await until(async () => A.page.$('[aria-label="Xem 4 thành viên nhóm"]'), 8000), 'Số thành viên hiện 4 (panel thông tin)')
  await A.page.click('[aria-label="Đóng bảng thông tin"]').catch(() => {})
  const cConv = async () => (await api(fx.c, 'GET', '/chat/conversations?limit=50')).items.find((x) => x.id === g.id)
  await sleep(6500) // qua một nhịp cron: số đọc từ DB mới có nghĩa
  check((await cConv())?.unreadCount === 0, 'C vừa vào nhóm có unread 0 (không bị tính 5 tin cũ)', JSON.stringify((await cConv())?.unreadCount))
  await api(fx.a, 'POST', '/chat/remove-member', { conversationId: g.id, targetUserId: fx.c.id })
  for (let i = 0; i < 4; i++) await send(sockB, g.id, `qr8-while-removed-${i}`)
  await api(fx.a, 'POST', '/chat/add-member', { conversationId: g.id, memberIds: [fx.c.id] })
  await sleep(6500)
  check((await cConv())?.unreadCount === 0, 'C vào lại nhóm có unread 0', JSON.stringify((await cConv())?.unreadCount))
  // Xoá nhóm: biến mất ở cả hai phía, DB không còn tin.
  await openConversation(B.page, g.id)
  await api(fx.a, 'POST', '/chat/delete-conversation', { conversationId: g.id })
  const goneA = await until(async () => !(await api(fx.a, 'GET', '/chat/conversations?limit=100')).items.some((x) => x.id === g.id), 10000)
  const goneB = await until(async () => !(await api(fx.b, 'GET', '/chat/conversations?limit=100')).items.some((x) => x.id === g.id), 10000)
  check(goneA && goneB, 'Nhóm đã xoá biến khỏi danh sách của A và B')
  await openHome(B.page)
  check(await until(async () => !(await sidebarItem(B.page, g.id)), 8000), 'Sidebar của B không còn nhóm đã xoá')
  let refused = false
  try { await send(sockB, g.id, 'qr8-after-delete') } catch { refused = true }
  const cli = await new MongoClient('mongodb://localhost:27017/?replicaSet=rs0&directConnection=true').connect()
  const purged = await until(async () => (await cli.db('chat-service').collection('message').countDocuments({ conversationId: new ObjectId(g.id) })) === 0, 60000, 1000)
  await cli.close()
  check(purged, 'DB không còn tin nào của nhóm đã xoá (≤ 60 s)')
  check(refused, 'Gửi tin vào nhóm đã xoá bị từ chối')
})

scenario('B9', 'Poll, thu hồi, xoá phía mình, xoá lịch sử, log cuộc gọi', async ({ A, B, fx, sockB }) => {
  const g = await api(fx.a, 'POST', '/chat/create', { groupName: `QR khác ${Date.now().toString(36)}`, memberIds: [fx.b.id, fx.c.id] })
  const poll = await api(fx.b, 'POST', '/chat/polls', { conversationId: g.id, question: 'qr9 ăn gì?', options: ['Phở', 'Bún'] })
  await openConversation(A.page, g.id)
  check(await until(async () => (await A.page.evaluate(() => document.body.innerText)).includes('qr9 ăn gì?'), 8000), 'A thấy poll của B')
  const pollId = poll?.poll?.id ?? poll?.id ?? poll?.message?.poll?.id
  const optionId = (poll?.poll ?? poll?.message?.poll ?? poll)?.options?.[0]?.id
  try { await api(fx.a, 'POST', '/chat/polls/vote', { pollId, optionIds: [optionId] }); check(true, 'A bỏ phiếu được') } catch (e) { check(false, 'A bỏ phiếu được', e.message) }
  const toRevoke = await send(sockB, g.id, 'qr9-sẽ-thu-hồi')
  await api(fx.b, 'POST', '/chat/messages/revoke', { conversationId: g.id, messageId: toRevoke.id })
  check(await until(async () => (await countIn(A.page, 'qr9-sẽ-thu-hồi')) === 0, 8000), 'Tin bị thu hồi không còn nội dung ở phía A')
  const mine = await send(sockB, g.id, 'qr9-xoá-phía-A')
  await api(fx.a, 'POST', '/chat/messages/delete-for-me', { conversationId: g.id, messageId: mine.id })
  await A.page.reload({ waitUntil: 'networkidle2' })
  await sleep(1000)
  check((await countIn(A.page, 'qr9-xoá-phía-A')) === 0, 'Tin "xoá phía mình" không hiện lại với A sau khi tải lại')
  await openConversation(B.page, g.id)
  check((await countIn(B.page, 'qr9-xoá-phía-A')) === 1, 'B vẫn thấy tin đó')
  // Log cuộc gọi (đường ghi riêng, không qua batch writer).
  const res = await fetch(`${CHAT_DIRECT}/chat/internal/group-call-log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
    body: JSON.stringify({ conversationId: g.id, participantCount: 2, durationSeconds: 75, callId: `qr9-${Date.now()}`, callType: 'audio', startedBy: fx.b.id }),
  })
  check(res.ok, 'Ghi log cuộc gọi nhóm qua API nội bộ', `${res.status} ${await res.text().catch(() => '')}`.slice(0, 160))
  check(await until(async () => /Cuộc gọi|cuộc gọi/.test(await A.page.evaluate(() => [...document.querySelectorAll('[id^="message-"]')].map((e) => e.innerText).join('\n'))), 8000), 'A thấy thẻ cuộc gọi trong khung chat (B14)')
  // Xoá lịch sử phía A rồi B gửi tin mới.
  await api(fx.a, 'POST', '/chat/conversations/clear-history', { conversationId: g.id })
  await send(sockB, g.id, 'qr9-sau-khi-xoá-lịch-sử')
  await A.page.reload({ waitUntil: 'networkidle2' })
  await until(async () => (await countIn(A.page, 'qr9-sau-khi-xoá-lịch-sử')) > 0, 8000)
  await scrollUpUntil(A.page, 'qr9 ăn gì?', 4)
  const leaked = (await countIn(A.page, 'qr9 ăn gì?')) + (await countIn(A.page, 'qr9-xoá-phía-A'))
  check((await countIn(A.page, 'qr9-sau-khi-xoá-lịch-sử')) === 1 && leaked === 0, 'Sau khi xoá lịch sử: chỉ thấy tin mới, cuộn lên không thấy tin cũ (B10)', `leaked=${leaked}`)
  // Mất kết nối rồi nối lại cũng không kéo tin cũ về.
  await setSocket(A.page, false)
  await send(sockB, g.id, 'qr9-trong-lúc-offline')
  await setSocket(A.page, true)
  await until(async () => (await countIn(A.page, 'qr9-trong-lúc-offline')) > 0, 8000)
  check((await countIn(A.page, 'qr9 ăn gì?')) + (await countIn(A.page, 'qr9-xoá-phía-A')) === 0, 'Lấy bù sau khi nối lại không kéo tin đã xoá về (B10)')
})

scenario('B11', 'Bạn bè: danh sách, tìm, lời mời (nhận/từ chối/chấp nhận)', async ({ A, fx }) => {
  const list = await api(fx.a, 'GET', '/user/list-friends?limit=50')
  const ids = (list.items ?? list).map((f) => f.id ?? f.userId)
  check(ids.includes(fx.b.id) && ids.includes(fx.c.id), 'Danh sách bạn của A có B và C')
  const found = await api(fx.a, 'GET', `/user/search?keyword=${encodeURIComponent(fx.b.username.slice(0, 8))}`)
  check((found.items ?? found).some((f) => (f.id ?? f.userId) === fx.b.id), 'Tìm bạn theo tiền tố username ra B')
  const d = await register('d')
  await api(d, 'POST', '/user/make-friend-by-username', { username: fx.a.username })
  const received = await api(fx.a, 'GET', '/user/list-friend-requests?direction=received')
  const req = (received.items ?? received).find((r) => (r.counterpart?.id ?? r.fromUserId ?? r.sender?.id) === d.id) ?? (received.items ?? received)[0]
  check(Boolean(req), 'A thấy lời mời của D trong danh sách nhận')
  const sent = await api(d, 'GET', '/user/list-friend-requests?direction=sent')
  check((sent.items ?? sent).length >= 1, 'D thấy lời mời trong danh sách đã gửi')
  await api(fx.a, 'POST', `/user/friend-requests/${req.id}/respond`, { status: 'REJECTED' })
  const after = await api(fx.a, 'GET', '/user/list-friend-requests?direction=received')
  check(!(after.items ?? after).some((r) => r.id === req.id), 'Từ chối xong thì lời mời biến mất (B16)')
  const e = await register('e')
  const conv = await befriend(e, fx.a)
  check(Boolean(conv), 'Chấp nhận lời mời của E thì có hội thoại DIRECT')
  const profile = await api(fx.a, 'GET', `/user?userId=${e.id}`)
  check(Boolean(profile.email), 'Bạn mới thấy được email của nhau (findFriendshipBetweenUsers)')
  await openHome(A.page)
  check(await until(async () => Boolean(await sidebarItem(A.page, conv)), 10000), 'Hội thoại với E hiện trong sidebar của A')
})

scenario('B12', 'Tìm nhóm theo tên ở thanh tìm kiếm', async ({ A, fx }) => {
  await openHome(A.page)
  const box = await A.page.waitForSelector('[aria-label="Tìm cuộc trò chuyện"]', { timeout: 8000 })
  await box.click({ clickCount: 3 })
  await box.type(fx.groupName.slice(0, 10))
  const hit = await until(async () => (await A.page.evaluate(() => document.body.innerText)).includes(fx.groupName), 8000)
  check(hit, 'Gõ tên nhóm thì nhóm hiện trong kết quả')
})

scenario('B15', 'Bộ lọc "Chưa đọc" ở sidebar', async ({ A, fx, sockB }) => {
  await A.page.goto(`${APP}/chat/${fx.directId}`, { waitUntil: 'networkidle2' })
  await send(sockB, fx.groupId, `qr15-${Date.now().toString(36)}`)
  await until(async () => (await sidebarItem(A.page, fx.groupId))?.unread > 0, 8000)
  await A.page.click('[aria-label="Lọc cuộc trò chuyện"]')
  await sleep(400)
  await A.page.evaluate(() => [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button, [role="tab"]')].find((b) => /Chưa đọc/.test(b.innerText))?.click())
  await sleep(800)
  const items = await A.page.evaluate(() => [...document.querySelectorAll('[data-conversation-id]')].map((el) => ({ id: el.getAttribute('data-conversation-id'), unread: Number(el.getAttribute('data-unread')) })))
  check(items.some((i) => i.id === fx.groupId) && items.every((i) => i.unread > 0 || i.id === fx.directId), 'Lọc "Chưa đọc" chỉ còn hội thoại có tin chưa đọc', JSON.stringify(items))
})

async function main() {
  console.log('Dựng tài khoản A, B, C (bạn bè + nhóm)...')
  const fx = await fixtures()
  const A = await openBrowser(fx.a)
  const B = await openBrowser(fx.b)
  const sockB = await connect(fx.b)
  for (const s of scenarios) {
    if (ONLY && !ONLY.has(s.id)) continue
    current = s.id
    console.log(`\n${s.id} · ${s.title}`)
    try { await s.fn({ A, B, fx, sockB }) } catch (e) {
      check(false, `${s.id} chạy hết kịch bản`, e.message)
      await shot(A.page, `${s.id}-error`)
    }
  }
  sockB.close()
  await A.browser.close()
  await B.browser.close()
  const failed = results.filter((r) => !r.pass)
  const out = new URL(`./.profile-runs/browser-${process.env.LABEL ?? 'run'}.json`, import.meta.url).pathname
  mkdirSync(new URL('./.profile-runs/', import.meta.url).pathname, { recursive: true })
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  console.log(`\n${results.length - failed.length}/${results.length} PASS → ${out}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
