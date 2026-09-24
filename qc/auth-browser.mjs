/**
 * QC trên trình duyệt thật cho luồng phiên đăng nhập.
 *
 *   node qc/auth-browser.mjs
 *
 * Cần: backend đang chạy, frontend dev server ở một origin mà Kong cho phép
 * (5173/5174 — xem `backend/kong/kong.yml`), và Chrome. Ghi đè bằng biến môi
 * trường: APP, API, CHROME_PATH, REDIS_CONTAINER.
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
const REDIS_CONTAINER = process.env.REDIS_CONTAINER ?? 'daln-redis'
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const R = (cmd) =>
  execSync(`docker exec ${REDIS_CONTAINER} redis-cli ${cmd}`).toString().trim()
const sh = (cmd) => execSync(cmd, { shell: '/bin/bash' }).toString()

let pass = 0, fail = 0
const ok = (m) => { console.log(`  ✅ ${m}`); pass++ }
const bad = (m) => { console.log(`  ❌ ${m}`); fail++ }
const is = (actual, expected, label) =>
  String(actual) === String(expected) ? ok(`${label} (${actual})`) : bad(`${label} — mong ${expected}, nhận ${actual}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Ảnh chụp là bằng chứng của bộ QC này; thiếu thư mục thì nó chết ở bước đầu.
mkdirSync('shots', { recursive: true })

/**
 * Tài khoản mới bị giữ ở bước chọn sở thích, nên mọi đường đi tới trang khác
 * đều bị chuyển hướng về đó. Bấm "Bỏ qua" đúng như người dùng thật.
 */
async function skipOnboarding(page) {
  if (!page.url().includes('/onboarding')) return
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      /Bỏ qua/.test(b.textContent ?? ''),
    )
    button?.click()
  })
  await new Promise((r) => setTimeout(r, 2000))
}

async function until(fn, ms = 8000, step = 250) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await sleep(step) }
  return false
}

// --- tạo tài khoản qua API (OTP đọc từ Redis) ---
const stamp = Date.now()
const email = `qcui${stamp}@example.test`
const username = `qcui${stamp}`
const password = 'MatKhau123'
sh(`curl -s -o /dev/null -X POST ${API}/user/register -H 'Content-Type: application/json' -d '${JSON.stringify({ email, username, password, fullName: 'QC UI' })}'`)
// Redis chỉ giữ sha256 của OTP, nên harness không đọc được mã thô nữa — đó
// là đúng điều ta vừa sửa. Ghi bản băm của một mã biết trước rồi xác thực
// bằng chính mã đó: vẫn đi qua đường verify thật.
const otp = '135790'
R(`set "otp:reg:${email}" ${createHash('sha256').update(otp).digest('hex')} EX 300`)
sh(`curl -s -o /dev/null -X POST ${API}/user/verify-otp -H 'Content-Type: application/json' -d '${JSON.stringify({ email, otp })}'`)
console.log(`Tài khoản QC: ${email}`)

// Bộ QC gọi đăng nhập nhiều hơn hạn mức thật (30 lần / 5 phút / IP); dọn xô
// của chính mình để hạn mức không che mất lỗi khác. Hạn mức có bộ kiểm riêng
// trong qc/auth-api.sh.
const resetLimits = () =>
  execSync(
    `docker exec ${REDIS_CONTAINER} sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`,
  )
resetLimits()

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1400,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

// page.cookies(url) LỌC THEO PATH, nên cookie Path=/user không khớp URL gốc và
// bị bỏ sót. CDP trả về toàn bộ jar kèm path thật.
const cdp = await page.createCDPSession()
const allCookies = async () => (await cdp.send('Network.getAllCookies')).cookies
const cookieNamed = async (name) =>
  (await allCookies()).find((c) => c.name === name)

const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

console.log('\n== 1. Đăng nhập qua UI ==')
await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
await page.waitForSelector('input[name="email"]', { timeout: 15000 })
await page.type('input[name="email"]', email)
await page.type('input[name="password"]', password)
await page.screenshot({ path: 'shots/01-form.png' })
await page.click('button[type="submit"]')
const landed = await until(async () => !page.url().includes('/auth'), 20000)
is(landed, true, 'rời khỏi trang /auth sau khi đăng nhập')
await skipOnboarding(page)
await sleep(2500)
await page.screenshot({ path: 'shots/02-logged-in.png', fullPage: false })
console.log(`  URL: ${page.url()}`)

