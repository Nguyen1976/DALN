/**
 * Backfill nhóm: chat-service (conversation type GROUP + conversationMember)
 *                 ->  recommendation-service.GroupMembership
 *
 * RCM dùng dữ liệu nhóm để tính common-groups / group features. Sau backfill,
 * thay đổi mới (join/leave group) tự đồng bộ qua RabbitMQ
 * (GroupMembershipSubscriber -> FriendGraphService.upsert/removeGroupMembership).
 *
 * Chạy:  node database/backfill_group_membership_to_rcm.js
 */
const { MongoClient } = require('mongodb')

const SOURCE_URI =
  process.env.CHAT_MONGO_URI ||
  'mongodb://localhost:27017/chat-service?replicaSet=rs0'
const TARGET_URI =
  process.env.RCM_MONGO_URI ||
  'mongodb://localhost:27017/recommendation-service?replicaSet=rs0'
const SOURCE_DB = process.env.CHAT_DB_NAME || 'chat-service'
const TARGET_DB = process.env.RCM_DB_NAME || 'recommendation-service'
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 5000)

async function ensureIndex(col) {
  for (const spec of [
    [{ userId: 1, conversationId: 1 }, { unique: true }],
    [{ userId: 1 }, {}],
    [{ conversationId: 1 }, {}],
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

    const chatDb = sourceClient.db(SOURCE_DB)
    const convCol = chatDb.collection('conversation')
    const memberCol = chatDb.collection('conversationMember')
    const targetCol = targetClient.db(TARGET_DB).collection('GroupMembership')

    console.log('⏳ Tạo index trên recommendation-service.GroupMembership...')
    await ensureIndex(targetCol)

    const groupCursor = convCol.find({ type: 'GROUP' })
    let ops = []
    let processedGroups = 0
    let processedMembers = 0

    console.log('🚀 Bắt đầu backfill group membership...')

    while (await groupCursor.hasNext()) {
      const group = await groupCursor.next()
      const conversationId = group._id.toString()
      const groupName = group.groupName ?? null

      // Chỉ lấy member đang active
      const members = await memberCol
        .find({ conversationId: group._id, isActive: { $ne: false } })
        .toArray()

      for (const m of members) {
        const userId = m.userId?.toString()
        if (!userId) continue
        const doc = { userId, conversationId }
        ops.push({
          updateOne: {
            filter: doc,
            update: {
              $set: { groupName },
              $setOnInsert: { ...doc, createdAt: new Date() },
            },
            upsert: true,
          },
        })
        processedMembers++

        if (ops.length >= BATCH_SIZE) {
          await flush(targetCol, ops)
          ops = []
        }
      }

      processedGroups++
      if (processedGroups % 500 === 0) {
        console.log(
          `✅ Tiến độ: ${processedGroups} groups, ${processedMembers} memberships...`,
        )
      }
    }

    await flush(targetCol, ops)

    const finalCount = await targetCol.countDocuments()
    console.log(
      `\n🎉 HOÀN TẤT! ${processedGroups} groups. recommendation-service.GroupMembership: ${finalCount} bản ghi.`,
    )
  } catch (err) {
    console.error('❌ Lỗi:', err)
    process.exitCode = 1
  } finally {
    await sourceClient.close()
    await targetClient.close()
  }
}

main()
