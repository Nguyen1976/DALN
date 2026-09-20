import { useCallback, useEffect, useRef, useState } from "react";
import { getConversationAssetsAPI } from "@/apis";
import {
  mediaItemsOf,
  mergeMediaItems,
  type MediaItem,
} from "@/utils/conversationMedia";

const PAGE_SIZE = 40;

/**
 * Mọi ảnh/video của một cuộc trò chuyện, cho dải ảnh của trình xem.
 *
 * API gallery trả tin MỚI NHẤT trước và chỉ đi lùi được về quá khứ, nên danh
 * sách lớn dần về phía cũ. Ở đây luôn giữ thứ tự thời gian tăng dần để bên
 * hiển thị khỏi phải đảo.
 *
 * `seed` là ảnh của chính tin nhắn vừa được bấm: bức ảnh đó có thể nằm ở
 * trang thứ mười của gallery, mà bắt người dùng nhìn màn hình chờ trong khi
 * phân trang mù cho tới lúc tìm thấy thì vô lý — nơi bấm đã cầm sẵn dữ liệu,
 * cứ hiện ngay rồi trộn các trang về sau.
 */
export function useConversationMedia({
  conversationId,
  seed,
  enabled,
}: {
  conversationId: string;
  seed: MediaItem[];
  enabled: boolean;
}) {
  const [items, setItems] = useState<MediaItem[]>(seed);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const cursorRef = useRef<string | null>(null);
  // Chặn hai lời gọi chồng nhau: cuộn tới đầu dải bắn liên tiếp vài lần.
  const inFlight = useRef(false);

  const loadOlder = useCallback(async () => {
    if (!enabled || !conversationId) return;
    if (inFlight.current || !hasMore) return;

    inFlight.current = true;
    setIsLoading(true);
    try {
      const response = await getConversationAssetsAPI({
        conversationId,
        kind: "MEDIA",
        cursor: cursorRef.current,
        limit: PAGE_SIZE,
      });
      const incoming = response.items.flatMap(mediaItemsOf);
      setItems((current) => mergeMediaItems(current, incoming));
      cursorRef.current = response.nextCursor;
      setHasMore(response.nextCursor !== null);
    } catch {
      // Hết đường thì dừng, chứ không quay vòng gọi lại mãi.
      setHasMore(false);
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [conversationId, enabled, hasMore]);

  // Trang đầu, ngay khi trình xem mở.
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void loadOlder();
  }, [enabled, loadOlder]);

  return { items, hasMore, isLoading, loadOlder };
}
