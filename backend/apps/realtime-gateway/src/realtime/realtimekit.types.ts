import { randomBytes } from 'crypto'

/**
 * Một người tham gia RealtimeKit mà gateway đã cấp cho một cuộc gọi. Lưu lại để
 * thu hồi khi cuộc gọi kết thúc: token RealtimeKit sống 100 ngày và chỉ mất
 * hiệu lực khi xoá người tham gia. KHÔNG chứa authToken — token chỉ đi trong ack.
 */
export interface RtkGrant {
  meetingId: string
  participantId: string
  customParticipantId: string
}

export type RtkPreset =
  | 'daln_direct_audio'
  | 'daln_direct_video'
  | 'daln_group_audio'
  | 'daln_group_video'

/**
 * Preset theo loại CUỘC GỌI, không theo lựa chọn camera của từng người: cuộc gọi
 * thoại dùng preset cấm phát video (giữ quy tắc cũ của LiveKit), cuộc gọi video
 * dùng preset cho phép dù người đó vào với camera tắt.
 */
export function presetFor(
  scope: 'direct' | 'group',
  callType: 'audio' | 'video',
): RtkPreset {
  return `daln_${scope}_${callType}`
}

/**
 * `custom_participant_id` luôn duy nhất: `<userId>.<8 hex>`. Nhờ vậy nhiều tab
 * của cùng một người, hay người tham gia sót lại sau một tab crash, không bao
 * giờ đụng nhau. userId (ObjectId, không có dấu chấm) lấy lại bằng split.
 */
export function newCustomParticipantId(userId: string): string {
  return `${userId}.${randomBytes(4).toString('hex')}`
}

export function userIdFromCustomId(id?: string | null): string {
  if (typeof id !== 'string') return ''
  return id.split('.')[0] ?? ''
}
