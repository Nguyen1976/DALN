/**
 * QC trình duyệt cho cuộc gọi (spec realtimekit-calls §7).
 *
 *   node qc/calls-browser.mjs                  # dev: tự dựng 3 tài khoản
 *   APP=https://nguyen1976.xyz API=https://nguyen1976.xyz/api \
 *     QC_ACCOUNTS_FILE=qc/.env.prod.json node qc/calls-browser.mjs   # prod
 *
 * Mỗi tài khoản một Chrome riêng, camera/mic giả (Chrome phát hình chuyển động +
 * tiếng bíp). Kiểm cả media chạy thật: video có khung hình và thời gian tăng,
 * audio có năng lượng khác 0 — không chỉ kiểm giao diện.
 */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fixtures } from './calls-fixtures.mjs'

const APP = process.env.APP ?? 'http://localhost:5174'
const API = process.env.API ?? 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ONLY = process.env.ONLY // vd ONLY=direct hoặc ONLY=group

let pass = 0
let fail = 0
const ok = (m) => { console.log(`  ✅ ${m}`); pass++ }
const bad = (m) => { console.log(`  ❌ ${m}`); fail++ }
const check = (cond, label, detail = '') => (cond ? ok(label) : bad(`${label}${detail ? ` — ${detail}` : ''}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync('shots', { recursive: true })

async function until(fn, ms = 15000, step = 300) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return true } catch {}
    await sleep(step)
  }
  return false
}

async function openBrowser(account) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860 })
  // Đăng nhập qua UI như người dùng thật: app chỉ coi là đã đăng nhập khi đi qua
  // form (nó giữ user trong store), cookie đặt riêng bằng fetch là chưa đủ.
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('input[name="email"]', { timeout: 15000 })
  await page.type('input[name="email"]', account.email)
  await page.type('input[name="password"]', account.password)
  await page.click('button[type="submit"]')
  await until(async () => !page.url().includes('/auth'), 20000)
  if (page.url().includes('/onboarding')) {
    await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => /Bỏ qua/.test(b.textContent ?? ''))
        ?.click(),
    )
    await sleep(2000)
  }
  return { browser, page, account }
}

const text = (page) => page.evaluate(() => document.body.innerText)
const hasText = (page, needle) => text(page).then((t) => t.includes(needle))

/** Bấm nút theo tên truy cập (aria-label / title / chữ trên nút). */
async function press(page, name) {
  const el = await page.waitForSelector(`::-p-aria(${name})`, { timeout: 10000 })
  await el.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await el.click()
}

async function openConversation(page, id) {
  await page.goto(`${APP}/chat/${id}`, { waitUntil: 'networkidle2' })
  await sleep(800)
}

/** Video có khung hình thật: kích thước > 0 và currentTime tăng. */
const videoFlowing = (page, selector) =>
  page.evaluate(async (sel) => {
    const v = [...document.querySelectorAll(sel)].find((n) => n.srcObject && n.offsetParent !== null)
    if (!v || v.videoWidth === 0) return false
    const t0 = v.currentTime
    await new Promise((r) => setTimeout(r, 800))
    return v.currentTime > t0
  }, selector)

/** Có âm thanh thật từ phía kia: đo năng lượng trên mọi <audio> đang phát. */
const audioFlowing = (page) =>
  page.evaluate(async () => {
    const els = [...document.querySelectorAll('audio')].filter((a) => a.srcObject)
    if (!els.length) return false
    const ctx = new AudioContext()
    let peak = 0
    for (const el of els) {
      const src = ctx.createMediaStreamSource(el.srcObject)
      const an = ctx.createAnalyser()
      src.connect(an)
      const buf = new Uint8Array(an.fftSize)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 100))
        an.getByteTimeDomainData(buf)
        for (const x of buf) peak = Math.max(peak, Math.abs(x - 128))
      }
    }
    await ctx.close()
    return peak > 2
  })

async function shot(page, name) {
  await page.screenshot({ path: `shots/calls-${name}.png` })
}

async function direct({ A, B, directId }) {
  console.log('\n== Gọi 1-1 ==')
  await openConversation(A.page, directId)

  // §7.1–5: gọi video, người nhận thấy màn hình đến, nhận kèm camera, media chạy
  await press(A.page, 'Gọi video')
  if (await until(() => hasText(A.page, 'Xem trước'), 5000)) await press(A.page, 'Gọi')
  check(await until(() => hasText(A.page, 'Đang gọi')), '[§7.4] bên gọi thấy "Đang gọi..."')
  check(await until(() => hasText(B.page, 'Cuộc gọi đến')), '[§7.2] bên nhận thấy "Cuộc gọi đến..."')
  await press(B.page, 'Nhận cuộc gọi video')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.5] bên gọi thấy video bên kia')
  check(await until(() => videoFlowing(B.page, 'video')), '[§7.5] bên nhận thấy video bên kia')
  check(await until(() => audioFlowing(A.page)), '[§7.5] bên gọi nghe được tiếng')
  check(await until(() => audioFlowing(B.page)), '[§7.5] bên nhận nghe được tiếng')
  await shot(A.page, 'direct-video-caller')

  // §7.6 tắt micro -> bên kia thấy nhãn
  await press(B.page, 'Tắt micro')
  check(await until(() => hasText(A.page, 'đã tắt micro')), '[§7.6] bên kia thấy "… đã tắt micro"')
  await press(B.page, 'Bật micro')
  check(await until(async () => !(await hasText(A.page, 'đã tắt micro'))), '[§7.6] bật lại thì nhãn biến mất')

  // §7.7 tắt camera -> bên kia thấy avatar; bật lại thấy video (không đứng hình)
  await press(B.page, 'Tắt camera')
  check(
    // VoiceCallModal giữ thẻ <video> của đối phương nhưng thêm class `invisible`
    // và hiện avatar khi camera bên kia tắt.
    await until(() => A.page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.classList.contains('invisible')))),
    '[§7.7] tắt camera: bên kia thấy avatar thay khung video',
  )
  await press(B.page, 'Bật camera')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.7] bật lại: video B chạy lại, không đứng hình')

  // §7.15 thu nhỏ + chuyển trang, cuộc gọi vẫn còn
  await press(A.page, 'Thu nhỏ cuộc gọi')
  await A.page.goto(`${APP}/settings/account`, { waitUntil: 'networkidle2' }).catch(() => {})
  check(await until(() => hasText(A.page, 'Mở lại cuộc gọi')), '[§7.15] thu nhỏ: còn thanh "Mở lại cuộc gọi" sau khi chuyển trang')
  check(await until(() => audioFlowing(A.page)), '[§7.15] thu nhỏ: vẫn nghe tiếng')
  await press(A.page, 'Mở lại cuộc gọi')

  // §7.14 kết thúc -> nhật ký có thời lượng
  await sleep(2500)
  await press(A.page, 'Kết thúc cuộc gọi')
  await openConversation(A.page, directId)
  check(await until(() => hasText(A.page, 'Cuộc gọi video')), '[§7.14] nhật ký "Cuộc gọi video"')
  check(await until(() => A.page.evaluate(() => /\d+ giây/.test(document.body.innerText))), '[§7.14] nhật ký có thời lượng')

  // §7.9 từ chối
  await openConversation(A.page, directId)
  await press(A.page, 'Gọi thoại')
  await until(() => hasText(B.page, 'Cuộc gọi đến'))
  await press(B.page, 'Từ chối cuộc gọi')
  check(await until(() => hasText(A.page, 'Bị từ chối') || hasText(A.page, 'bị từ chối')), '[§7.9] từ chối: bên gọi/nhật ký thấy "Bị từ chối"')

  // §7.3 nhận chỉ âm thanh cho cuộc gọi video; §7.27 không bật được camera trong cuộc gọi thoại
  await openConversation(A.page, directId)
  await press(A.page, 'Gọi video')
  if (await until(() => hasText(A.page, 'Xem trước'), 5000)) await press(A.page, 'Gọi')
  await until(() => hasText(B.page, 'Cuộc gọi đến'))
  await press(B.page, 'Nhận chỉ âm thanh')
  check(await until(() => videoFlowing(B.page, 'video')), '[§7.3] nhận chỉ âm thanh vẫn thấy video người gọi')
  check(await until(() => audioFlowing(A.page)), '[§7.3] người gọi nghe được tiếng')
  await press(A.page, 'Kết thúc cuộc gọi')
  await sleep(1500)

  // §7.10 không ai nhận 30 giây -> "Người dùng bận" + nhật ký nhỡ
  await openConversation(A.page, directId)
  await press(A.page, 'Gọi thoại')
  check(await until(() => hasText(A.page, 'Người dùng bận'), 40000), '[§7.10] hết 30 giây: "Người dùng bận"')
  await openConversation(A.page, directId)
  check(await until(() => hasText(A.page, 'Cuộc gọi nhỡ')), '[§7.10] nhật ký "Cuộc gọi nhỡ"')
}

async function group({ A, B, C, groupId }) {
  console.log('\n== Gọi nhóm ==')
  await openConversation(A.page, groupId)
  await openConversation(C.page, groupId)

  await press(A.page, 'Gọi video nhóm')
  if (await until(() => hasText(A.page, 'Xem trước'), 5000)) await press(A.page, 'Bắt đầu')
  check(await until(() => hasText(B.page, 'đang mời bạn vào cuộc gọi')), '[§7.17] thành viên thấy lời mời')
  await press(B.page, 'Tham gia cuộc gọi nhóm')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.18] A thấy video của B')
  check(await until(() => audioFlowing(B.page)), '[§7.18] B nghe được A')

  // §7.22 banner + chấm "Đang gọi…" cho C chưa vào
  check(await until(() => hasText(C.page, 'Đang có cuộc gọi')), '[§7.22] C thấy banner "Đang có cuộc gọi…"')
  await press(C.page, 'Tham gia')
  check(await until(() => A.page.evaluate(() => document.querySelectorAll('video').length >= 2)), '[§7.18] A thấy thêm tile khi C vào')

  // §7.19 ghim
  await press(A.page, 'Ghim')
  check(await until(() => hasText(A.page, 'Bỏ ghim')), '[§7.19] ghim được một người')
  await press(A.page, 'Bỏ ghim')

  // §7.20 huy hiệu tắt micro
  await press(B.page, 'Tắt micro')
  check(await until(() => hasText(A.page, 'Đã tắt micro')), '[§7.20] A thấy B "Đã tắt micro"')

  // §7.21 bật lại camera hiện hình ngay
  await press(B.page, 'Tắt camera')
  await sleep(1000)
  await press(B.page, 'Bật camera')
  check(await until(() => videoFlowing(A.page, 'video')), '[§7.21] bật lại camera: hình hiện lại ngay')
  await shot(A.page, 'group-video')

  // §7.23–24 rời; người cuối rời -> ~15 giây sau ended + nhật ký
  await press(C.page, 'Rời cuộc gọi')
  await press(B.page, 'Rời cuộc gọi')
  await press(A.page, 'Rời cuộc gọi')
  check(await until(async () => !(await hasText(C.page, 'Đang có cuộc gọi')), 30000), '[§7.24] banner biến mất sau khi mọi người rời')
  await openConversation(A.page, groupId)
  check(await until(() => hasText(A.page, 'Cuộc gọi video nhóm'), 30000), '[§7.24] nhật ký "Cuộc gọi video nhóm"')
}

async function main() {
  // Dev: bộ QC đăng nhập nhiều lần hơn hạn mức (30 lần / 5 phút / IP) — dọn xô
  // hạn mức của chính nó trước, như auth-api.sh.
  if (!process.env.QC_ACCOUNTS_FILE) {
    execSync(
      `docker exec ${process.env.REDIS_CONTAINER ?? 'daln-redis'} sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`,
    )
  }
  const fx = await fixtures()
  const A = await openBrowser(fx.a)
  const B = await openBrowser(fx.b)
  const C = await openBrowser(fx.c)
  try {
    if (!ONLY || ONLY === 'direct') await direct({ A, B, directId: fx.directId })
    if (!ONLY || ONLY === 'group') await group({ A, B, C, groupId: fx.groupId })
  } catch (error) {
    bad(`lỗi dừng bộ QC: ${error.message}`)
    await shot(A.page, 'crash-a').catch(() => {})
  } finally {
    await Promise.all([A, B, C].map((x) => x.browser.close()))
  }
  console.log(`\nTỔNG: ${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

main()
