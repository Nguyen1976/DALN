import { Phone, PhoneMissed, User, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useCall } from "@/contexts/callContext";
import type { CallInfo } from "@/redux/slices/messageSlice";

/**
 * Thẻ tổng kết cuộc gọi hiển thị NHƯ MỘT TIN NHẮN (Messenger/Zalo): căn phải nếu
 * mình là người gọi, căn trái nếu là người kia; có avatar người gọi. Bấm để gọi
 * lại (1-1) / tham gia lại (nhóm). Cuộc gọi nhỡ tô màu cảnh báo.
 */
export default function CallLogMessage({
  conversationId,
  callInfo,
  time,
  isMine,
  senderName,
  senderAvatar,
  showAvatar = true,
}: {
  conversationId: string;
  callInfo: CallInfo;
  time: React.ReactNode;
  isMine: boolean;
  senderName?: string;
  senderAvatar?: string;
  showAvatar?: boolean;
}) {
  const { startDirectCall, startGroupCall } = useCall();

  const isGroup = callInfo.scope === "group";
  const isVideo = callInfo.callType === "video";
  const outcome = (callInfo.outcome || "").toUpperCase();
  const missed = outcome === "MISSED";
  const attention = missed || outcome === "UNREACHABLE";

  const title = isVideo
    ? isGroup
      ? "Cuộc gọi video nhóm"
      : "Cuộc gọi video"
    : isGroup
      ? "Cuộc gọi nhóm"
      : "Cuộc gọi thoại";

  const seconds = Math.max(0, Math.floor(callInfo.durationSeconds || 0));
  const durationText = (() => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m} phút ${s} giây` : `${s} giây`;
  })();
  const detail = missed
    ? "Cuộc gọi nhỡ"
    : outcome === "REJECTED"
      ? "Bị từ chối"
      : outcome === "UNREACHABLE"
        ? "Không kết nối được"
        : seconds > 0
          ? durationText
          : "Đã kết thúc";

  const handleCallBack = () => {
    if (isGroup) startGroupCall(conversationId, callInfo.callType);
    else startDirectCall(conversationId, callInfo.callType);
  };

  const Icon = missed ? PhoneMissed : isVideo ? Video : Phone;

  return (
    <div
      className={cn(
        "my-1 flex items-end gap-2",
        isMine ? "justify-end" : "justify-start",
      )}
    >
      {!isMine &&
        (showAvatar ? (
          <Avatar className="size-8 border border-border">
            <AvatarImage src={senderAvatar} alt="" />
            <AvatarFallback>
              {senderName?.[0] || <User className="size-4" />}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className="size-8 shrink-0" aria-hidden="true" />
        ))}

      <div
        className={cn(
          "flex max-w-[85%] items-center gap-3 rounded-2xl border px-3 py-2 shadow-sm sm:max-w-sm",
          isMine ? "border-primary/25 bg-primary/10" : "border-border bg-card",
        )}
      >
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            attention
              ? "bg-warning/15 text-warning-text"
              : "bg-primary/15 text-primary",
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p
            className={cn(
              "truncate text-xs",
              attention
                ? "font-medium text-warning-text"
                : "text-muted-foreground",
            )}
          >
            {detail}
            <span className="ml-1.5 tabular-nums opacity-70">{time}</span>
          </p>
        </div>

        <Button
          size="sm"
          variant={attention ? "default" : "secondary"}
          onClick={handleCallBack}
          className="shrink-0 rounded-full"
        >
          {isGroup ? "Tham gia lại" : "Gọi lại"}
        </Button>
      </div>
    </div>
  );
}
