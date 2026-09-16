import { Phone, PhoneMissed, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCall } from "@/contexts/callContext";
import type { CallInfo } from "@/redux/slices/messageSlice";

/**
 * Thẻ tổng kết cuộc gọi (tin type=CALL) — giống Messenger: biểu tượng loại cuộc
 * gọi, kết cục (nhỡ / bị từ chối / thời lượng) và nút Gọi lại (1-1) hoặc Tham gia
 * lại (nhóm). Cuộc gọi nhỡ tô màu cảnh báo để dễ thấy.
 */
export default function CallLogMessage({
  conversationId,
  callInfo,
  time,
}: {
  conversationId: string;
  callInfo: CallInfo;
  time: React.ReactNode;
}) {
  const { startDirectCall, startGroupCall } = useCall();

  const isGroup = callInfo.scope === "group";
  const isVideo = callInfo.callType === "video";
  const outcome = (callInfo.outcome || "").toUpperCase();
  const missed = outcome === "MISSED";
  const rejected = outcome === "REJECTED";
  const unreachable = outcome === "UNREACHABLE";

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
    : rejected
      ? "Bị từ chối"
      : unreachable
        ? "Không kết nối được"
        : seconds > 0
          ? durationText
          : "Đã kết thúc";

  const attention = missed || unreachable;

  const handleCallBack = () => {
    if (isGroup) startGroupCall(conversationId, callInfo.callType);
    else startDirectCall(conversationId, callInfo.callType);
  };

  const Icon = missed ? PhoneMissed : isVideo ? Video : Phone;

  return (
    <div className="my-3 flex justify-center">
      <div className="flex w-full max-w-[85%] items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-2.5 shadow-sm sm:max-w-xs">
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
          <p className="truncate text-sm font-medium text-foreground">
            {title}
          </p>
          <p
            className={cn(
              "truncate text-xs",
              attention ? "font-medium text-warning-text" : "text-muted-foreground",
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
