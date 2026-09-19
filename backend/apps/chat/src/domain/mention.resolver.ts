/**
 * Suy ra danh sách người được nhắc TỪ CHÍNH NỘI DUNG tin nhắn.
 *
 * Trước đây server tin `mentionUserIds` do client gửi lên. Hệ quả: xoá chữ
 * "@Alice" khỏi ô soạn nhưng id vẫn nằm trong state -> Alice vẫn bị nhắc; gõ tay
 * "@alice" thì lại KHÔNG ai được nhắc; và việc tô sáng ở client dò bằng regex
 * `@[\w.-]+` nên tên tiếng Việt có dấu hoặc có khoảng trắng thì trượt.
 *
 * Ở đây server tự dò tên thật của thành viên trong text, nên:
 *  - chỉ ai CÒN được nhắc trong nội dung mới thật sự bị nhắc;
 *  - tên có dấu / có khoảng trắng đều khớp (so khớp theo tên, không theo regex);
 *  - gõ tay cũng tính; và `@all` nhắc cả nhóm.
 * Kết quả trả về kèm nhãn đúng như trong text để client tô sáng chính xác.
 */

export interface MentionMember {
  userId: string
  username?: string | null
  fullName?: string | null
}

/** Một lượt nhắc: hoặc đích danh một người, hoặc `@all` cho cả nhóm. */
export type ResolvedMention =
  | { userId: string; label: string }
  | { all: true; label: string }

export interface ResolvedMentions {
  /** Người thật sự nhận lượt nhắc (đã bỏ người gửi, đã khử trùng). */
  userIds: string[]
  /** Nhãn đúng như trong text, để client tô sáng không cần đoán. */
  mentions: ResolvedMention[]
}

/** Các cách viết được hiểu là "nhắc cả nhóm". */
const ALL_TOKENS = ['everyone', 'tất cả', 'tatca', 'mọi người', 'moi nguoi', 'all']

const lower = (value: string) => value.toLocaleLowerCase('vi')

/** Ký tự tạo thành "chữ" — dùng để chặn khớp nửa vời và tránh ăn nhầm email. */
const isWordChar = (char: string) => /[\p{L}\p{N}_]/u.test(char)

export function resolveMentions(
  text: string | null | undefined,
  members: MentionMember[],
  senderId: string,
): ResolvedMentions {
  const empty: ResolvedMentions = { userIds: [], mentions: [] }
  if (!text || !text.trim() || !members?.length) return empty

  // Mỗi thành viên có thể được gọi bằng username HOẶC họ tên đầy đủ.
  const handles: { lower: string; userId: string | null }[] = []
  for (const member of members) {
    if (!member?.userId || member.userId === senderId) continue
    for (const raw of [member.username, member.fullName]) {
      const label = String(raw || '').trim()
      if (label) handles.push({ lower: lower(label), userId: member.userId })
    }
  }
  for (const token of ALL_TOKENS) handles.push({ lower: token, userId: null })

  // Khớp DÀI nhất trước: "@an.tran" phải ra `an.tran`, không dừng ở `an`.
  handles.sort((a, b) => b.lower.length - a.lower.length)

  const mentions: ResolvedMention[] = []
  const seen = new Set<string>()
  let mentionsAll = false

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '@') continue
    // "@" phải đứng đầu hoặc sau ký tự không phải chữ — nếu không thì đây là
    // địa chỉ email (me@alice.com) chứ không phải lượt nhắc.
    if (i > 0 && isWordChar(text[i - 1])) continue

    const hit = handles.find((handle) => {
      const slice = text.slice(i + 1, i + 1 + handle.lower.length)
      if (slice.length !== handle.lower.length) return false
      if (lower(slice) !== handle.lower) return false
      // Phải hết tên, không được dính thêm chữ: "@ali" không khớp "alice".
      const next = text[i + 1 + handle.lower.length]
      return next === undefined || !isWordChar(next)
    })
    if (!hit) continue

    const label = text.slice(i + 1, i + 1 + hit.lower.length)
    if (hit.userId === null) {
      if (!mentionsAll) {
        mentionsAll = true
        mentions.push({ all: true, label })
      }
    } else if (!seen.has(hit.userId)) {
      seen.add(hit.userId)
      mentions.push({ userId: hit.userId, label })
    }
    i += hit.lower.length
  }

  const userIds = [...seen]
  if (mentionsAll) {
    for (const member of members) {
      if (!member?.userId || member.userId === senderId) continue
      if (!seen.has(member.userId)) {
        seen.add(member.userId)
        userIds.push(member.userId)
      }
    }
  }

  return { userIds, mentions }
}
