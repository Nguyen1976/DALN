/**
 * QC trên trình duyệt thật cho hộp thoại đổi mật khẩu.
 *
 *   node qc/change-password-browser.mjs
 *
 * Cần: backend đang chạy, frontend dev server ở origin Kong cho phép
 * (5173/5174), Chrome, và MailHog ở 8025 để xác nhận thư đi thật.
 * Ghi đè bằng biến môi trường: APP, API, MAILHOG, CHROME_PATH, REDIS_CONTAINER.
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
const MAILHOG = process.env.MAILHOG ?? 'http://localhost:8025'
const REDIS_CONTAINER = process.env.REDIS_CONTAINER ?? 'daln-redis'
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const R = (cmd) =>
  execSync(`docker exec ${REDIS_CONTAINER} redis-cli ${cmd}`).toString().trim()
const sh = (cmd) => execSync(cmd, { shell: '/bin/bash' }).toString()

let pass = 0,
  fail = 0
const ok = (m) => {
  console.log(`  ✅ ${m}`)
  pass++
}
const bad = (m) => {
  console.log(`  ❌ ${m}`)
  fail++
}
const is = (actual, expected, label) =>
  String(actual) === String(expected)
    ? ok(`${label} (${actual})`)
    : bad(`${label} — mong ${expected}, nhận ${actual}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync('shots', { recursive: true })

async function until(fn, ms = 8000, step = 250) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await sleep(step)
  }
  return false
}

/** Văn bản hiển thị của cả trang — đủ để hỏi "người dùng có đọc được câu này không". */
const bodyText = (page) => page.evaluate(() => document.body.innerText)

/**
 * Bấm bằng CHUỘT THẬT, không phải `el.click()`.
 *
 * Radix kích hoạt tab và checkbox từ `mousedown`, mà `el.click()` chỉ phát
 * đúng một sự kiện `click` — nên bộ QC bản đầu "bấm" sang tab OTP mà giao diện
 * không hề đổi, rồi báo đỏ là thiếu ô nhập mã. Đi qua chuột thì mọi sự kiện
 * đều thật, và phép đo không còn nói sai về giao diện.
 */
async function realClickByText(page, selector, pattern) {
  const box = await page.evaluate(
    (sel, src) => {
      const re = new RegExp(src)
      const el = [...document.querySelectorAll(sel)].find((n) =>
        re.test(n.textContent ?? ''),
      )
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    },
    selector,
    pattern.source,
  )
  if (!box) return false
  await page.mouse.click(box.x, box.y)
  return true
}

const clickByText = (page, selector, pattern) =>
  page.evaluate(
    (sel, src) => {
      const re = new RegExp(src)
      const el = [...document.querySelectorAll(sel)].find((n) =>
        re.test(n.textContent ?? ''),
      )
      if (!el) return false
      el.click()
      return true
    },
    selector,
    pattern.source,
  )

async function skipOnboarding(page) {
  if (!page.url().includes('/onboarding')) return
  await clickByText(page, 'button', /Bỏ qua/)
  await sleep(2000)
}

const resetLimits = () =>
  execSync(
    `docker exec ${REDIS_CONTAINER} sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`,
  )

// --- tài khoản QC ---
const stamp = Date.now()
const email = `qccp${stamp}@example.test`
const username = `qccp${stamp}`
let password = 'MatKhau123'
resetLimits()
sh(
  `curl -s -o /dev/null -X POST ${API}/user/register -H 'Content-Type: application/json' -d '${JSON.stringify({ email, username, password, fullName: 'QC ChangePw' })}'`,
)
R(
  `set "otp:reg:${email}" ${createHash('sha256').update('135790').digest('hex')} EX 300`,
)
sh(
  `curl -s -o /dev/null -X POST ${API}/user/verify-otp -H 'Content-Type: application/json' -d '${JSON.stringify({ email, otp: '135790' })}'`,
)
console.log(`Tài khoản QC: ${email}`)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1400,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

// page.cookies(url) LỌC THEO PATH nên bỏ sót cookie Path=/user; CDP trả cả jar.
const cdp = await page.createCDPSession()
const cookieNamed = async (name) =>
  (await cdp.send('Network.getAllCookies')).cookies.find((c) => c.name === name)

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

console.log('\n== 1. Vào Cài đặt: nút không còn "sắp có" ==')
await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
await page.waitForSelector('input[name="email"]', { timeout: 15000 })
await page.type('input[name="email"]', email)
await page.type('input[name="password"]', password)
await page.click('button[type="submit"]')
await until(async () => !page.url().includes('/auth'), 20000)
await skipOnboarding(page)
await page.goto(`${APP}/settings/account`, { waitUntil: 'networkidle2' })
await sleep(1500)

