import type { Migration } from '@app/migrations'

// Friendship.friend và friendRequest.fromUser/toUser giờ là quan hệ Prisma bắt
// buộc: danh sách bạn và lời mời đọc người kia qua quan hệ thay vì tự ghép
// bằng `$in` + Map. Một dòng trỏ tới user không còn tồn tại sẽ làm Prisma báo
// lỗi cho cả trang (trước đây dòng đó bị bỏ qua lặng lẽ). App không có đường
// xoá user, nhưng dữ liệu dọn tay thì có thể để lại dòng mồ côi — xoá chúng
// trước khi app mới lên.

const migration: Migration = {
  id: '0003-drop-orphan-friend-rows',
  description: 'Xoá Friendship/friendRequest trỏ tới user không còn tồn tại',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const users = new Set(
      (
        await db
          .collection('User')
          .find({}, { projection: { _id: 1 } })
          .toArray()
      ).map((user) => String(user._id)),
    )
    const missing = (id: unknown) => !users.has(String(id))

    for (const [name, fields] of [
      ['Friendship', ['userId', 'friendId']],
      ['friendRequest', ['fromUserId', 'toUserId']],
    ] as const) {
      const collection = db.collection(name)
      const orphans = (
        await collection
          .find({}, { projection: { _id: 1, [fields[0]]: 1, [fields[1]]: 1 } })
          .toArray()
      )
        .filter((row) => fields.some((field) => missing(row[field])))
        .map((row) => row._id)

      if (dryRun || !orphans.length) {
        log(
          `${orphans.length} dòng ${name} mồ côi${dryRun ? ' sẽ bị xoá' : ''}`,
        )
        continue
      }
      const res = await collection.deleteMany({ _id: { $in: orphans } })
      log(`Đã xoá ${res.deletedCount} dòng ${name} mồ côi`)
    }
  },
}

export default migration
