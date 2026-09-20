import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Play } from "@/components/icons";
import type { MediaItem } from "@/utils/conversationMedia";

/** Ô 64px + khoảng cách 8px. Cố định để bù vị trí cuộn được chính xác. */
const THUMB = 64;
const GAP = 8;
const STEP = THUMB + GAP;

/** Còn cách đầu trái bao nhiêu thì nạp trang cũ hơn. */
const LOAD_MARGIN = STEP * 4;

export default function Filmstrip({
  items,
  currentKey,
  hasMore,
  isLoading,
  onSelect,
  onLoadOlder,
}: {
  items: MediaItem[];
  currentKey: string;
  hasMore: boolean;
  isLoading: boolean;
  onSelect: (item: MediaItem) => void;
  onLoadOlder: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  // Trang cũ hơn được CHÈN VÀO ĐẦU TRÁI, nên nội dung dưới con trỏ bị đẩy sang
  // phải. Ô có bề rộng cố định nên bù lại chính xác được: không bù thì mỗi lần
  // nạp thêm là dải ảnh nhảy một đoạn dưới tay người đang lướt.
  const countRef = useRef(items.length);
  const firstKeyRef = useRef(items[0]?.key);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const added = items.length - countRef.current;
    const grewAtStart = firstKeyRef.current !== items[0]?.key;
    countRef.current = items.length;
    firstKeyRef.current = items[0]?.key;

    if (!scroller || added <= 0 || !grewAtStart) return;
    scroller.scrollLeft += added * STEP;
  }, [items]);

  // Mở ra thì ô đang xem nằm giữa tầm mắt, không phải đi tìm.
  useEffect(() => {
    currentRef.current?.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "center",
    });
  }, [currentKey]);

  // Lướt tới gần đầu trái thì nạp tiếp về quá khứ.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const check = () => {
      if (hasMore && scroller.scrollLeft <= LOAD_MARGIN) onLoadOlder();
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    return () => scroller.removeEventListener("scroll", check);
  }, [hasMore, onLoadOlder, items.length]);

  return (
    <div
      ref={scrollerRef}
      // Thanh cuộn ngang là thứ có thể lấy tiêu điểm, nên bàn phím cũng lướt
      // được dải ảnh mà không cần chuột.
      tabIndex={0}
      role="listbox"
      aria-label="Ảnh và video trong cuộc trò chuyện"
      aria-orientation="horizontal"
      className="custom-scrollbar flex w-full items-center gap-2 overflow-x-auto overflow-y-hidden px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
    >
      {/* Khoảng trống bên trái chưa nạp: nói rõ là còn ảnh cũ hơn, để dải
          ảnh ngắn không bị hiểu nhầm là đã hết. */}
      {hasMore && (
        <span
          className="flex h-16 shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-white/25 px-3 text-xs text-white/70"
          aria-hidden="true"
        >
          {isLoading && <Loader2 className="size-3.5 animate-spin" />}
          Ảnh cũ hơn
        </span>
      )}

      {items.map((item) => {
        const isCurrent = item.key === currentKey;
        return (
          <button
            key={item.key}
            ref={isCurrent ? currentRef : undefined}
            type="button"
            role="option"
            aria-selected={isCurrent}
            aria-label={item.fileName || (item.kind === "VIDEO" ? "Video" : "Ảnh")}
            onClick={() => onSelect(item)}
            className={cn(
              "relative size-16 shrink-0 overflow-hidden rounded-lg transition-[outline-color,opacity] duration-(--motion-fast)",
              "outline outline-2 focus-visible:outline-ring",
              // Ô đang xem không chỉ khác màu viền: nó còn rõ hơn hẳn phần
              // còn lại, và thanh trên vẫn ghi "3 / 27" bằng chữ.
              isCurrent
                ? "outline-white opacity-100"
                : "outline-transparent opacity-55 hover:opacity-90",
            )}
          >
            <img
              src={item.thumbnailUrl || item.url}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="size-full bg-white/10 object-cover"
            />
            {item.kind === "VIDEO" && (
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
              >
                <Play className="size-4 fill-current" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
