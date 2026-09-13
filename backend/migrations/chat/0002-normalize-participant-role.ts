import type { Migration } from '@app/migrations'

// Chuẩn hoá conversationMember.role về enum participantRole (OWNER | ADMIN |
// MEMBER). Dữ liệu cũ lưu chữ thường ('member'/'admin'/'owner') hoặc thiếu
// role, khiến Prisma ném "Value 'member' not found in enum 'participantRole'".
//
// Trước đây ConversationRepository và ConversationMemberRepository chạy đúng
// lệnh này lúc runtime (forceBackfillParticipantRole), kèm retry khi gặp lỗi
// enum. Giờ chạy một lần ở bước deploy.

const FILTER = {
  $or: [
    { role: null },
    { role: { $exists: false } },
    { role: 'member' },
    { role: 'admin' },
    { role: 'owner' },
  ],
}

const UPDATE = [
  {
    $set: {
      role: {
        $switch: {
          branches: [
            { case: { $eq: ['$role', 'admin'] }, then: 'ADMIN' },
            { case: { $eq: ['$role', 'owner'] }, then: 'OWNER' },
            { case: { $eq: ['$role', 'member'] }, then: 'MEMBER' },
          ],
          default: 'MEMBER',
        },
      },
    },
  },
]

const migration: Migration = {
  id: '0002-normalize-participant-role',
  description:
    'Chuẩn hoá conversationMember.role chữ thường/thiếu về OWNER/ADMIN/MEMBER',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const members = db.collection('conversationMember')
    if (dryRun) {
      const n = await members.countDocuments(FILTER)
      log(`${n} conversationMember có role cũ/thiếu sẽ được chuẩn hoá`)
      return
    }
    const res = await members.updateMany(FILTER, UPDATE)
    log(`Đã chuẩn hoá role cho ${res.modifiedCount} conversationMember`)
  },
}

export default migration
