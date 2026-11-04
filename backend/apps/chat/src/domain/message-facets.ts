/**
 * Những gì một tin chứa, lưu sẵn lúc ghi để các tab Ảnh/Video, Tài liệu, Liên
 * kết đọc thẳng bằng index `{conversationId, hasX, seq}`.
 *
 * Trước đây các tab lọc lúc đọc: `medias: { some }` khiến Prisma `$lookup`
 * messageMedia cho TỪNG tin của hội thoại trước khi lọc (đo 7 s ở 305.800 tin),
 * còn `content contains 'http'` thì không index nào dùng được. Cờ là boolean chứ
 * không phải mảng: Prisma bọc điều kiện trong `$expr`, và `$expr` không dùng
 * được index trên trường mảng (đo: 25.000 key cho 0 kết quả).
 */
export type MessageFacets = {
  hasMedia: boolean
  hasFile: boolean
  hasLink: boolean
}

type Kind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'POLL' | 'CALL'

/** Cùng điều kiện tab Liên kết vẫn dùng: có `http` hoặc `www.` trong nội dung. */
const LINK = /http|www\./

export function facetsOf(
  type: Kind | string,
  mediaTypes: readonly string[],
  content: string | null | undefined,
): MessageFacets {
  const kinds = new Set<string>(mediaTypes)
  // Tin cũ có thể mang type IMAGE/VIDEO/FILE mà không có dòng messageMedia;
  // tab cũ tính cả `type`, nên cờ cũng vậy.
  if (type === 'IMAGE' || type === 'VIDEO' || type === 'FILE') kinds.add(type)
  return {
    hasMedia: kinds.has('IMAGE') || kinds.has('VIDEO'),
    hasFile: kinds.has('FILE'),
    hasLink: Boolean(content && LINK.test(content)),
  }
}
