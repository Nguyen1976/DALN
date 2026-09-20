import { cn } from "@/lib/utils";
import { Play } from "@/components/icons";
import type { Message } from "@/redux/slices/messageSlice";

type QuotedMessage = NonNullable<Message["replyTo"]>;

/** Nhãn thay cho nội dung khi tin nhắn gốc không phải văn bản. */
function quotedPlaceholder(type: string): string {
  if (type === "IMAGE") return "Hình ảnh";
  if (type === "VIDEO") return "Video";
  if (type === "FILE") return "Tệp đính kèm";
  if (type === "POLL") return "Bình chọn";
  return "Tin nhắn";
}

/** Ảnh/video của tin gốc, nếu tin đó còn và thực sự là media xem được. */
function thumbnailOf(replyTo: QuotedMessage) {
  if (replyTo.isRevoked) return null;
  if (replyTo.attachmentType !== "IMAGE" && replyTo.attachmentType !== "VIDEO") {
    return null;
  }
  // Video chỉ có poster khi server đã sinh; không có thì để thẻ <video> tự
  // dựng khung hình đầu qua preload="metadata".
  const poster = replyTo.attachmentThumbnailUrl || null;
  if (replyTo.attachmentType === "IMAGE") {
    return replyTo.attachmentUrl
      ? { kind: "IMAGE" as const, src: replyTo.attachmentUrl }
      : null;
  }
  if (poster) return { kind: "IMAGE" as const, src: poster };
  return replyTo.attachmentUrl
    ? { kind: "VIDEO" as const, src: replyTo.attachmentUrl }
    : null;
}

/**
 * Khối trích dẫn của một tin trả lời. Bấm vào thì nhảy về tin gốc.
 *
 * `standalone` dành cho tin CHỈ có ảnh/video: ở đó không còn bong bóng để
 * lồng vào, nên khối quote tự mang nền bong bóng và nổi ngay phía trên ảnh —
 * giống Zalo/Messenger.
 */
export default function QuotedMessagePreview({
  replyTo,
  isMine,
  selfId,
  standalone = false,
  onJump,
}: {
  replyTo: QuotedMessage;
  isMine: boolean;
  selfId: string;
  standalone?: boolean;
  onJump?: (messageId: string) => void;
}) {
  const thumbnail = thumbnailOf(replyTo);

  // Tên tệp ("IMG_3946.jpeg") chỉ còn ý nghĩa khi KHÔNG vẽ được ảnh; có ảnh
  // rồi thì chính ảnh là nội dung, chữ chỉ cần nói đó là ảnh hay video.
  const label = replyTo.isRevoked
    ? "Tin nhắn đã bị thu hồi"
    : replyTo.content ||
      (thumbnail
        ? quotedPlaceholder(replyTo.attachmentType || replyTo.type)
        : replyTo.attachmentName || quotedPlaceholder(replyTo.type));

  return (
    <button
      type="button"
      onClick={() => onJump?.(replyTo.id)}
      className={cn(
        "flex w-full items-stretch gap-2 text-left",
        "transition-colors duration-(--motion-fast)",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        standalone
          ? cn(
              "max-w-full rounded-2xl p-1.5 shadow-bubble",
              isMine
                ? "bg-bubble-out text-bubble-out-foreground hover:brightness-95"
                : "bg-bubble-in text-bubble-in-foreground hover:brightness-95",
            )
          : cn(
              "mb-1.5 rounded-lg px-2 py-1.5",
              isMine
                ? "bg-bubble-out-foreground/12 hover:bg-bubble-out-foreground/20"
                : "bg-foreground/6 hover:bg-foreground/10",
            ),
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "w-0.5 shrink-0 rounded-full",
          isMine ? "bg-bubble-out-foreground/60" : "bg-primary",
        )}
      />
      <span className="min-w-0 flex-1 self-center">
        <span
          className={cn(
            "block truncate text-[11px] font-semibold",
            isMine ? "text-bubble-out-foreground/85" : "text-brand",
          )}
        >
          {replyTo.senderId === selfId
            ? "Bạn"
            : replyTo.senderName || "Người dùng"}
        </span>
        <span
          className={cn(
            "block truncate text-xs",
            isMine ? "text-bubble-out-foreground/70" : "text-muted-foreground",
            replyTo.isRevoked && "italic",
          )}
        >
          {label}
        </span>
      </span>

      {thumbnail && (
        <span className="relative size-10 shrink-0 self-center overflow-hidden rounded-md bg-muted">
          {thumbnail.kind === "IMAGE" ? (
            <img
              src={thumbnail.src}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <video
              src={thumbnail.src}
              muted
              preload="metadata"
              aria-hidden="true"
              className="size-full object-cover"
            />
          )}
          {replyTo.attachmentType === "VIDEO" && (
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
            >
              <Play className="size-3.5 fill-current" />
            </span>
          )}
        </span>
      )}
    </button>
  );
}
