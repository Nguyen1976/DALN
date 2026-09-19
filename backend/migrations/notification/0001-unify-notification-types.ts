import type { Migration } from '@app/migrations'

// Loại thông báo đã lưu dùng hai tên khác với tên trong cài đặt: lời mời kết
// bạn là FRIEND_REQUEST (cài đặt: FRIEND_REQUEST_SENT), lời mời bị từ chối là
// NORMAL_NOTIFICATION (cài đặt: FRIEND_REQUEST_REJECTED). Đổi về một bộ tên
// để công tắc trong cài đặt khớp với thứ thật sự được gửi, và để client nhận
// ra lời mời bị từ chối.

const RENAMES: Array<[from: string, to: string]> = [
  ['FRIEND_REQUEST', 'FRIEND_REQUEST_SENT'],
  ['NORMAL_NOTIFICATION', 'FRIEND_REQUEST_REJECTED'],
]

const migration: Migration = {
  id: '0001-unify-notification-types',
  description: 'Đổi FRIEND_REQUEST/NORMAL_NOTIFICATION sang tên loại trong cài đặt',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const notifications = db.collection('notification')
    for (const [from, to] of RENAMES) {
      if (dryRun) {
        const n = await notifications.countDocuments({ type: from })
        log(`${n} thông báo ${from} sẽ đổi thành ${to}`)
        continue
      }
      const res = await notifications.updateMany(
        { type: from },
        { $set: { type: to } },
      )
      log(`Đã đổi ${res.modifiedCount} thông báo ${from} -> ${to}`)
    }
  },
}

export default migration
