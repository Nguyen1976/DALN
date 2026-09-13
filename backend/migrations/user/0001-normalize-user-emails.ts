import type { ObjectId } from 'mongodb'
import type { Migration } from '@app/migrations'

// Chuẩn hoá User.email về dạng trim + chữ thường. Thay cho
// scripts/normalize-user-emails.mongosh.js (đã chạy tay trên prod, nên ở prod
// migration này không còn gì để làm).
//
// Vì sao: backend chuẩn hoá email ở đầu vào, mọi email gửi lên đều là chữ
// thường. Email cũ còn chữ hoa trong DB sẽ không khớp nữa và chủ tài khoản
// không đăng nhập được.
//
// An toàn: nếu có hai tài khoản trùng nhau khi bỏ qua hoa thường thì DỪNG,
// không ghi gì — trường hợp đó phải gộp tay rồi chạy lại.

type UserDoc = { _id: ObjectId; email?: unknown }

const normalize = (email: string) => email.trim().toLowerCase()

const migration: Migration = {
  id: '0001-normalize-user-emails',
  description:
    'Chuẩn hoá User.email về trim + chữ thường (dừng nếu trùng khi bỏ qua hoa thường)',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const users = db.collection<UserDoc>('User')
    const all = await users.find({}, { projection: { email: 1 } }).toArray()
    const withEmail = all.filter(
      (user): user is UserDoc & { email: string } =>
        typeof user.email === 'string',
    )

    const byNormalized = new Map<string, UserDoc[]>()
    for (const user of withEmail) {
      const key = normalize(user.email)
      byNormalized.set(key, [...(byNormalized.get(key) ?? []), user])
    }

    // Kiểm tra trùng TRƯỚC khi ghi bất cứ dòng nào.
    const collisions = [...byNormalized].filter(([, list]) => list.length > 1)
    if (collisions.length) {
      for (const [key, list] of collisions) {
        log(`  ${key}: ${list.map((user) => String(user._id)).join(', ')}`)
      }
      throw new Error(
        `${collisions.length} email trùng nhau khi bỏ qua hoa thường — cần gộp tay rồi chạy lại. Chưa ghi gì.`,
      )
    }

    const todo = withEmail.filter(
      (user) => user.email !== normalize(user.email),
    )
    log(`${all.length} tài khoản, ${todo.length} email cần chuẩn hoá`)

    for (const user of todo) {
      log(`  ${String(user._id)}: ${user.email} -> ${normalize(user.email)}`)
      if (dryRun) continue
      await users.updateOne(
        { _id: user._id },
        { $set: { email: normalize(user.email), updatedAt: new Date() } },
      )
    }
  },
}

export default migration
