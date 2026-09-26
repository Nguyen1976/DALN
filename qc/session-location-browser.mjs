/**
 * QC trên trình duyệt thật cho vị trí và thời gian của phiên đăng nhập.
 *
 *   node qc/session-location-browser.mjs
 *
 * Cần: backend đang chạy và đã nạp DB kiểm thử của MaxMind ở backend/geoip
 * (README, mục "Chuẩn bị"), frontend dev server ở origin Kong cho phép
 * (5173/5174), Chrome, và mạng tới tile.openstreetmap.org.
 *
 * "Thiết bị khác" đăng nhập bằng curl qua Kong kèm X-Forwarded-For: service đặt
 * `trust proxy 2`, nên IP trong header chính là IP được ghi vào phiên. Mọi IP
 * dùng ở đây đều có trong DB kiểm thử, nên không cần tài khoản MaxMind.
 * Ghi đè bằng biến môi trường: APP, API, CHROME_PATH, REDIS_CONTAINER.
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
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
const has = (text, needle, label) =>
  String(text ?? '').includes(needle)
    ? ok(label)
    : bad(
        `${label} — không thấy "${needle}" trong: ${String(text ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 160)}`,
      )
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

const bodyText = (page) => page.evaluate(() => document.body.innerText)

/** Bấm bằng chuột thật — lý do xem ở change-password-browser.mjs. */
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

async function skipOnboarding(page) {
  if (!page.url().includes('/onboarding')) return
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => /Bỏ qua/.test(b.textContent ?? ''))
      ?.click(),
  )
  await sleep(2000)
}

const resetLimits = () =>
  execSync(
    `docker exec ${REDIS_CONTAINER} sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`,
  )

// --- tài khoản QC ---
const stamp = Date.now()
const email = `qcloc${stamp}@example.test`
const username = `qcloc${stamp}`
const password = 'MatKhau123'
resetLimits()
sh(
  `curl -s -o /dev/null -X POST ${API}/user/register -H 'Content-Type: application/json' -d '${JSON.stringify({ email, username, password, fullName: 'QC Location' })}'`,
)
R(
  `set "otp:reg:${email}" ${createHash('sha256').update('135790').digest('hex')} EX 300`,
)
sh(
  `curl -s -o /dev/null -X POST ${API}/user/verify-otp -H 'Content-Type: application/json' -d '${JSON.stringify({ email, otp: '135790' })}'`,
)
console.log(`Tài khoản QC: ${email}`)

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  firefoxWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
}

/** Một "thiết bị khác": đăng nhập bằng curl, trả sid của phiên vừa tạo. */
function loginDevice(jar, ua, xff) {
  rmSync(jar, { force: true })
  const forwarded = xff ? `-H 'X-Forwarded-For: ${xff}'` : ''
  const code = sh(
    `curl -s -o /dev/null -w '%{http_code}' -c ${jar} -X POST ${API}/user/login -H 'Content-Type: application/json' -H 'User-Agent: ${ua}' ${forwarded} -d '${JSON.stringify({ email, password })}'`,
  ).trim()
  const cookie = sh(`awk '$6 == "refreshToken" { print $7 }' ${jar}`).trim()
  return { code, sid: cookie.split('.')[0], jar }
}

const today = new Date().toLocaleDateString('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

console.log('\n== 1. Server ghi IP lúc đăng nhập và IP gần nhất ==')
const B = loginDevice('jarLocB.txt', UA.iphone, '81.2.69.142')
const C = loginDevice('jarLocC.txt', UA.firefoxWin, '67.43.156.0')
const D = loginDevice('jarLocD.txt', UA.chromeLinux, null)
const E = loginDevice('jarLocE.txt', UA.edgeWin, '175.16.199.0')
is(
  [B, C, D, E].map((d) => d.code).join(','),
  '201,201,201,201',
  'bốn thiết bị khác đăng nhập được',
)
is(R(`hget sess:${B.sid} ip`), '81.2.69.142', 'X-Forwarded-For tới được service')
is(R(`hget sess:${B.sid} lastIp`), '81.2.69.142', 'lastIp bắt đầu bằng IP lúc đăng nhập')
const ipD = R(`hget sess:${D.sid} ip`)
is(
  /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(ipD),
  true,
  `D không có XFF -> IP mạng nội bộ (${ipD})`,
)
// Giả một phiên tạo trước khi có field lastIp.
R(`hdel sess:${E.sid} lastIp`)
is(R(`hexists sess:${E.sid} lastIp`), '0', 'E giờ là phiên "cũ", không có lastIp')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1400,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const consoleErrors = []
const pageErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => pageErrors.push(String(e)))

