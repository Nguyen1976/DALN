const { chromium } = require('playwright')
const EXPIRED = process.env.EXPIRED
;(async () => {
  const b = await chromium.launch({ headless: true, channel: 'chrome' })
  const ctx = await b.newContext()
  const p = await ctx.newPage()
  const netLog = []
  p.on('response', r => { if (r.url().includes(':8080')) netLog.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080','')}`) })

  await p.goto('http://localhost:5174/auth', { waitUntil: 'domcontentloaded' })
  await p.fill('input[type="email"]', 'nguyen2202794@gmail.com')
  await p.fill('input[placeholder="Nhập mật khẩu"]', '@Nguyen1976')
  await p.click('button[type="submit"]')
  await p.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 20000 })
  console.log('1) đăng nhập xong, URL =', p.url())

  const before = await ctx.cookies()
  console.log('\n2) cookie sau khi login:')
  before.forEach(c => console.log(`   ${c.name}  domain=${c.domain} path=${c.path} secure=${c.secure} sameSite=${c.sameSite} httpOnly=${c.httpOnly}`))

  // thay accessToken bằng bản HẾT HẠN, giữ nguyên refreshToken
  const acc = before.find(c => c.name === 'accessToken')
  await ctx.clearCookies()
  const kept = before.filter(c => c.name !== 'accessToken')
  await ctx.addCookies([...kept, { ...acc, value: EXPIRED }])
  console.log('\n3) đã thay accessToken bằng bản hết hạn (giữ refreshToken)')

  netLog.length = 0
  await p.goto('http://localhost:5174/', { waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)

  console.log('\n4) request tới API sau khi tải lại:')
  netLog.slice(0, 12).forEach(l => console.log('   ' + l))
  console.log('\n5) URL cuối:', p.url())
  const after = await ctx.cookies()
  const newAcc = after.find(c => c.name === 'accessToken')
  console.log('   accessToken đã đổi?', newAcc && newAcc.value !== EXPIRED ? 'CÓ (refresh thành công)' : 'KHÔNG')
  console.log('   còn refreshToken?', after.some(c => c.name === 'refreshToken') ? 'còn' : 'MẤT')
  console.log(p.url().includes('/auth') ? '\n   ==> BỊ ĐÁ RA TRANG ĐĂNG NHẬP' : '\n   ==> VẪN Ở TRONG APP')
  await b.close()
})()
