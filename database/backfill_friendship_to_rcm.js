/**
 * Backfill bạn bè: user-service.Friendship  ->  recommendation-service.Friendship
 *
 * RCM service cần dữ liệu bạn bè ở DB riêng của nó (Neo4j giờ chỉ dùng để train).
 * Sau lần backfill này, mọi thay đổi mới (kết bạn) sẽ tự đồng bộ bất đồng bộ qua
 * RabbitMQ (FriendshipRecommendationSubscriber -> FriendGraphService.upsertFriendship).
 *
 * Chạy:  node database/backfill_friendship_to_rcm.js
 */
const { MongoClient } = require('mongodb')

const SOURCE_URI =
  process.env.USER_MONGO_URI ||
  'mongodb://localhost:27017/user-service?replicaSet=rs0'
const TARGET_URI =
  process.env.RCM_MONGO_URI ||
  'mongodb://localhost:27017/recommendation-service?replicaSet=rs0'
const SOURCE_DB = process.env.USER_DB_NAME || 'user-service'
const TARGET_DB = process.env.RCM_DB_NAME || 'recommendation-service'
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 5000)

async function ensureIndex(col) {
  // Prisma db push may already have created these indexes under different names.
  for (const spec of [
    [{ userId: 1, friendId: 1 }, { unique: true }],
    [{ userId: 1 }, {}],
    [{ friendId: 1 }, {}],
  ]) {
    try {
      await col.createIndex(spec[0], spec[1])
    } catch (e) {
      if (e.code !== 85 && e.codeName !== 'IndexOptionsConflict') throw e
    }
  }
}

async function flush(targetCol, ops) {
  if (!ops.length) return
  await targetCol.bulkWrite(ops, { ordered: false })
}

async function main() {
  const sourceClient = new MongoClient(SOURCE_URI)
  const targetClient = new MongoClient(TARGET_URI)

  try {
    await sourceClient.connect()
    await targetClient.connect()

    const sourceCol = sourceClient.db(SOURCE_DB).collection('Friendship')
    const targetCol = targetClient.db(TARGET_DB).collection('Friendship')

    console.log('⏳ Tạo index trên recommendation-service.Friendship...')
    await ensureIndex(targetCol)

    const total = await sourceCol.countDocuments()
    console.log(`🚀 Bắt đầu backfill ${total} bản ghi Friendship...`)

    const cursor = sourceCol.find({})
    let ops = []
    let count = 0

    while (await cursor.hasNext()) {
      const doc = await cursor.next()
      const userId = doc.userId?.toString()
      const friendId = doc.friendId?.toString()
      if (!userId || !friendId || userId === friendId) continue

      // Lưu bidirectional (mỗi chiều 1 bản ghi) để truy vấn neighbor nhanh.
      for (const pair of [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ]) {
        ops.push({
          updateOne: {
            filter: pair,
            update: { $setOnInsert: { ...pair, createdAt: new Date() } },
            upsert: true,
          },
        })
      }

      if (ops.length >= BATCH_SIZE) {
        await flush(targetCol, ops)
        count += ops.length
        console.log(`✅ Đã xử lý ~${count} thao tác upsert...`)
        ops = []
      }
    }

    await flush(targetCol, ops)
    count += ops.length

    const finalCount = await targetCol.countDocuments()
    console.log(`\n🎉 HOÀN TẤT! recommendation-service.Friendship: ${finalCount} bản ghi.`)
  } catch (err) {
    console.error('❌ Lỗi:', err)
    process.exitCode = 1
  } finally {
    await sourceClient.close()
    await targetClient.close()
  }
}

main()