/** innerText của nút toggle chứa `title`, tức dòng thu gọn của thiết bị đó. */
const rowText = (title) =>
  page.evaluate(
    (t) =>
      [...document.querySelectorAll('button[aria-expanded]')].find((b) =>
        b.innerText.includes(t),
      )?.innerText ?? null,
    title,
  )

/** Những gì panel chi tiết của `title` đang hiện; null khi chưa mở. */
const panelInfo = (title) =>
  page.evaluate((t) => {
    const button = [...document.querySelectorAll('button[aria-expanded]')].find(
      (b) => b.innerText.includes(t),
    )
    const panel =
      button && document.getElementById(button.getAttribute('aria-controls') ?? '')
    if (!panel) return null
    const map = panel.querySelector('[role="img"]')
    const tiles = [...panel.querySelectorAll('img[src*="tile.openstreetmap.org"]')]
    const circle = panel.querySelector('[data-accuracy-circle]')
    const link = panel.querySelector('a[href^="https://www.google.com/maps/"]')
    let circleOffset = null
    if (circle && map) {
      const c = circle.getBoundingClientRect()
      const m = map.getBoundingClientRect()
      circleOffset = Math.round(
        Math.hypot(
          c.x + c.width / 2 - (m.x + m.width / 2),
          c.y + c.height / 2 - (m.y + m.height / 2),
        ),
      )
    }
    return {
      expanded: button.getAttribute('aria-expanded'),
      text: panel.innerText,
      hasMap: Boolean(map),
      tileSrcs: tiles.map((i) => i.getAttribute('src')),
      tilesLoaded: tiles.filter((i) => i.complete && i.naturalWidth > 0).length,
      circleDiameter: circle ? Math.round(circle.getBoundingClientRect().width) : 0,
      circleOffset,
      mapsHref: link?.getAttribute('href') ?? null,
      mapsTarget: link?.getAttribute('target') ?? null,
    }
  }, title)

/** Bấm mở panel của `title`, đợi panel và (nếu có bản đồ) tile tải xong. */
async function openPanel(title) {
  const clicked = await realClickByText(page, 'button[aria-expanded]', new RegExp(title))
  if (!clicked) return null
  await until(async () => Boolean(await panelInfo(title)), 4000)
  await until(async () => {
    const info = await panelInfo(title)
    return !info?.hasMap || info.tilesLoaded > 0
  }, 10000)
  return panelInfo(title)
}

async function openSettings() {
  await page.goto(`${APP}/settings/account`, { waitUntil: 'networkidle2' })
  await until(async () => (await bodyText(page)).includes('Safari trên iOS'), 15000)
}

console.log('\n== 2. Dòng thu gọn: thành phố thay cho IP trần ==')
resetLimits()
await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
await page.waitForSelector('input[name="email"]', { timeout: 15000 })
await page.type('input[name="email"]', email)
await page.type('input[name="password"]', password)
await page.click('button[type="submit"]')
await until(async () => !page.url().includes('/auth'), 20000)
await skipOnboarding(page)
await openSettings()
has(await rowText('Safari trên iOS'), 'London, United Kingdom · hoạt động vừa xong', 'B: thành phố + "vừa xong"')
has(await rowText('Firefox trên Windows'), 'Bhutan · hoạt động', 'C: chỉ biết quốc gia')
has(await rowText('Chrome trên Linux'), `${ipD} · hoạt động`, 'D: không tra được vị trí -> hiện IP')
has(await rowText('Edge trên Windows'), 'Changchun, China', 'E (phiên cũ): lấy vị trí của IP lúc đăng nhập')
await page.screenshot({ path: 'shots/loc-02-list.png' })

