/**
 * E2E realtime — hai trình duyệt độc lập, mô phỏng hai người dùng thật.
 *
 * Trọng tâm: bug "Trò chuyện trực tiếp". Khi B chấp nhận kết bạn, hội thoại
 * phải hiện ngay ở CẢ HAI phía kèm ĐÚNG tên đối phương — trước đây payload
 * realtime thiếu `members` nên rơi về chuỗi mặc định, chỉ đúng sau khi F5.
 *
 * Chạy:  node testing/e2e/realtime.spec.js
 * Biến:  BASE_UI (mặc định http://localhost:5174)
 *        API     (mặc định http://localhost:8080)
 *        HEADED=1 để xem trình duyệt chạy
 */
const { chromium } = require('playwright')

const BASE_UI = process.env.BASE_UI || 'http://localhost:5174'
const API = process.env.API || 'http://localhost:8080'
const HEADED = process.env.HEADED === '1'
const SEED = JSON.parse(process.env.E2E_SEED)

const [ALICE, BOB] = SEED.users
const PASSWORD = SEED.password

const results = []
let ctxA, ctxB, browser

function log(...a) { console.log('   ', ...a) }

async function tc(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`  ✓ ${name}  (${Date.now() - t0}ms)`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: e.message })
    console.log(`  ✗ ${name}  (${Date.now() - t0}ms)\n      ${e.message}`)
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg) }

/** Chờ tới khi fn() trả về giá trị truthy, hoặc hết hạn. */
async function waitFor(fn, { timeout = 15000, interval = 300, what = 'điều kiện' } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last } catch (e) { last = e.message }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`hết ${timeout}ms chờ ${what} (giá trị cuối: ${JSON.stringify(last)})`)
}

