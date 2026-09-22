import type { Message } from "@/redux/slices/messageSlice";

export type MediaKind = "IMAGE" | "VIDEO" | "FILE";

/**
 * Một ảnh/video đơn lẻ trong cuộc trò chuyện.
 *
 * Trình xem ảnh đếm theo TỆP chứ không theo tin nhắn: một tin ba ảnh là ba
 * mục, nếu không thì dải ảnh dưới đáy đếm thiếu và mũi tên tới/lui nhảy cóc.
 */
export type MediaItem = {
  /** Khoá ổn định để gộp bản từ luồng chat với bản từ API gallery. */
  key: string;
  messageId: string;
  url: string;
  thumbnailUrl?: string;
  kind: "IMAGE" | "VIDEO";
  fileName?: string;
  senderName?: string;
  createdAt: string;
  sortOrder: number;
};

/**
 * `mediaType` là nguồn đúng, nhưng tin CŨ có thể thiếu nên suy thêm từ
 * `mimeType`. Mọi thứ còn lại là tệp đính kèm.
 */
export function resolveMediaKind(media: {
  mediaType?: string;
  mimeType?: string;
}): MediaKind {
  const mediaType = String(media.mediaType || "").toUpperCase();
  const mimeType = String(media.mimeType || "").toLowerCase();

  if (mediaType.includes("IMAGE") || mimeType.startsWith("image/")) {
    return "IMAGE";
  }
  if (mediaType.includes("VIDEO") || mimeType.startsWith("video/")) {
    return "VIDEO";
  }
  return "FILE";
}

/**
 * Ảnh và video của một tin nhắn, theo thứ tự đã gửi.
 *
 * Lọc bỏ tệp thường: API gallery chọn tin theo "có ít nhất một ảnh", nên một
 * tin gửi kèm ảnh lẫn PDF sẽ mang cả PDF sang — không lọc là con PDF lọt vào
 * dải ảnh.
 */
export function mediaItemsOf(message: Message): MediaItem[] {
  const createdAt = message.createdAt || "";
  const senderName = message.senderMember?.username;

  return (message.medias || [])
    .map((media, index) => ({ media, index }))
    .filter(({ media }) => resolveMediaKind(media) !== "FILE")
    .map(({ media, index }) => ({
      key: media.id || `${message.id}:${media.sortOrder ?? index}`,
      messageId: message.id,
      url: media.url,
      thumbnailUrl: media.thumbnailUrl,
      kind: resolveMediaKind(media) as "IMAGE" | "VIDEO",
      fileName: media.fileName,
      senderName,
      createdAt,
      sortOrder: media.sortOrder ?? index,
    }));
}

/** Cũ trước, mới sau — cùng chiều với luồng chat. */
export function compareMediaItems(a: MediaItem, b: MediaItem): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  // Nhiều ảnh gửi cùng lúc chung một dấu thời gian.
  if (a.messageId !== b.messageId) {
    return a.messageId < b.messageId ? -1 : 1;
  }
  return a.sortOrder - b.sortOrder;
}

/** Gộp hai danh sách, bỏ trùng theo `key`, giữ nguyên thứ tự thời gian. */
export function mergeMediaItems(
  current: MediaItem[],
  incoming: MediaItem[],
): MediaItem[] {
  if (!incoming.length) return current;
  const byKey = new Map(current.map((item) => [item.key, item]));
  for (const item of incoming) {
    if (!byKey.has(item.key)) byKey.set(item.key, item);
  }
  return [...byKey.values()].sort(compareMediaItems);
}