console.log('\n== 3. Chi tiết của B: bản đồ, link, hai mốc thời gian ==')
const london = await openPanel('Safari trên iOS')
is(london?.expanded, 'true', 'nút toggle báo aria-expanded=true')
has(london?.text, 'Đăng nhập lần đầu', 'có mốc đăng nhập lần đầu')
has(london?.text, `${today} lúc`, 'ngày đăng nhập là hôm nay, kèm giờ')
has(london?.text, 'London, United Kingdom · IP 81.2.69.142', 'nơi và IP lúc đăng nhập')
has(london?.text, 'Vừa xong', 'hoạt động gần nhất, viết hoa đầu dòng')
has(london?.text, 'Ước tính từ IP · bán kính ~10 km', 'nói rõ là ước tính, kèm bán kính')
is(
  london?.tileSrcs?.includes('https://tile.openstreetmap.org/8/127/85.png'),
  true,
  'có tile chứa London ở zoom 8',
)
is((london?.tilesLoaded ?? 0) > 0, true, `tile tải được (${london?.tilesLoaded})`)
is(
  london?.circleDiameter >= 48 && london?.circleDiameter <= 96,
  true,
  `vòng tròn 48–96px (${london?.circleDiameter})`,
)
is(
  london?.circleOffset != null && london.circleOffset <= 1,
  true,
  `vòng tròn nằm giữa khung (lệch ${london?.circleOffset}px)`,
)
is(
  london?.mapsHref,
  'https://www.google.com/maps/@?api=1&map_action=map&center=51.5142,-0.0931&zoom=8',
  'link Google Maps đúng vùng và zoom',
)
is(london?.mapsTarget, '_blank', 'link mở tab mới')
has(london?.text, 'GeoLite2', 'ghi công MaxMind')
has(london?.text, 'OpenStreetMap', 'ghi công OpenStreetMap')
await page.screenshot({ path: 'shots/loc-03-london.png' })

console.log('\n== 4. B refresh từ nơi khác: IP gần nhất đổi, IP lúc đăng nhập giữ ==')
resetLimits()
const refreshed = sh(
  `curl -s -o /dev/null -w '%{http_code}' -b ${B.jar} -c ${B.jar} -X POST ${API}/user/refresh -H 'User-Agent: ${UA.iphone}' -H 'X-Forwarded-For: 89.160.20.112'`,
).trim()
is(refreshed, '204', 'B refresh thành công')
is(R(`hget sess:${B.sid} lastIp`), '89.160.20.112', 'lastIp = IP của lần refresh')
is(R(`hget sess:${B.sid} ip`), '81.2.69.142', 'ip lúc đăng nhập KHÔNG đổi')
await openSettings()
has(await rowText('Safari trên iOS'), 'Linköping, Sweden · hoạt động vừa xong', 'dòng thu gọn theo nơi gần nhất')
const moved = await openPanel('Safari trên iOS')
has(moved?.text, 'London, United Kingdom · IP 81.2.69.142', 'đăng nhập lần đầu vẫn là London')
has(moved?.text, 'Linköping, Sweden · IP 89.160.20.112', 'hoạt động gần nhất là Linköping')
is(
  moved?.mapsHref,
  'https://www.google.com/maps/@?api=1&map_action=map&center=58.4167,15.6167&zoom=5',
  'bản đồ và link theo nơi gần nhất',
)
is(
  moved?.tileSrcs?.includes('https://tile.openstreetmap.org/5/17/9.png'),
  true,
  'tile Linköping ở zoom 5',
)
await page.screenshot({ path: 'shots/loc-04-moved.png' })

console.log('\n== 5. Chỉ biết quốc gia: vòng tròn lớn, zoom lùi ra ==')
const bhutan = await openPanel('Firefox trên Windows')
has(bhutan?.text, 'Bhutan · IP 67.43.156.0', 'chỉ ghi quốc gia')
has(bhutan?.text, 'bán kính ~534 km', 'bán kính lớn được nói ra')
is(
  bhutan?.tileSrcs?.includes('https://tile.openstreetmap.org/3/6/3.png'),
  true,
  'zoom 3 — thấy cả vùng quốc gia',
)
is(bhutan?.mapsHref?.endsWith('&zoom=3'), true, 'link Maps cùng zoom 3')
is(
  bhutan?.circleDiameter >= 48 && bhutan?.circleDiameter <= 96,
  true,
  `vòng tròn vẫn vừa khung (${bhutan?.circleDiameter})`,
)
await page.screenshot({ path: 'shots/loc-05-bhutan.png' })

console.log('\n== 6. Không tra được vị trí ==')
const unknown = await openPanel('Chrome trên Linux')
has(unknown?.text, 'Không xác định được vị trí', 'nói rõ không có vị trí')
is(unknown?.hasMap, false, 'không vẽ bản đồ')
is(unknown?.mapsHref, null, 'không có link Maps')
has(unknown?.text, `IP ${ipD}`, 'IP vẫn hiện')
has(unknown?.text, 'Đăng nhập lần đầu', 'mốc thời gian vẫn hiện')

