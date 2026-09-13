import type { ObjectId } from 'mongodb'
import type { Migration } from '@app/migrations'

// VÍ DỤ cho quy tắc "không ghi vào DB của service khác, đồng bộ lại bằng event".
//
// chat (conversationMember.fullName/avatar và peer*) và recommendation
// (userSnapshot) giữ BẢN SAO hồ sơ user. Khi bản sao lệch (event mất từ thời
// chưa có outbox, thêm field mới vào bản sao...), KHÔNG sửa thẳng DB của họ.
// Thay vào đó phát lại USER_UPDATED cho từng user qua outbox của CHÍNH
// user-service: OutboxRelay publish lên RabbitMQ, consumer của mỗi service tự
// cập nhật bản sao theo logic của mình (chat: updateByUserId, recommendation:
// syncUserUpdated).
//
// mode 'manual': mỗi user sinh một event, recommendation còn đánh dấu user
// "dirty" để tính lại — chỉ chạy khi thật sự cần:
//   npm run migrate:run -- 0002-resync-user-copies --service user
//
// Hình dạng document PHẢI khớp những gì enqueueOutbox (libs/saga/src/outbox.ts)
// + Prisma ghi vào collection OutboxEvent (apps/user/prisma/schema.prisma), vì
// OutboxRelay đọc bằng Prisma: status 'NEW', attempt 0, maxAttempts 10 (default
// của schema), nextAttemptAt/createdAt/updatedAt là Date, payload là object.
// Payload giống hệt UserUpdatedPayload mà user.service.updateProfile gửi.
//
// Nhịp: relay lấy 50 event mỗi lượt theo createdAt tăng dần, nên chèn 100
// event mỗi 5 giây (~20/s) để hàng đợi không phình và event saga thật không
// phải xếp sau hàng nghìn event resync.
//
// Idempotent + chạy tiếp được: messageId cố định theo user và ghi bằng upsert
// $setOnInsert, nên chạy lại (sau khi bị dừng) không sinh event trùng.

/** EXCHANGE_RMQ.USER_EVENTS — cố ý chép giá trị để migration tự đứng một mình. */
const EXCHANGE = 'user.events'
/** ROUTING_RMQ.USER_UPDATED */
const ROUTING_KEY = 'user.updated'
const OUTBOX_COLLECTION = 'OutboxEvent'
const ID = '0002-resync-user-copies'

type UserDoc = {
  _id: ObjectId
  fullName?: string | null
  bio?: string | null
  avatar?: string | null
}

const migration: Migration = {
  id: ID,
  description:
    'Phát lại USER_UPDATED cho mọi user qua outbox để chat/recommendation làm mới bản sao hồ sơ',
  mode: 'manual',
  async up({ db, dryRun, log, eachBatch }) {
    const outbox = db.collection(OUTBOX_COLLECTION)
    let queued = 0

    const result = await eachBatch<UserDoc>(
      {
        collection: 'User',
        projection: { fullName: 1, bio: 1, avatar: 1 },
        batchSize: 100,
        pauseMs: 5000,
      },
      async (users) => {
        if (dryRun) {
          log(`sẽ xếp ${users.length} event USER_UPDATED vào outbox`)
          return
        }

        const now = new Date()
        const res = await outbox.bulkWrite(
          users.map((user) => {
            const userId = String(user._id)
            const payload: Record<string, string> = {
              userId,
              fullName: user.fullName ?? '',
              bio: user.bio ?? '',
            }
            // Như updateProfile: chỉ gửi avatar khi có, để không xoá bản sao.
            if (user.avatar) payload.avatar = user.avatar

            const messageId = `${ID}:${userId}`
            return {
              updateOne: {
                filter: { messageId },
                update: {
                  $setOnInsert: {
                    messageId,
                    exchange: EXCHANGE,
                    routingKey: ROUTING_KEY,
                    payload,
                    status: 'NEW',
                    attempt: 0,
                    maxAttempts: 10,
                    nextAttemptAt: now,
                    createdAt: now,
                    updatedAt: now,
                  },
                },
                upsert: true,
              },
            }
          }),
          { ordered: false },
        )
        queued += res.upsertedCount
      },
    )

    log(
      dryRun
        ? `dry-run: ${result.docs} user, không ghi gì`
        : `${result.docs} user, xếp mới ${queued} event (phần còn lại đã có từ lần chạy trước)`,
    )
  },
}

export default migration