const changeButton = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((n) =>
    /Đổi mật khẩu/.test(n.textContent ?? ''),
  )
  return b ? { disabled: b.disabled } : null
})
is(Boolean(changeButton), true, 'có nút "Đổi mật khẩu"')
is(changeButton?.disabled, false, 'nút KHÔNG còn bị khoá')
await page.screenshot({ path: 'shots/cp-01-settings.png' })

console.log('\n== 2. Mở hộp thoại ==')
await realClickByText(page, 'button', /Đổi mật khẩu/)
await page.waitForSelector('[role="dialog"]', { timeout: 8000 })
await sleep(600)
const dialogText = await page.evaluate(
  () => document.querySelector('[role="dialog"]')?.innerText ?? '',
)
is(
  /Mật khẩu hiện tại/.test(dialogText) && /Mã qua email/.test(dialogText),
  true,
  'có đủ hai tab xác thực',
)
is(
  /Đăng xuất khỏi các thiết bị khác/.test(dialogText),
  true,
  'có ô chọn đăng xuất thiết bị khác',
)
await page.screenshot({ path: 'shots/cp-02-dialog.png' })

console.log('\n== 3. Mật khẩu hiện tại SAI -> lỗi gắn vào đúng ô ==')
await page.type('input[name="currentPassword"]', 'sai-be-troi')
await page.type('input[name="newPassword"]', 'MatKhauMoi123')
await page.type('input[name="confirmPassword"]', 'MatKhauMoi123')
await realClickByText(page, '[role="dialog"] button[type="submit"]', /Đổi mật khẩu/)
const sawFieldError = await until(
  async () => /Mật khẩu hiện tại không đúng/.test(await bodyText(page)),
  10000,
)
is(sawFieldError, true, 'lỗi hiện ngay dưới ô mật khẩu hiện tại')
is(
  await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))),
  true,
  'hộp thoại KHÔNG đóng khi lỗi',
)
await page.screenshot({ path: 'shots/cp-03-sai-mat-khau.png' })