console.log('\n== 2. Cookie trong trình duyệt ==')
const at = await cookieNamed('accessToken')
const rt = await cookieNamed('refreshToken')
is(Boolean(at), true, 'có accessToken')
is(Boolean(rt), true, 'có refreshToken')
is(at?.path, '/', 'accessToken path')
is(rt?.path, '/user', 'refreshToken path (không đi khắp hệ thống)')
is(at?.httpOnly, true, 'accessToken httpOnly')
is(rt?.httpOnly, true, 'refreshToken httpOnly')
const sid = rt?.value.split('.')[0]
console.log(`  sid = ${sid}`)
is(R(`exists "sess:${sid}"`), '1', 'phiên tồn tại trong Redis')
const uid = R(`hget "sess:${sid}" uid`)

console.log('\n== 3. Socket bắt tay chỉ bằng access token ==')
const socketUp = await until(() => Number(R(`scard "user:${uid}:sockets"`)) > 0)
is(socketUp, true, 'socket đã nối (handshake không cần refresh token)')

console.log('\n== 4. Mốc 15 phút: xoá cookie access, phải tự làm mới =='
)
const rtHashBefore = R(`hget "sess:${sid}" rtHash`)
await page.deleteCookie({ name: 'accessToken', domain: 'localhost', path: '/' })
const afterDelete = await cookieNamed('accessToken')
is(Boolean(afterDelete), false, 'đã xoá cookie access (giả lập hết hạn)')
await page.reload({ waitUntil: 'networkidle2' })
await sleep(3000)
const stillIn = !page.url().includes('/auth')
is(stillIn, true, 'người dùng KHÔNG bị đăng xuất')
const newAt = await cookieNamed('accessToken')
is(Boolean(newAt), true, 'đã có access token mới')
const rtHashAfter = R(`hget "sess:${sid}" rtHash`)
is(rtHashAfter !== rtHashBefore, true, 'refresh token đã rotate')
is(R(`exists "sess:${sid}"`), '1', 'vẫn đúng một phiên, sid không đổi')
await page.screenshot({ path: 'shots/03-after-silent-refresh.png' })

console.log('\n== 5. Thu hồi từ thiết bị khác -> socket bị ngắt + đăng xuất ==')
sh(`curl -s -o /dev/null -c jarOther.txt -X POST ${API}/user/login -H 'Content-Type: application/json' -d '${JSON.stringify({ email, password })}'`)
sh(`curl -s -o /dev/null -b jarOther.txt -X POST ${API}/user/logout-all`)
is(R(`exists "sess:${sid}"`), '0', 'phiên của trình duyệt đã bị xoá ở server')
const socketGone = await until(() => Number(R(`scard "user:${uid}:sockets"`)) === 0, 10000)
is(socketGone, true, 'gateway đã NGẮT socket đang mở (kênh RMQ hoạt động)')
await page.reload({ waitUntil: 'networkidle2' }).catch(() => {})
const kicked = await until(async () => page.url().includes('/auth'), 15000)
is(kicked, true, 'trình duyệt bị đưa về trang đăng nhập')
await page.screenshot({ path: 'shots/04-after-revoke.png' })
console.log(`  URL: ${page.url()}`)

console.log('\n== 6. Đăng nhập lại được sau khi bị thu hồi ==')
await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
await page.waitForSelector('input[name="email"]')
await page.type('input[name="email"]', email)
await page.type('input[name="password"]', password)
await page.click('button[type="submit"]')
const back = await until(async () => !page.url().includes('/auth'), 20000)
is(back, true, 'đăng nhập lại thành công')
await sleep(2000)
await page.screenshot({ path: 'shots/05-relogin.png' })

