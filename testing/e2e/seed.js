/**
 * Tạo 2 tài khoản test cho bộ e2e. Chạy TRONG container daln-user.
 * Mọi bản ghi đều mang tiền tố E2E_MARK để cleanup.js xoá sạch được.
 */
const { PrismaClient } = require('/app/apps/user/src/generated')
const bcrypt = require('bcryptjs')

const MARK = 'e2e-realtime'
const PASSWORD = 'E2e@Test1976'

const USERS = [
  { email: `${MARK}-alice@example.test`, username: `${MARK}-alice`, fullName: 'E2E Alice' },
  { email: `${MARK}-bob@example.test`,   username: `${MARK}-bob`,   fullName: 'E2E Bob' },
]

;(async () => {
  const prisma = new PrismaClient()
  await prisma.$connect()
  const hash = await bcrypt.hash(PASSWORD, 10)
  const out = []

  for (const u of USERS) {
    // xoá bản cũ nếu lần chạy trước chết giữa chừng
    await prisma.user.deleteMany({ where: { email: u.email } })
    const created = await prisma.user.create({
      data: {
        email: u.email,
        username: u.username,
        fullName: u.fullName,
        password: hash,
        isActive: true,                       // bỏ qua OTP
        interests: [],
        hasCompletedInterestOnboarding: true, // vào thẳng chat
      },
    })
    out.push({ id: created.id, email: u.email, username: u.username, fullName: u.fullName })
  }

  // đảm bảo hai người CHƯA kết bạn — bộ test cần đi qua luồng gửi + chấp nhận
  const ids = out.map((u) => u.id)
  await prisma.friendship.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { friendId: { in: ids } }] },
  })
  await prisma.friendRequest.deleteMany({
    where: { OR: [{ fromUserId: { in: ids } }, { toUserId: { in: ids } }] },
  })

  console.log(JSON.stringify({ password: PASSWORD, users: out }, null, 2))
  await prisma.$disconnect()
})().catch((e) => { console.error('SEED LỖI:', e.message); process.exit(1) })