console.log('\n== 4. Đổi bằng mật khẩu hiện tại ==')
await page.evaluate(() => {
  const el = document.querySelector('input[name="currentPassword"]')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  ).set
  setter.call(el, '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.type('input[name="currentPassword"]', password)
await realClickByText(page, '[role="dialog"] button[type="submit"]', /Đổi mật khẩu/)
const closed = await until(
  async () =>
    !(await page.evaluate(() =>
      Boolean(document.querySelector('[role="dialog"]')),
    )),
  12000,
)
is(closed, true, 'hộp thoại đóng sau khi đổi thành công')
is(/Đã đổi mật khẩu/.test(await bodyText(page)), true, 'có thông báo thành công')
password = 'MatKhauMoi123'
await page.screenshot({ path: 'shots/cp-04-doi-thanh-cong.png' })

const loginNew = sh(
  `curl -s -o /dev/null -w '%{http_code}' -X POST ${API}/user/login -H 'Content-Type: application/json' -d '${JSON.stringify({ email, password })}'`,
).trim()
is(loginNew, '201', 'mật khẩu mới dùng được ngay ở API')

console.log('\n== 5. Đường OTP: gửi mã, thư đi thật ==')
resetLimits()
const mailBefore = JSON.parse(sh(`curl -s "${MAILHOG}/api/v2/messages?limit=1"`))
  .total
await realClickByText(page, 'button', /Đổi mật khẩu/)
await page.waitForSelector('[role="dialog"]', { timeout: 8000 })
await realClickByText(page, '[role="dialog"] [role="tab"]', /Mã qua email/)
await sleep(500)
is(
  await page.evaluate(
    () => document.querySelectorAll('[role="dialog"] input[inputmode]').length,
  ),
  6,
  'ô nhập mã có 6 ký tự',
)
const otpDisabledBefore = await page.evaluate(
  () =>
    document.querySelector('[role="dialog"] input[inputmode]')?.disabled ??
    null,
)
is(otpDisabledBefore, true, 'chưa gửi mã thì ô nhập còn khoá')
await page.screenshot({ path: 'shots/cp-05-tab-otp.png' })

await realClickByText(page, '[role="dialog"] button', /^Gửi mã$/)
const mailArrived = await until(async () => {
  const total = JSON.parse(sh(`curl -s "${MAILHOG}/api/v2/messages?limit=1"`))
    .total
  return total > mailBefore
}, 15000)
is(mailArrived, true, 'thư mã xác nhận đã tới hộp thư')
const countdownShown = await until(
  async () => /Gửi lại sau \d+s/.test(await bodyText(page)),
  8000,
)
is(countdownShown, true, 'nút chuyển sang đếm ngược, không bấm lại được ngay')
await page.screenshot({ path: 'shots/cp-06-da-gui-ma.png' })

console.log('\n== 6. Nhập mã -> đổi được, và đá các thiết bị khác ==')
// Lấy userId từ CHÍNH phiên của trình duyệt: cookie refresh mang sid, và
// `sess:<sid>` mang uid. Quét `otp:chpw:*` rồi lấy khoá đầu tiên thì có ngày
// nhặt trúng mã của người dùng khác do bộ QC API vừa tạo — phép đo khi đó nói
// sai về sản phẩm.
const refreshCookie = await cookieNamed('refreshToken')
const browserSid = (refreshCookie?.value ?? '').split('.')[0]
const userId = browserSid ? R(`hget "sess:${browserSid}" uid`) : ''
is(Boolean(userId), true, `đọc được userId của phiên đang mở (${userId})`)

// Redis chỉ giữ hash nên harness không đọc được mã thô; ghi hash của một mã
// biết trước rồi nhập chính mã đó — vẫn đi qua đúng đường verify thật.
const qcOtp = '864209'
R(
  `set "otp:chpw:${userId}" ${createHash('sha256').update(qcOtp).digest('hex')} EX 300`,
)

// Một thiết bị khác của cùng người dùng, để kiểm ô "đăng xuất thiết bị khác".
sh(
  `curl -s -o /dev/null -c /tmp/qc-other.txt -X POST ${API}/user/login -H 'Content-Type: application/json' -d '${JSON.stringify({ email, password })}'`,
)
const otherSid = sh(
  `grep refreshToken /tmp/qc-other.txt | awk '{print $7}'`,
).trim().split('.')[0]
is(R(`exists "sess:${otherSid}"`), '1', 'thiết bị khác đang có phiên sống')

// Gõ qua BÀN PHÍM sau khi đặt con trỏ vào ô đầu, chứ không `page.type(selector)`
// từng chữ số: selector luôn trỏ về ô đầu, mà ô đó `select()` khi nhận focus —
// nên mỗi chữ số ghi đè chữ trước và mã cuối cùng chỉ còn một ký tự. Component
// tự đẩy con trỏ sang ô kế, đúng như khi người dùng gõ.
await page.focus('[role="dialog"] input[inputmode]:not([disabled])')
await page.keyboard.type(qcOtp, { delay: 60 })
const typedOtp = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"] input[inputmode]')]
    .map((i) => i.value)
    .join(''),
)
is(typedOtp, qcOtp, 'mã hiện đủ 6 ô')
await page.type('input[name="newPassword"]', 'MatKhauOtp123')
await page.type('input[name="confirmPassword"]', 'MatKhauOtp123')
await realClickByText(page, '[role="dialog"] label', /Đăng xuất khỏi các thiết bị khác/)
await sleep(300)
await page.screenshot({ path: 'shots/cp-07-truoc-khi-gui.png' })
await realClickByText(page, '[role="dialog"] button[type="submit"]', /Đổi mật khẩu/)

const closed2 = await until(
  async () =>
    !(await page.evaluate(() =>
      Boolean(document.querySelector('[role="dialog"]')),
    )),
  12000,
)
is(closed2, true, 'đổi bằng OTP thành công, hộp thoại đóng')
is(R(`exists "sess:${otherSid}"`), '0', 'thiết bị khác bị đá ra')
is(
  page.url().includes('/settings'),
  true,
  'mình KHÔNG bị đăng xuất theo, vẫn ở trong app',
)
const stillIn = await until(
  async () => !/Đăng nhập/.test(await bodyText(page)),
  4000,
)
is(stillIn, true, 'không bị đẩy về trang đăng nhập')
await page.screenshot({ path: 'shots/cp-08-sau-khi-doi.png' })

const loginOtpPw = sh(
  `curl -s -o /dev/null -w '%{http_code}' -X POST ${API}/user/login -H 'Content-Type: application/json' -d '${JSON.stringify({ email, password: 'MatKhauOtp123' })}'`,
).trim()
is(loginOtpPw, '201', 'mật khẩu đặt qua đường OTP dùng được')

console.log('\n== 7. Console sạch ==')
const realErrors = consoleErrors.filter(
  (e) => !/401|favicon|Failed to load resource/.test(e),
)
is(realErrors.length, 0, `không có lỗi console lạ${realErrors.length ? `: ${realErrors[0]}` : ''}`)

await browser.close()
console.log(`\nTỔNG CUỐI: ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
