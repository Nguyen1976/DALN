/**
 * QC trình duyệt cho nhiều gateway + nhiều instance chat (spec chat-scale-out §9:
 * kịch bản 7–9, và 2/3/5 qua UI).
 *
 *   node qc/chat-scale-browser.mjs
 *
 * Cần: `docker compose --profile scale up -d` (backend/), Vite ở 5174, Chrome.
 * Ba tài khoản A, B, C mỗi người một Chrome, đăng nhập qua form như người dùng
 * thật. Kịch bản phá hạ tầng (kill/stop container) chạy ngay giữa lúc đang chat,
 * rồi kiểm điều người dùng thấy: tin tới đủ, đúng thứ tự, không trùng.
 */
import puppeteer from 'puppeteer-core'
import { execSync, exec } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { api, fixtures } from './calls-fixtures.mjs'

const require = createRequire(import.meta.url)
const { io } = require('socket.io-client')

const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const GATEWAYS = ['daln-realtime', 'daln-realtime-2', 'daln-realtime-3']
const CHATS = ['daln-chat', 'daln-chat-2', 'daln-chat-3']
const RMQ_AUTH = 'Basic ' + Buffer.from('user:user').toString('base64')

let pass = 0
let fail = 0
const ok = (m) => { console.log(`  ✅ ${m}`); pass++ }
const bad = (m) => { console.log(`  ❌ ${m}`); fail++ }
const check = (cond, label, detail = '') => (cond ? ok(label) : bad(`${label}${detail ? ` — ${detail}` : ''}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
mkdirSync(SHOTS, { recursive: true })

async function until(fn, ms = 15000, step = 250) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return true } catch {}
    await sleep(step)
  }
  return false
}

function partitionOf(id) {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(id)) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0 }
  return h % 16
}

const running = (c) => { try { return sh(`docker inspect -f '{{.State.Running}}' ${c}`) === 'true' } catch { return false } }

async function ensureAll() {
  const since = new Date().toISOString()
  const started = [...GATEWAYS, ...CHATS].filter((c) => !running(c))
  for (const c of started) sh(`docker start ${c}`)
  for (const c of started) await until(() => sh(`docker logs --since ${since} ${c} 2>&1 | grep -c "successfully started" || true`) !== '0', 120000, 1000)
  await until(() => {
    const owners = sh(`docker exec daln-redis redis-cli mget ${Array.from({ length: 16 }, (_, p) => `chat:lease:p${p}`).join(' ')}`).split('\n')
    return owners.every(Boolean) && new Set(owners).size === 3
  }, 60000, 500)
}

/** Container chat đang giữ partition của hội thoại (memberId bắt đầu bằng hostname). */
function chatOwning(conversationId) {
  const owner = sh(`docker exec daln-redis redis-cli get chat:lease:p${partitionOf(conversationId)}`)
  return CHATS.find((c) => owner.startsWith(sh(`docker inspect -f '{{.Config.Hostname}}' ${c}`)))
}

/**
 * Gateway đang giữ socket MỚI NHẤT của user: so dấu thời gian của dòng log
 * "socket connected" cuối cùng ở từng gateway. (Lấy gateway đầu tiên có log là
 * sai: user từng nối vào gateway đó một lần thì luôn bị báo là ở đó.)
 */
function gatewayOf(userId, sinceIso) {
  let best = null
  for (const c of GATEWAYS) {
    if (!running(c)) continue
    const line = sh(`docker logs --timestamps --since ${sinceIso} ${c} 2>&1 | grep "socket connected user=${userId}" | tail -1 || true`)
    const at = line.split(' ')[0]
    if (at && (!best || at > best.at)) best = { c, at }
  }
  return best?.c
}

const onlinePublished = async () => {
  const res = await fetch('http://localhost:15672/api/queues/%2F/user_online_queue', { headers: { Authorization: RMQ_AUTH } })
  return (await res.json()).message_stats?.publish ?? 0
}

// ── Trình duyệt ──────────────────────────────────────────────────────────────

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
  await sleep(1500)
  await skipOnboarding(page)
  return { browser, page }
}

async function openConversation(page, id) {
  await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  await sleep(800)
  if (page.url().includes('/onboarding')) {
    await skipOnboarding(page)
    await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  }
  await page.waitForSelector('textarea[aria-label="Nhập tin nhắn"]', { timeout: 15000 })
  await sleep(500)
}

async function send(page, content) {
  const box = await page.$('textarea[aria-label="Nhập tin nhắn"]')
  await box.click()
  await box.type(content)
  await page.click('[aria-label="Gửi tin nhắn"]')
}

const bodyText = (page) => page.evaluate(() => document.body.innerText)
/** Số bong bóng tin nhắn chứa chuỗi (không tính phần xem trước ở danh sách hội thoại). */
const bubbles = (page, needle) =>
  page.evaluate((n) => [...document.querySelectorAll('[id^="message-"]')].filter((el) => el.innerText.includes(n)).length, needle)

/** Vị trí (theo thứ tự trên màn hình) của tin chứa từng chuỗi; -1 nếu chưa thấy. */
const positions = (page, needles) =>
  page.evaluate((ns) => {
    const items = [...document.querySelectorAll('[id^="message-"]')]
    return ns.map((n) => items.findIndex((el) => el.innerText.includes(n) || el.innerHTML.includes(n)))
  }, needles)

/** Chụp ở chế độ tối (app tự giữ theme trong localStorage, không theo hệ điều hành), 1280px và 375px. */
async function shoot(page, name) {
  const setTheme = async (theme) => {
    await page.evaluate((t) => localStorage.setItem('vite-ui-theme', t), theme)
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(800)
  }
  await setTheme('dark')
  await page.screenshot({ path: `${SHOTS}scale-${name}-1280.png` })
  await page.setViewport({ width: 375, height: 812 })
  await sleep(400)
  await page.screenshot({ path: `${SHOTS}scale-${name}-375.png` })
  await page.setViewport({ width: 1280, height: 860 })
  await setTheme('light')
}

// ── Kịch bản ─────────────────────────────────────────────────────────────────

console.log('== chuẩn bị: 3 gateway, 3 chat, 3 tài khoản')
await ensureAll()
sh(`docker exec daln-redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`)
const fx = await fixtures()
const { a, b, c, groupId } = fx
const since = new Date(Date.now() - 2000).toISOString()
const A = await openBrowser(a)
const B = await openBrowser(b)
const C = await openBrowser(c)
for (const X of [A, B, C]) await openConversation(X.page, groupId)

// Rải B, C ra gateway khác A (Kong chia round-robin; tải lại = socket mới).
let nodeA = gatewayOf(a.id, since)
for (const [X, acc] of [[B, b], [C, c]]) {
  for (let i = 0; i < 10 && gatewayOf(acc.id, since) === nodeA; i++) {
    const t = new Date().toISOString()
    await X.page.reload({ waitUntil: 'networkidle2' })
    await sleep(1500)
    if (gatewayOf(acc.id, t) !== nodeA) break
  }
}
const nodes = { A: gatewayOf(a.id, since), B: gatewayOf(b.id, since), C: gatewayOf(c.id, since) }
console.log(`   A@${nodes.A}  B@${nodes.B}  C@${nodes.C}`)
check(new Set(Object.values(nodes)).size >= 2, 'người dùng nằm ở ít nhất 2 gateway khác nhau', JSON.stringify(nodes))

console.log('\n== 7a. tin qua nhiều gateway')
const hello = `xin chao ${Date.now().toString(36)}`
await send(A.page, hello)
check(await until(async () => (await bodyText(B.page)).includes(hello), 3000), 'B thấy tin của A trong ≤ 3s')
check(await until(async () => (await bodyText(C.page)).includes(hello), 3000), 'C thấy tin của A trong ≤ 3s')
await shoot(B.page, '7a-cross-gateway')

console.log('\n== 7b. đang gõ')
const boxA = await A.page.$('textarea[aria-label="Nhập tin nhắn"]')
await boxA.click()
await boxA.type('đang gõ thử')
check(await until(async () => (await bodyText(B.page)).includes('đang nhập'), 4000), 'B thấy "đang nhập…" của A')
// Xoá chữ thử khỏi ô soạn (React giữ state, nên xoá như người dùng: Backspace).
await boxA.click()
for (let i = 0; i < 'đang gõ thử'.length + 2; i++) await A.page.keyboard.press('Backspace')
check((await A.page.$eval('textarea[aria-label="Nhập tin nhắn"]', (t) => t.value)) === '', 'ô soạn của A đã trống lại')

console.log('\n== 7c. đã xem')
check(await until(async () => /người đã xem/.test(await A.page.evaluate(() => document.body.innerHTML)), 6000), 'A thấy tin đã được xem')

console.log('\n== 7d. online chỉ phát một lần')
const before = await onlinePublished()
const tab2 = await A.browser.newPage()
await tab2.goto(`${APP}/chat/${groupId}`, { waitUntil: 'networkidle2' })
await sleep(12000) // số liệu management API cập nhật ~5s một lần
const delta = (await onlinePublished()) - before
check(delta === 0, 'A mở tab thứ hai: không phát thêm USER_ONLINE', `delta=${delta}`)
await tab2.close()

console.log('\n== 8. gửi ảnh rồi gửi chữ ngay sau đó')
{
  // Gửi ở tầng socket để đo đúng thứ tự phía server: qua UI, ảnh chỉ được emit
  // sau khi upload xong nên chữ gõ sau vẫn tới server trước.
  const png = readFileSync(new URL('../docs/diagrams/message-pipeline.png', import.meta.url))
  const presign = await api(a, 'POST', '/chat/media/presign', { conversationId: groupId, type: 'IMAGE', mimeType: 'image/png', fileName: 'qc.png', size: String(png.length) })
  const put = await fetch(presign.uploadUrl, { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } })
  check(put.ok, 'upload ảnh lên MinIO', `status=${put.status}`)
  const s = io(`${API}/realtime`, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: a.cookie } })
  await new Promise((res) => s.on('connect', res))
  const stamp = Date.now().toString(36)
  const after = `sau anh ${stamp}`
  s.emit('message:create', { conversationId: groupId, type: 'IMAGE', content: '', clientMessageId: `qc-img-${stamp}`, medias: [{ mediaType: 'IMAGE', objectKey: presign.objectKey, url: presign.publicUrl, mimeType: 'image/png', size: String(png.length), fileName: 'qc.png' }] })
  await sleep(1)
  s.emit('message:create', { conversationId: groupId, type: 'TEXT', content: after, clientMessageId: `qc-txt-${stamp}`, medias: [] })
  const seen = await until(async () => (await positions(B.page, [presign.objectKey, after])).every((i) => i >= 0), 8000)
  let [img, txt] = await positions(B.page, [presign.objectKey, after])
  check(seen && img < txt, 'B thấy ảnh nằm trên chữ', `img=${img} txt=${txt}`)
  await B.page.reload({ waitUntil: 'networkidle2' })
  await until(async () => (await positions(B.page, [presign.objectKey, after])).every((i) => i >= 0), 8000)
  ;[img, txt] = await positions(B.page, [presign.objectKey, after])
  check(img >= 0 && img < txt, 'sau khi tải lại, ảnh vẫn nằm trên chữ', `img=${img} txt=${txt}`)
  await shoot(B.page, '8-image-then-text')
  s.close()
}

/** A gửi 5 tin liên tiếp, phá instance chat đang giữ hội thoại, B phải thấy đủ, đúng thứ tự. */
async function burstAcrossChatFailure(label, action, limitMs) {
  const victim = chatOwning(groupId)
  const stamp = Date.now().toString(36)
  const lines = [1, 2, 3, 4, 5].map((i) => `${label} ${stamp} #${i}`)
  // Phá ngay sau tin đầu: 4 tin sau đi xuyên qua lúc bàn giao partition.
  await send(A.page, lines[0])
  const t0 = Date.now()
  action(victim)
  for (const line of lines.slice(1)) await send(A.page, line)
  const arrived = await until(async () => (await positions(B.page, lines)).every((i) => i >= 0), limitMs, 200)
  const took = Date.now() - t0
  const pos = await positions(B.page, lines)
  const counts = await Promise.all(lines.map((l) => bubbles(B.page, l)))
  check(arrived, `B nhận đủ 5 tin sau khi ${label} ${victim} (${took}ms, giới hạn ${limitMs}ms)`)
  check(pos.every((p, i) => i === 0 || p > pos[i - 1]), `${label}: 5 tin đúng thứ tự`, pos.join(','))
  check(counts.every((n) => n === 1), `${label}: không tin nào bị nhân bản`, counts.join(','))
  return victim
}

console.log('\n== 2 (UI). chat crash giữa lúc gửi')
await burstAcrossChatFailure('kill', (v) => exec(`docker kill ${v}`), 15000)
await shoot(B.page, '2-chat-crash')
await ensureAll()

console.log('\n== 3 (UI). chat tắt có chủ đích giữa lúc gửi')
await burstAcrossChatFailure('stop', (v) => exec(`docker stop ${v}`), 5000)
await shoot(B.page, '3-chat-stop')
await ensureAll()

console.log('\n== 5 (UI). gateway của B chết ngay sau khi B gửi')
{
  const t = new Date(Date.now() - 600000).toISOString()
  const gw = gatewayOf(b.id, t)
  const line = `B qua gateway chet ${Date.now().toString(36)}`
  await send(B.page, line)
  await sleep(30)
  sh(`docker kill ${gw}`)
  const arrived = await until(async () => (await bodyText(A.page)).includes(line), 25000, 300)
  check(arrived, `A nhận tin của B sau khi ${gw} chết`)
  await sleep(2000)
  check((await bubbles(A.page, line)) === 1, 'tin của B tới A đúng một lần')
  const bText = await bodyText(B.page)
  check(!bText.includes('Gửi lại'), 'bong bóng của B không ở trạng thái lỗi')
  await shoot(B.page, '5-gateway-crash')
  await ensureAll()
}

console.log('\n== 9. thu hồi phiên khi có nhiều gateway')
{
  const t = new Date(Date.now() - 600000).toISOString()
  const gw = gatewayOf(c.id, t)
  await api(c, 'POST', '/user/logout-all')
  await sleep(2000)
  // Frontend chỉ ngừng nối lại socket (mã SESSION_REVOKED), chưa đẩy về /auth
  // cho tới lần gọi HTTP tiếp theo — nên kiểm điều người dùng thấy được.
  const probe = `sau khi thu hoi ${Date.now().toString(36)}`
  await send(A.page, probe)
  await until(async () => (await bubbles(B.page, probe)) === 1, 5000)
  check((await bubbles(C.page, probe)) === 0, `C không còn nhận tin sau khi bị thu hồi (socket ở ${gw})`)
  await C.page.reload({ waitUntil: 'networkidle2' })
  check(await until(async () => C.page.url().includes('/auth'), 10000), 'C tải lại trang thì bị đưa về đăng nhập')
  await shoot(C.page, '9-session-revoked')
}

for (const X of [A, B, C]) await X.browser.close()
await ensureAll()
console.log(`\nTỔNG: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