console.log('\n== 7. Phiên cũ chưa có lastIp ==')
const legacy = await openPanel('Edge trên Windows')
has(
  legacy?.text?.split('Hoạt động gần nhất')[1],
  'Changchun, China · IP 175.16.199.0',
  'hoạt động gần nhất lấy IP lúc đăng nhập',
)

console.log('\n== 8. Thiết bị này ==')
const mine = await openPanel('Thiết bị này')
has(mine?.text, 'Đăng nhập lần đầu', 'thiết bị này cũng mở được chi tiết')
has(mine?.text, `${today} lúc`, 'ngày đăng nhập của thiết bị này')
await page.screenshot({ path: 'shots/loc-08-all-open.png', fullPage: true })

console.log('\n== 9. Không tải được tile: mất hình, không mất chữ ==')
const blockTiles = (req) =>
  req.url().includes('tile.openstreetmap.org') ? req.abort() : req.continue()
await page.setRequestInterception(true)
page.on('request', blockTiles)
await openSettings()
await realClickByText(page, 'button[aria-expanded]', /Safari trên iOS/)
await until(async () => (await panelInfo('Safari trên iOS'))?.hasMap === false, 6000)
const blocked = await panelInfo('Safari trên iOS')
is(blocked?.hasMap, false, 'khối bản đồ biến mất khi tile lỗi')
has(blocked?.text, 'Ước tính từ IP', 'nhãn bán kính vẫn còn')
is(Boolean(blocked?.mapsHref), true, 'link Google Maps vẫn còn')
has(blocked?.text, 'Hoạt động gần nhất', 'hai mốc thời gian vẫn còn')
page.off('request', blockTiles)
await page.setRequestInterception(false)

console.log('\n== 10. API cũ trong lúc deploy (chưa có lastIp/location) ==')
const origin = new URL(APP).origin
const realBody = await page.evaluate(
  (api) =>
    fetch(`${api}/user/sessions`, { credentials: 'include' }).then((r) => r.text()),
  API,
)
const oldBody = JSON.stringify(
  JSON.parse(realBody, (key, value) =>
    ['lastIp', 'location', 'lastLocation'].includes(key) ? undefined : value,
  ),
)
const serveOldApi = (req) =>
  req.method() === 'GET' && new URL(req.url()).pathname.endsWith('/user/sessions')
    ? req.respond({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: oldBody,
      })
    : req.continue()
await page.setRequestInterception(true)
page.on('request', serveOldApi)
pageErrors.length = 0
await openSettings()
has(await rowText('Safari trên iOS'), '81.2.69.142 · hoạt động', 'dòng thu gọn quay về IP như cũ')
const oldApi = await openPanel('Safari trên iOS')
has(oldApi?.text, 'Không xác định được vị trí', 'panel báo không có vị trí thay vì vỡ')
is(pageErrors.length, 0, `không có lỗi JS${pageErrors.length ? `: ${pageErrors[0]}` : ''}`)
page.off('request', serveOldApi)
await page.setRequestInterception(false)

console.log('\n== 11. Điện thoại 375px và dark mode ==')
await page.setViewport({ width: 375, height: 812 })
await openSettings()
await openPanel('Safari trên iOS')
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
)
is(overflow <= 0, true, `không cuộn ngang ở 375px (thừa ${overflow}px)`)
await page.screenshot({ path: 'shots/loc-11-mobile.png', fullPage: true })
await page.evaluate(() => document.documentElement.classList.add('dark'))
await sleep(300)
const tileFilter = await page.evaluate(() => {
  const el = document.querySelector('[data-map-tiles]')
  return el ? getComputedStyle(el).filter : null
})
is(/brightness/.test(tileFilter ?? ''), true, `dark mode làm dịu tile (${tileFilter})`)
await page.screenshot({ path: 'shots/loc-11-mobile-dark.png', fullPage: true })

console.log('\n== 12. Console sạch ==')
const realErrors = consoleErrors.filter(
  (e) => !/401|favicon|Failed to load resource|ERR_FAILED/.test(e),
)
is(
  realErrors.length,
  0,
  `không có lỗi console lạ${realErrors.length ? `: ${realErrors[0]}` : ''}`,
)

await browser.close()
console.log(`\nTỔNG CUỐI: ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