async function login(page, email) {
  await page.goto(`${BASE_UI}/auth`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', email)
  await page.fill('input[placeholder="Nhập mật khẩu"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20000 })
}

/** Gọi API bằng cookie phiên của chính trang đó. */
async function api(page, method, path, body) {
  return page.evaluate(
    async ([m, url, b]) => {
      const res = await fetch(url, {
        method: m,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: b ? JSON.stringify(b) : undefined,
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      return { status: res.status, body: json ?? text }
    },
    [method, `${API}${path}`, body ?? null],
  )
}

/**
 * Toàn bộ text đang hiển thị trên sidebar.
 * KHÔNG cắt lấy dòng đầu của button: dòng đầu là chữ cái avatar ("E"), tên
 * hội thoại nằm ở dòng sau. Trả nguyên text rồi để nơi gọi tự `includes`.
 */
async function sidebarText(page) {
  return page.evaluate(() => document.body.innerText || '')
}

;(async () => {
  // Dùng Chrome hệ thống: bản chromium mà playwright tải sẵn trong repo lệch
  // phiên bản (1234 vs 1228 mà bản playwright này yêu cầu).
  browser = await chromium.launch({ headless: !HEADED, channel: 'chrome' })
  ctxA = await browser.newContext()
  ctxB = await browser.newContext()
  const A = await ctxA.newPage()
  const B = await ctxB.newPage()

  const errsA = [], errsB = []
  A.on('pageerror', (e) => errsA.push(e.message))
  B.on('pageerror', (e) => errsB.push(e.message))

  console.log(`\n=== E2E realtime — ${ALICE.username} <-> ${BOB.username} ===\n`)

  await tc('TC1  Alice đăng nhập được', async () => {
    await login(A, ALICE.email)
    assert(!A.url().includes('/auth'), `vẫn ở trang auth: ${A.url()}`)
  })

  await tc('TC2  Bob đăng nhập được', async () => {
    await login(B, BOB.email)
    assert(!B.url().includes('/auth'), `vẫn ở trang auth: ${B.url()}`)
  })

  await tc('TC3  Ban đầu hai người CHƯA có hội thoại chung', async () => {
    const r = await api(A, 'GET', '/chat/conversations?limit=50')
    assert(r.status === 200, `status ${r.status}`)
    const withBob = (r.body.data || []).filter((c) => c.peerUserId === BOB.id)
    assert(withBob.length === 0, `đã có sẵn ${withBob.length} hội thoại với Bob`)
  })

  await tc('TC4  Alice gửi lời mời kết bạn', async () => {
    // DTO: MakeFriendDto chỉ nhận { email }; người gửi lấy từ phiên đăng nhập.
    const r = await api(A, 'POST', '/user/make-friend', { email: BOB.email })
    assert(r.status === 200 || r.status === 201, `status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`)
  })

  await tc('TC5  Bob thấy lời mời (realtime, không F5)', async () => {
    await waitFor(async () => {
      const r = await api(B, 'GET', '/user/list-friend-requests?direction=received&limit=20&page=1')
      const items = r.body?.data?.friendRequests ?? []
      return items.some((x) => x.fromUser?.id === ALICE.id)
    }, { what: 'lời mời xuất hiện phía Bob' })
  })

  let conversationId = null

  await tc('TC6a Đưa cả hai về màn danh sách TRƯỚC khi chấp nhận', async () => {
    // Bắt buộc cho TC6c: hội thoại phải xuất hiện qua sự kiện socket đẩy vào
    // store, KHÔNG qua một lần refetch HTTP nào.
    await A.goto(`${BASE_UI}/`, { waitUntil: 'networkidle' })
    await B.goto(`${BASE_UI}/`, { waitUntil: 'networkidle' })
    await B.waitForTimeout(1000)
    const before = await sidebarText(B)
    assert(!before.includes(ALICE.username), 'sidebar Bob đã có tên Alice từ trước')
  })

  await tc('TC6  Bob chấp nhận -> hội thoại xuất hiện ở phía BOB', async () => {
    // DTO: UpdateStatusMakeFriendDto = { status, inviterId, inviteeName }.
    // inviteeId được suy ra từ phiên của người bấm chấp nhận.
    const r = await api(B, 'POST', '/user/update-status-make-friend', {
      status: 'ACCEPTED', inviterId: ALICE.id, inviteeName: BOB.username,
    })
    assert(r.status === 200 || r.status === 201, `accept status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`)

    const conv = await waitFor(async () => {
      const c = await api(B, 'GET', '/chat/conversations?limit=50')
      return (c.body.data || []).find((x) => x.peerUserId === ALICE.id)
    }, { what: 'hội thoại DIRECT với Alice' })
    conversationId = conv.id
  })

  await tc('TC6c REGRESSION: hội thoại hiện qua SOCKET với tên đúng (KHÔNG F5)', async () => {
    // Đây là test bắt đúng bug gốc. Payload `chat.new_conversation` từng chỉ
    // mang { id, type, memberIds }; ConversationMapper không tìm được đối
    // phương nên trả displayName = "Trò chuyện trực tiếp", và giao diện hiện
    // sai cho tới khi người dùng tải lại trang.
    // Tuyệt đối KHÔNG reload/goto trong test này.
    await waitFor(async () => (await sidebarText(B)).includes(ALICE.username), {
      what: `tên '${ALICE.username}' xuất hiện qua socket ở sidebar Bob`,
      timeout: 20000,
    })
    const text = await sidebarText(B)
    assert(!text.includes('Trò chuyện trực tiếp'),
      'socket đẩy về tên mặc định "Trò chuyện trực tiếp" — payload thiếu thông tin đối phương')
  })

  await tc('TC6d REGRESSION: phía ALICE cũng nhận đúng tên qua socket', async () => {
    await waitFor(async () => (await sidebarText(A)).includes(BOB.username), {
      what: `tên '${BOB.username}' xuất hiện qua socket ở sidebar Alice`,
      timeout: 20000,
    })
    assert(!(await sidebarText(A)).includes('Trò chuyện trực tiếp'),
      'sidebar Alice hiện tên mặc định')
  })

  await tc('TC7  BUG CŨ: tên hội thoại phía Bob KHÔNG phải "Trò chuyện trực tiếp"', async () => {
    const c = await api(B, 'GET', '/chat/conversations?limit=50')
    const conv = (c.body.data || []).find((x) => x.peerUserId === ALICE.id)
    assert(conv, 'không tìm thấy hội thoại')
    assert(conv.displayName !== 'Trò chuyện trực tiếp',
      `vẫn rơi về tên mặc định: displayName='${conv.displayName}'`)
    assert(conv.displayName === ALICE.username,
      `tên sai: mong '${ALICE.username}', nhận '${conv.displayName}'`)
  })

  await tc('TC8  Tên hội thoại phía ALICE cũng đúng', async () => {
    const conv = await waitFor(async () => {
      const c = await api(A, 'GET', '/chat/conversations?limit=50')
      return (c.body.data || []).find((x) => x.peerUserId === BOB.id)
    }, { what: 'hội thoại phía Alice' })
    assert(conv.displayName === BOB.username,
      `tên sai: mong '${BOB.username}', nhận '${conv.displayName}'`)
  })

  await tc('TC9  Truy vấn danh sách KHÔNG còn kéo members', async () => {
    const c = await api(A, 'GET', '/chat/conversations?limit=50')
    const conv = (c.body.data || []).find((x) => x.peerUserId === BOB.id)
    assert((conv.members || []).length === 0,
      `vẫn trả ${conv.members.length} members — tối ưu chưa có hiệu lực`)
    assert(conv.peerUserId === BOB.id, 'thiếu peerUserId')
  })

  await tc('TC10 Sidebar của Bob hiển thị tên Alice (giao diện thật)', async () => {
    await B.reload({ waitUntil: 'networkidle' })
    await waitFor(async () => (await sidebarText(B)).includes(ALICE.username),
      { what: `tên '${ALICE.username}' trên sidebar Bob` })
    const text = await sidebarText(B)
    assert(!text.includes('Trò chuyện trực tiếp'),
      'sidebar vẫn hiện "Trò chuyện trực tiếp"')
  })

  const MSG_A = `alice-xin-chao-${Date.now()}`
  const MSG_B = `bob-tra-loi-${Date.now()}`

  await tc('TC11 Alice gửi tin nhắn từ giao diện', async () => {
    await A.goto(`${BASE_UI}/chat/${conversationId}`, { waitUntil: 'networkidle' })
    await A.fill('textarea[placeholder="Nhập tin nhắn…"]', MSG_A)
    await A.keyboard.press('Enter')
    await waitFor(async () => (await A.content()).includes(MSG_A),
      { what: 'tin nhắn hiện ở phía Alice' })
  })

  await tc('TC12 Bob nhận tin nhắn REALTIME (không F5)', async () => {
    await B.goto(`${BASE_UI}/chat/${conversationId}`, { waitUntil: 'networkidle' })
    await A.fill('textarea[placeholder="Nhập tin nhắn…"]', MSG_A + '-2')
    await A.keyboard.press('Enter')
    await waitFor(async () => (await B.content()).includes(MSG_A + '-2'),
      { what: 'tin nhắn realtime tới Bob', timeout: 20000 })
  })

  await tc('TC13 Bob trả lời -> Alice nhận REALTIME', async () => {
    await B.fill('textarea[placeholder="Nhập tin nhắn…"]', MSG_B)
    await B.keyboard.press('Enter')
    await waitFor(async () => (await A.content()).includes(MSG_B),
      { what: 'tin nhắn realtime tới Alice', timeout: 20000 })
  })

  await tc('TC14 Tin nhắn được lưu bền (F5 vẫn còn)', async () => {
    await A.reload({ waitUntil: 'networkidle' })
    await waitFor(async () => (await A.content()).includes(MSG_B),
      { what: 'tin nhắn còn sau khi tải lại' })
  })

  await tc('TC15 Tên đối phương vẫn đúng sau F5', async () => {
    await A.goto(`${BASE_UI}/`, { waitUntil: 'networkidle' })
    await waitFor(async () => (await sidebarText(A)).includes(BOB.username),
      { what: `tên '${BOB.username}' sau khi tải lại` })
    assert(!(await sidebarText(A)).includes('Trò chuyện trực tiếp'),
      'sidebar Alice hiện "Trò chuyện trực tiếp"')
  })

  await tc('TC16 Không có lỗi JavaScript ở cả hai trình duyệt', async () => {
    assert(errsA.length === 0, `Alice: ${errsA.slice(0, 3).join(' | ')}`)
    assert(errsB.length === 0, `Bob: ${errsB.slice(0, 3).join(' | ')}`)
  })

  await browser.close()

  const pass = results.filter((r) => r.ok).length
  console.log(`\n=== KẾT QUẢ: ${pass}/${results.length} đạt ===`)
  results.filter((r) => !r.ok).forEach((r) => console.log(`  HỎNG: ${r.name} — ${r.err}`))
  process.exit(pass === results.length ? 0 : 1)
})().catch(async (e) => {
  console.error('LỖI NGOÀI TEST:', e)
  if (browser) await browser.close()
  process.exit(2)
})
