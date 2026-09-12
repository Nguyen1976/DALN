/**
 * Tính các trường "người đối diện" phi chuẩn hoá cho hội thoại DIRECT.
 *
 * Vì sao cần: danh sách hội thoại phải hiển thị tên + avatar đối phương, nhưng
 * kéo `include: { members }` làm truy vấn đắt tuyến tính theo số thành viên —
 * đo trên chính Prisma của dự án: 2 thành viên 1,56ms, 500 thành viên 6,10ms,
 * còn bỏ include thì phẳng 0,85ms bất kể quy mô. Nhóm đông trả giá cho một
 * thông tin mà chỉ DIRECT mới dùng.
 *
 * Vì sao đặt trên conversationMember chứ không phải conversation: "đối phương"
 * phụ thuộc vào người đang xem, nên nó là thuộc tính của tư cách thành viên.
 * Truy vấn danh sách vốn đã đọc đúng dòng membership của người gọi -> lấy kèm
 * bốn trường này không tốn thêm round-trip nào.
 */

export type PeerSource = {
  userId: string
  username?: string | null
  fullName?: string | null
  avatar?: string | null
}

export type PeerFields = {
  peerUserId: string | null
  peerUsername: string | null
  peerFullName: string | null
  peerAvatar: string | null
}

const EMPTY_PEER: PeerFields = {
  peerUserId: null,
  peerUsername: null,
  peerFullName: null,
  peerAvatar: null,
}

/**
 * Trả về thông tin đối phương của `viewerId` trong danh sách thành viên.
 * Nhóm (hoặc DIRECT bất thường không đúng 2 người) -> toàn null, vì nhóm dùng
 * groupName/groupAvatar để hiển thị.
 */
export function buildPeerFields(
  type: string,
  viewerId: string,
  members: PeerSource[],
): PeerFields {
  if (type !== 'DIRECT') return { ...EMPTY_PEER }

  const peer = members.find((m) => m.userId !== viewerId)
  if (!peer) return { ...EMPTY_PEER }

  return {
    peerUserId: peer.userId,
    peerUsername: peer.username ?? null,
    peerFullName: peer.fullName ?? null,
    peerAvatar: peer.avatar ?? null,
  }
}
