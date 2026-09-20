import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  MessageSquareText,
  X,
  ZoomIn,
  ZoomOut,
} from "@/components/icons";
import { useConversationMedia } from "@/hooks/chat/useConversationMedia";
import { formatFullDateTime } from "@/utils/formatDateTime";
import type { MediaItem } from "@/utils/conversationMedia";
import Filmstrip from "./Filmstrip";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
/** Quãng kéo ngang tối thiểu để tính là vuốt chuyển ảnh. */
const SWIPE = 60;
/** Mỗi lần bấm phím mũi tên khi đã phóng to. */
const PAN_STEP = 48;

type View = { scale: number; x: number; y: number };
const RESET: View = { scale: 1, x: 0, y: 0 };

/**
 * Tải ảnh về máy. Ảnh nằm ở máy chủ lưu trữ khác nên thuộc tính `download`
 * của thẻ <a> có thể bị bỏ qua; lấy blob rồi mới tải là cách chắc chắn, và
 * nếu CORS chặn thì lui về mở tab mới — vẫn hơn là không làm gì.
 */
async function downloadMedia(item: MediaItem) {
  try {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = item.fileName || "anh";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(item.url, "_blank", "noopener,noreferrer");
  }
}

export type LightboxAnchor = {
  /** Ảnh của chính tin nhắn được bấm, để hiện ngay không phải chờ tải. */
  seed: MediaItem[];
  currentKey: string;
};

