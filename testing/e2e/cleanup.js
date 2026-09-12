/**
 * Xoá sạch mọi dữ liệu do bộ e2e sinh ra: user, friendship, friendRequest
 * (user-service) và conversation, member, message (chat-service).
 * Chạy TRONG container daln-user; chat-service dùng connection string riêng.
 */
const { PrismaClient: UserPrisma } = require('/app/apps/user/src/generated')
const { MongoClient, ObjectId } = require('mongodb')

const MARK = 'e2e-realtime'
const CHAT_URI = process.env.CHAT_DATABASE_URL

;(async () => {
  const prisma = new UserPrisma()
  await prisma.$connect()

  const users = await prisma.user.findMany({
    where: { email: { startsWith: MARK } },
    select: { id: true, email: true },
  })
  const ids = users.map((u) => u.id)
  console.log(`tìm thấy ${users.length} user e2e`)

  let convCount = 0, memberCount = 0, msgCount = 0
  if (ids.length && CHAT_URI) {
    const mongo = new MongoClient(CHAT_URI)
    await mongo.connect()
    const db = mongo.db()
    const oids = ids.map((i) => new ObjectId(i))

    const memberRows = await db.collection('conversationMember')
      .find({ userId: { $in: oids } }, { projection: { conversationId: 1 } }).toArray()
    const convIds = [...new Set(memberRows.map((m) => String(m.conversationId)))]
      .map((i) => new ObjectId(i))

    if (convIds.length) {
      msgCount = (await db.collection('message').deleteMany({ conversationId: { $in: convIds } })).deletedCount
      memberCount = (await db.collection('conversationMember').deleteMany({ conversationId: { $in: convIds } })).deletedCount
      convCount = (await db.collection('conversation').deleteMany({ _id: { $in: convIds } })).deletedCount
    }
    await mongo.close()
  }

  const fr = await prisma.friendRequest.deleteMany({
    where: { OR: [{ fromUserId: { in: ids } }, { toUserId: { in: ids } }] },
  })
  const fs = await prisma.friendship.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { friendId: { in: ids } }] },
  })
  const us = await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } })

  console.log(`đã xoá: ${us.count} user, ${fs.count} friendship, ${fr.count} friendRequest, ` +
              `${convCount} conversation, ${memberCount} member, ${msgCount} message`)

  const left = await prisma.user.count({ where: { email: { startsWith: MARK } } })
  console.log(left === 0 ? 'SẠCH' : `CÒN SÓT ${left} user`)
  await prisma.$disconnect()
})().catch((e) => { console.error('CLEANUP LỖI:', e.message); process.exit(1) })
