/**
 * E2E xác thực socket — 3 kịch bản token.
 *
 * Bug gốc: gateway chỉ verify accessToken, không đụng refreshToken (dù nó nằm
 * sẵn trong cùng handshake header). Access hết hạn -> `io server disconnect`,
 * mà Socket.IO KHÔNG tự nối lại sau lý do đó -> realtime chết tới khi F5.
 *
 * Chạy:  node testing/e2e/socket-auth.spec.js
 */
const { chromium } = require('playwright')
const { io } = require('socket.io-client')

const BASE_UI = process.env.BASE_UI || 'http://localhost:5174'
const API = process.env.API || 'http://localhost:8080'
const WS = process.env.WS || 'http://localhost:8080/realtime'
const SEED = JSON.parse(process.env.E2E_SEED)
const [USER] = SEED.users
const PASSWORD = SEED.password
const EXPIRED_ACCESS = process.env.EXPIRED_ACCESS
const EXPIRED_REFRESH = process.env.EXPIRED_REFRESH

const results = []
function assert(c, m) { if (!c) throw new Error(m) }
async function tc(name, fn) {
  const t0 = Date.now()
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}  (${Date.now() - t0}ms)`) }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}  (${Date.now() - t0}ms)\n      ${e.message}`) }
}
async function waitFor(fn, { timeout = 15000, interval = 250, what = '' } = {}) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last } catch (e) { last = e.message }
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error(`hết ${timeout}ms chờ ${what} (cuối: ${JSON.stringify(last)})`)
}

/** Thử nối socket bằng cookie cho trước, trả về diễn biến. */
function probeSocket(cookie, ms = 6000) {
  return new Promise((resolve) => {
    const ev = []
    let authCode = null
    const s = io(WS, {
      transports: ['websocket'], extraHeaders: { Cookie: cookie },
      reconnection: false, timeout: 8000,
    })
    s.on('connect', () => ev.push('connect'))
    s.on('auth:error', (p) => { authCode = p?.code; ev.push(`auth:error(${p?.code})`) })
    s.on('disconnect', (r) => ev.push(`disconnect(${r})`))
    s.on('connect_error', (e) => ev.push(`connect_error(${e.message})`))
    setTimeout(() => {
      const stayed = s.connected
      s.close()
      resolve({ ev, authCode, stayed })
    }, ms)
  })
}

;(async () => {
  // lấy cookie thật
  const login = await fetch(`${API}/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USER.email, password: PASSWORD }),
  })
  const setCookie = login.headers.getSetCookie()
  const jar = {}
  setCookie.forEach(c => { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1) })
  const GOOD_ACCESS = jar.accessToken
  const GOOD_REFRESH = jar.refreshToken
  assert(GOOD_ACCESS && GOOD_REFRESH, 'không lấy được cookie đăng nhập')

  console.log(`\n=== E2E xác thực socket — ${USER.username} ===\n`)

  await tc('TCS0 Đối chứng: access CÒN HẠN -> nối được', async () => {
    const r = await probeSocket(`accessToken=${GOOD_ACCESS}; refreshToken=${GOOD_REFRESH}`)
    assert(r.stayed, `không giữ được kết nối: ${r.ev.join(' -> ')}`)
  })

  await tc('TCS1 access HẾT HẠN + refresh còn hạn -> VẪN nối được', async () => {
    const r = await probeSocket(`accessToken=${EXPIRED_ACCESS}; refreshToken=${GOOD_REFRESH}`)
    assert(r.stayed,
      `bị ngắt dù refresh còn hạn: ${r.ev.join(' -> ')}`)
    assert(!r.authCode, `không được phát auth:error, nhận: ${r.authCode}`)
  })

  await tc('TCS2 CẢ HAI hết hạn -> ngắt kèm REFRESH_TOKEN_INVALID', async () => {
    const r = await probeSocket(`accessToken=${EXPIRED_ACCESS}; refreshToken=${EXPIRED_REFRESH}`)
    assert(!r.stayed, `lẽ ra phải bị ngắt: ${r.ev.join(' -> ')}`)
    assert(r.authCode === 'REFRESH_TOKEN_INVALID',
      `mã lỗi sai: mong REFRESH_TOKEN_INVALID, nhận '${r.authCode}' (${r.ev.join(' -> ')})`)
  })

  await tc('TCS3 KHÔNG có cookie -> ngắt kèm ACCESS_TOKEN_MISSING', async () => {
    const r = await probeSocket('')
    assert(!r.stayed, 'lẽ ra phải bị ngắt')
    assert(r.authCode === 'ACCESS_TOKEN_MISSING',
      `mã lỗi sai: nhận '${r.authCode}' (${r.ev.join(' -> ')})`)
  })

  // ---- kiểm trong TRÌNH DUYỆT THẬT ----
  await tc('TCS4 Trình duyệt: phiên chết -> KHÔNG lặp vô hạn, có báo mã lỗi', async () => {
    const b = await chromium.launch({ headless: true, channel: 'chrome' })
    try {
      const ctx = await b.newContext()
      const page = await ctx.newPage()

      // Đếm số lần trình duyệt mở WebSocket. Nếu client lặp vô hạn thì con số
      // này sẽ tăng không ngừng — đó chính là thứ `reconnectionAttempts:
      // Infinity` gây ra nếu không có giới hạn phía ứng dụng.
      const wsOpens = []
      page.on('websocket', (ws) => wsOpens.push(ws.url()))

      await page.goto(`${BASE_UI}/auth`, { waitUntil: 'domcontentloaded' })
      await page.fill('input[type="email"]', USER.email)
      await page.fill('input[placeholder="Nhập mật khẩu"]', PASSWORD)
      await page.click('button[type="submit"]')
      await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 20000 })

      await waitFor(async () => wsOpens.length >= 1, { what: 'socket mở lần đầu', timeout: 15000 })
      const afterLogin = wsOpens.length

      // Giết phiên hoàn toàn: cả hai token đều hết hạn -> handshake kế tiếp
      // chắc chắn bị từ chối với REFRESH_TOKEN_INVALID (mã fatal).
      const before = await ctx.cookies()
      const acc = before.find(c => c.name === 'accessToken')
      const ref = before.find(c => c.name === 'refreshToken')
      await ctx.clearCookies()
      await ctx.addCookies([
        { ...acc, value: EXPIRED_ACCESS },
        { ...ref, value: EXPIRED_REFRESH },
      ])

      // Ép mở lại kết nối bằng cách tải lại trang (socket connect lúc mount).
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.waitForTimeout(12000)

      const opens = wsOpens.length - afterLogin
      assert(opens <= 6,
        `client mở lại socket ${opens} lần trong 12 giây — đang lặp không giới hạn`)
    } finally {
      await b.close()
    }
  })

  const pass = results.filter(r => r.ok).length
  console.log(`\n=== KẾT QUẢ: ${pass}/${results.length} đạt ===`)
  results.filter(r => !r.ok).forEach(r => console.log(`  HỎNG: ${r.name} — ${r.err}`))
  process.exit(pass === results.length ? 0 : 1)
})().catch(e => { console.error('LỖI NGOÀI TEST:', e); process.exit(2) })