export default function MediaLightbox({
  conversationId,
  anchor,
  onClose,
  onJumpToMessage,
}: {
  conversationId: string;
  anchor: LightboxAnchor | null;
  onClose: () => void;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const open = anchor !== null;
  const [currentKey, setCurrentKey] = useState(anchor?.currentKey ?? "");
  const [view, setView] = useState<View>(RESET);

  const { items, hasMore, isLoading, loadOlder } = useConversationMedia({
    conversationId,
    seed: anchor?.seed ?? [],
    enabled: open,
  });

  const index = useMemo(
    () => items.findIndex((item) => item.key === currentKey),
    [items, currentKey],
  );
  const current = index >= 0 ? items[index] : (anchor?.seed[0] ?? null);

  const stageRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const next = items[index + delta];
      if (!next) return;
      setCurrentKey(next.key);
      // Mỗi bức ảnh bắt đầu lại ở cỡ vừa màn hình; giữ mức phóng của ảnh
      // trước sẽ ném người xem vào giữa một bức ảnh khác hẳn.
      setView(RESET);
    },
    [index, items],
  );

  const zoomTo = useCallback((next: number) => {
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      if (scale === MIN_SCALE) return RESET;
      // Giới hạn kéo theo nửa khung: phóng to bao nhiêu thì đi lệch được bấy
      // nhiêu, không kéo bức ảnh ra khỏi màn hình được.
      const limit = stageRef.current;
      const maxX = limit ? ((scale - 1) * limit.clientWidth) / 2 : 0;
      const maxY = limit ? ((scale - 1) * limit.clientHeight) / 2 : 0;
      return {
        scale,
        x: Math.min(maxX, Math.max(-maxX, v.x)),
        y: Math.min(maxY, Math.max(-maxY, v.y)),
      };
    });
  }, []);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      setView((v) => {
        if (v.scale === MIN_SCALE) return v;
        const limit = stageRef.current;
        const maxX = limit ? ((v.scale - 1) * limit.clientWidth) / 2 : 0;
        const maxY = limit ? ((v.scale - 1) * limit.clientHeight) / 2 : 0;
        return {
          ...v,
          x: Math.min(maxX, Math.max(-maxX, v.x + dx)),
          y: Math.min(maxY, Math.max(-maxY, v.y + dy)),
        };
      });
    },
    [],
  );

  // Mở trình xem mới thì bắt đầu lại từ bức được bấm.
  useEffect(() => {
    if (!anchor) return;
    setCurrentKey(anchor.currentKey);
    setView(RESET);
  }, [anchor]);

  // Đọc qua ref, không qua dependency: bên gọi thường truyền một hàm inline,
  // nên phụ thuộc thẳng vào `onClose` khiến effect dưới chạy lại mỗi lần
  // render — đẩy vào rồi nhặt ra khỏi lịch sử liên tục, và nút Back thành vô
  // tác dụng.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Nút Back của trình duyệt (và nút back cứng trên Android) phải đóng trình
  // xem, chứ không phải văng ra khỏi cuộc trò chuyện.
  useEffect(() => {
    if (!open) return;
    const onPop = () => onCloseRef.current();
    window.history.pushState({ lightbox: true }, "");
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Đóng bằng Esc hay nút ✕ thì mục lịch sử vừa đẩy vào vẫn còn; nhặt nó
      // ra để lần Back sau không phải bấm hai lần mới rời trang.
      if (window.history.state?.lightbox) window.history.back();
    };
  }, [open]);

  const isZoomed = view.scale > MIN_SCALE;

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          // Chưa phóng to thì mũi tên chuyển ảnh; phóng rồi thì nó kéo ảnh —
          // và đó cũng là cách thao tác không cần kéo chuột, theo WCAG 2.2.
          if (isZoomed) panBy(PAN_STEP, 0);
          else go(-1);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (isZoomed) panBy(-PAN_STEP, 0);
          else go(1);
          break;
        case "ArrowUp":
          if (!isZoomed) return;
          event.preventDefault();
          panBy(0, PAN_STEP);
          break;
        case "ArrowDown":
          if (!isZoomed) return;
          event.preventDefault();
          panBy(0, -PAN_STEP);
          break;
        case "+":
        case "=":
          event.preventDefault();
          zoomTo(view.scale + 0.5);
          break;
        case "-":
          event.preventDefault();
          zoomTo(view.scale - 0.5);
          break;
        case "0":
          event.preventDefault();
          setView(RESET);
          break;
      }
    },
    [go, isZoomed, panBy, view.scale, zoomTo],
  );

  // Vuốt để chuyển ảnh, kéo để xem khi đã phóng, chụm hai ngón để phóng.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startDist: number; startScale: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    if (current?.kind === "VIDEO") return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    gesture.current = {
      startX: event.clientX,
      startDist:
        points.length === 2
          ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
          : 0,
      startScale: view.scale,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];

    if (points.length === 2 && gesture.current?.startDist) {
      const distance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y,
      );
      zoomTo(gesture.current.startScale * (distance / gesture.current.startDist));
      return;
    }
    if (isZoomed) panBy(event.clientX - previous.x, event.clientY - previous.y);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (!start || isZoomed || start.startDist) return;

    const dx = event.clientX - start.startX;
    if (Math.abs(dx) >= SWIPE) go(dx < 0 ? 1 : -1);
  };

  if (!current) return null;

  const position = index >= 0 ? `${index + 1} / ${items.length}` : "";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/92 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col text-white focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {current.fileName ||
              (current.kind === "VIDEO" ? "Xem video" : "Xem ảnh")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Dùng phím mũi tên trái phải để chuyển, phím cộng và trừ để phóng to
            thu nhỏ, phím Escape để đóng.
          </DialogPrimitive.Description>

          {/* Thanh trên: vị trí ghi bằng CHỮ, không chỉ dựa vào ô sáng ở dải
              ảnh, để biết được đang ở đâu mà không cần nhìn màu. */}
          <div className="flex shrink-0 items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {current.senderName || "Người dùng"}
                {position && (
                  <span className="ml-2 tabular-nums text-white/60">
                    {position}
                  </span>
                )}
              </p>
              {current.createdAt && (
                <p className="truncate text-xs text-white/60">
                  {formatFullDateTime(current.createdAt)}
                </p>
              )}
            </div>

            {current.kind === "IMAGE" && (
              <>
                <ToolbarButton
                  label="Thu nhỏ"
                  onClick={() => zoomTo(view.scale - 0.5)}
                  disabled={view.scale <= MIN_SCALE}
                >
                  <ZoomOut className="size-5" />
                </ToolbarButton>
                <ToolbarButton
                  label="Phóng to"
                  onClick={() => zoomTo(view.scale + 0.5)}
                  disabled={view.scale >= MAX_SCALE}
                >
                  <ZoomIn className="size-5" />
                </ToolbarButton>
              </>
            )}
            {onJumpToMessage && (
              <ToolbarButton
                label="Tới tin nhắn gốc"
                onClick={() => {
                  onJumpToMessage(current.messageId);
                  onClose();
                }}
              >
                <MessageSquareText className="size-5" />
              </ToolbarButton>
            )}
            <ToolbarButton
              label="Mở ở tab mới"
              onClick={() =>
                window.open(current.url, "_blank", "noopener,noreferrer")
              }
            >
              <ExternalLink className="size-5" />
            </ToolbarButton>
            <ToolbarButton
              label="Tải xuống"
              onClick={() => void downloadMedia(current)}
            >
              <Download className="size-5" />
            </ToolbarButton>
            <ToolbarButton label="Đóng" onClick={onClose}>
              <X className="size-5" />
            </ToolbarButton>
          </div>

          <div
            ref={stageRef}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => zoomTo(isZoomed ? MIN_SCALE : 2)}
            onWheel={(event) => {
              if (current.kind !== "IMAGE") return;
              zoomTo(view.scale - event.deltaY * 0.003);
            }}
          >
            {current.kind === "VIDEO" ? (
              <video
                key={current.key}
                src={current.url}
                poster={current.thumbnailUrl}
                controls
                playsInline
                className="max-h-full max-w-full"
              />
            ) : (
              <img
                key={current.key}
                src={current.url}
                alt={current.fileName || "Ảnh trong cuộc trò chuyện"}
                draggable={false}
                className={cn(
                  "max-h-full max-w-full select-none object-contain",
                  // Chỉ chuyển động khi phóng bằng nút hay bàn phím; lúc đang
                  // kéo mà còn nội suy thì tay và ảnh lệch nhau.
                  "motion-safe:transition-transform motion-safe:duration-(--motion-fast)",
                  isZoomed ? "cursor-grab active:cursor-grabbing" : "",
                )}
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                }}
              />
            )}

            {/* Nút tới/lui luôn hiện: vuốt không bao giờ là cách duy nhất. */}
            <StageArrow
              side="left"
              label="Ảnh trước"
              disabled={index <= 0}
              onClick={() => go(-1)}
            />
            <StageArrow
              side="right"
              label="Ảnh sau"
              disabled={index < 0 || index >= items.length - 1}
              onClick={() => go(1)}
            />
          </div>

          <div className="shrink-0 border-t border-white/10">
            <Filmstrip
              items={items}
              currentKey={current.key}
              hasMore={hasMore}
              isLoading={isLoading}
              onSelect={(item) => {
                setCurrentKey(item.key);
                setView(RESET);
              }}
              onLoadOlder={loadOlder}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      // 44px: đủ to để bấm bằng ngón tay, không phải ngắm.
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors duration-(--motion-fast) hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function StageArrow({
  side,
  label,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "absolute top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white",
        "transition-colors duration-(--motion-fast) hover:bg-black/70",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        "disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-6" />
    </button>
  );
}