console.log('\n== 7. Đăng xuất: trình duyệt CÓ gửi cookie refresh tới /user/logout ==')
const rt2 = await cookieNamed('refreshToken')
const sid2 = rt2?.value.split('.')[0]
is(R(`exists "sess:${sid2}"`), '1', 'phiên mới tồn tại')
// Đây là điểm mấu chốt của việc đặt cookie ở path=/user thay vì /user/refresh:
// hẹp hơn nữa thì trình duyệt KHÔNG gửi cookie tới /user/logout, và server mất
// đường xác định phiên cần xoá.
const logoutStatus = await page.evaluate(async (api) => {
  const res = await fetch(`${api}/user/logout`, {
    method: 'POST',
    credentials: 'include',
  })
  return res.status
}, API)
is(logoutStatus, 204, 'POST /user/logout từ trong trang')
const loggedOut = await until(() => R(`exists "sess:${sid2}"`) === '0', 8000)
is(loggedOut, true, 'phiên bị xoá ở server (cookie refresh đã tới được endpoint)')
const socketCut = await until(() => Number(R(`scard "user:${uid}:sockets"`)) === 0, 10000)
is(socketCut, true, 'socket bị ngắt sau khi đăng xuất')
await page.screenshot({ path: 'shots/06-after-logout.png' })

console.log('\n== 8. UI "Phiên đăng nhập": thấy và thu hồi được thiết bị khác ==')
resetLimits()
await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
await page.waitForSelector('input[name="email"]')
await page.type('input[name="email"]', email)
await page.type('input[name="password"]', password)
await page.click('button[type="submit"]')
await until(async () => !page.url().includes('/auth'), 20000)
await skipOnboarding(page)

// Một "thiết bị" thứ hai, đăng nhập qua API với user-agent riêng.
sh(`curl -s -o /dev/null -c jarPhone.txt -A 'QC-Phone/1.0' -X POST ${API}/user/login -H 'Content-Type: application/json' -d '${JSON.stringify({ email, password })}'`)

await page.goto(`${APP}/settings/account`, { waitUntil: 'networkidle2' })
const sawOther = await until(async () => {
  const text = await page.evaluate(() => document.body.innerText)
  return text.includes('QC-Phone') || /Trình duyệt|Chrome trên/.test(text)
}, 15000)
is(sawOther, true, 'trang Cài đặt liệt kê thiết bị khác')
await page.screenshot({ path: 'shots/07-devices.png' })

const beforeCount = Number(R(`scard "sess:idx:${uid}"`))
is(beforeCount >= 2, true, `có ${beforeCount} phiên trước khi thu hồi`)

// Bấm đúng nút "Đăng xuất" của dòng thiết bị KHÁC.
//
// Không dùng thứ tự DOM: nút "Đăng xuất tất cả" cũng chứa chữ "Đăng xuất" và
// nằm cuối, nên lấy phần tử cuối sẽ bấm nhầm và đăng xuất luôn chính mình.
// Chọn theo nhãn CHÍNH XÁC, rồi loại dòng có "Thiết bị này".
const clicked = await page.evaluate(() => {
  const rowTextOf = (node) => {
    let current = node
    for (let depth = 0; current && depth < 5; depth += 1) {
      current = current.parentElement
      if (current && /hoạt động|Thiết bị này/.test(current.textContent ?? '')) {
        return current.textContent ?? ''
      }
    }
    return ''
  }

  const target = [...document.querySelectorAll('button')]
    .filter((button) => button.textContent?.trim() === 'Đăng xuất')
    .find((button) => !/Thiết bị này/.test(rowTextOf(button)))

  target?.click()
  return Boolean(target)
})
is(clicked, true, 'bấm được nút Đăng xuất của thiết bị khác')

const revoked = await until(
  () => Number(R(`scard "sess:idx:${uid}"`)) < beforeCount,
  10000,
)
is(revoked, true, 'phiên thiết bị khác bị thu hồi ở server')
is(page.url().includes('/settings'), true, 'mình KHÔNG bị đăng xuất theo')
await page.screenshot({ path: 'shots/08-after-revoke-device.png' })

console.log(`\nLỗi console (không tính lỗi mạng dự kiến): ${consoleErrors.length}`)
consoleErrors.slice(0, 5).forEach((e) => console.log(`   · ${e.slice(0, 140)}`))
console.log(`\nTỔNG: ${pass} pass / ${fail} fail`)
await browser.close()
process.exit(fail ? 1 : 0)
