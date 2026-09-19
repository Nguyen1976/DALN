import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Pin,
  PinOff,
  SwitchCamera,
  Users,
  Video,
  VideoOff,
  Volume2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { selectConversationById } from "@/redux/slices/conversationSlice";
import type { RootState } from "@/redux/store";
import {
  useGroupCall,
  type GroupCallParticipant,
} from "@/hooks/useGroupCall";

interface GroupCallModalProps {
  /** ID phiên gọi nhóm do gateway cấp (từ ack start/incoming). */
  callId: string;
  /** `conv_<conversationId>` — chỉ để hiển thị/đối chiếu, room đã join bằng token. */
  roomName: string;
  /** LiveKit URL (ack.url). */
  url: string;
  /** Access token (ack.token). */
  token: string;
  conversationId: string;
  /**
   * Loại cuộc gọi: `'audio'` (mặc định) giữ nguyên UI danh sách như cũ; `'video'`
   * hiển thị lưới video. Tuỳ chọn để caller cũ không phải đổi gì.
   */
  callType?: "audio" | "video";
  /** Video nhóm: có tự bật camera khi vào không (người nhận có thể chọn thoại). */
  startWithCamera?: boolean;
  /** STUN/TURN (coturn) từ ack để LiveKit vượt NAT chặt; additive. */
  iceServers?: RTCIceServer[];
  /** Thu nhỏ: thanh gọn thay vì overlay, GIỮ phòng sống. */
  minimized?: boolean;
  /** Bật/tắt thu nhỏ; không truyền thì ẩn nút thu nhỏ. */
  onToggleMinimize?: () => void;
  onClose: () => void;
}

/** Người trong cuộc nhìn từ sự kiện gateway `group_call.state`. */
type ServerParticipant = { id: string; username: string };

/**
 * Một ô video trong lưới. Modal (chứ không phải hook) tự `attach`/`detach` track
 * để adaptiveStream của LiveKit nhìn thấy thẻ `<video>` thật mà tạm dừng video
 * ngoài màn hình. Cleanup khi đổi track / unmount để không rò element.
 */
function GroupCallVideoTile({
  participant,
  isPinned = false,
  fill = false,
  onTogglePin,
}: {
  participant: GroupCallParticipant;
  /** Đang được ghim lên khung chính. */
  isPinned?: boolean;
  /** Lấp đầy khung cha (khung chính) thay vì tỷ lệ 3/4 của ô lưới. */
  fill?: boolean;
  /** Bấm ghim/bỏ ghim; không truyền thì ẩn nút ghim. */
  onTogglePin?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const track = participant.videoTrack ?? null;
  const showVideo = participant.isCameraEnabled && Boolean(track);

  // Gắn track vào thẻ <video>. PHẢI phụ thuộc cả `showVideo`: khi tắt camera thẻ
  // <video> bị gỡ (hiện avatar) rồi bật lại thì thẻ MỚI được tạo, nhưng LiveKit
  // tái dùng CÙNG track object khi mute/unmute (setCameraEnabled). Nếu chỉ phụ
  // thuộc [track] thì effect không chạy lại → thẻ mới không được attach → hình
  // không hiện (chỉ hiện lại khi ghim vì ghim remount tile). Thêm showVideo để
  // attach lại đúng thẻ mỗi lần tile hiện video trở lại.
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !track || !showVideo) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track, showVideo]);

  return (
    <div
      className={cn(
        "group/tile relative overflow-hidden rounded-xl bg-neutral-900 ring-2 transition-colors",
        fill ? "size-full" : "aspect-3/4",
        participant.isSpeaking
          ? "ring-success shadow-[0_0_0_3px_var(--color-success)]"
          : "ring-white/10",
      )}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.isLocal}
          // object-contain: giữ đúng tỷ lệ khung (dọc/ngang), có viền đen, không crop.
          className="size-full bg-neutral-900 object-contain"
          // Camera của chính mình soi gương như thói quen người dùng.
          style={participant.isLocal ? { transform: "scaleX(-1)" } : undefined}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-2 text-center">
          <Avatar className={fill ? "size-24" : "size-14"}>
            <AvatarFallback className={fill ? "text-3xl" : "text-lg"}>
              {participant.name?.[0]}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-full truncate text-sm font-medium text-neutral-200">
            {participant.name}
          </span>
        </div>
      )}

      {/* Ghim / bỏ ghim: đưa người này lên khung chính, không tự đảo theo lượt nói. */}
      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={isPinned ? "Bỏ ghim" : `Ghim ${participant.name}`}
          aria-pressed={isPinned}
          className={cn(
            "absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-opacity hover:bg-black/70",
            isPinned
              ? "opacity-100"
              : "opacity-0 focus-visible:opacity-100 group-hover/tile:opacity-100",
          )}
        >
          {isPinned ? (
            <PinOff className="size-4" />
          ) : (
            <Pin className="size-4" />
          )}
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-black/70 to-transparent px-2 py-1.5">
        {participant.isMuted && (
          <MicOff
            className="size-3.5 shrink-0 text-white"
            aria-label="Đã tắt micro"
          />
        )}
        <span className="truncate text-xs font-medium text-white">
          {participant.name}
          {participant.isLocal && " (Bạn)"}
        </span>
      </div>
    </div>
  );
}

export default function GroupCallModal({
  callId,
  roomName,
  url,
  token,
  conversationId,
  callType = "audio",
  startWithCamera = true,
  iceServers,
  minimized = false,
  onToggleMinimize,
  onClose,
}: GroupCallModalProps) {
  const conversation = useSelector((state: RootState) =>
    selectConversationById(state, conversationId),
  );

  const isVideo = callType === "video";

  const {
    participants,
    isMicEnabled,
    isCameraEnabled,
    connectionState,
    connectedAt,
    toggleMic,
    toggleCamera,
    switchCamera,
    leave,
  } = useGroupCall({
    url,
    token,
    callType,
    startWithCamera,
    iceServers,
    onDisconnected: onClose,
  });

  // Danh sách người theo gateway (bổ trợ cho room: biết ai đã tham gia dù audio
  // track chưa subscribe về phía mình).
  const [serverParticipants, setServerParticipants] = useState<
    ServerParticipant[]
  >([]);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!connectedAt) {
      setElapsedSeconds(0);
      return;
    }
    const tick = () =>
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);

  const durationLabel = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [elapsedSeconds]);

  // group_call.state → cập nhật roster; group_call.ended → đóng modal. Chỉ nhận
  // đúng phiên của mình (theo callId; ended chấp nhận cả theo conversationId).
  useEffect(() => {
    const handleState = ({
      callId: eventCallId,
      participants: nextParticipants,
    }: {
      callId?: string;
      conversationId?: string;
      participants?: ServerParticipant[];
    }) => {
      if (eventCallId && eventCallId !== callId) return;
      setServerParticipants(nextParticipants ?? []);
    };

    const handleEnded = ({
      callId: eventCallId,
      conversationId: eventConversationId,
    }: {
      callId?: string;
      conversationId?: string;
    } = {}) => {
      const sameCall = eventCallId === callId;
      const sameConversation = eventConversationId === conversationId;
      if (eventCallId || eventConversationId) {
        if (!sameCall && !sameConversation) return;
      }
      leave();
      onClose();
    };

    socket.on(SOCKET_EVENTS.GROUP_CALL.STATE, handleState);
    socket.on(SOCKET_EVENTS.GROUP_CALL.ENDED, handleEnded);

    return () => {
      socket.off(SOCKET_EVENTS.GROUP_CALL.STATE, handleState);
      socket.off(SOCKET_EVENTS.GROUP_CALL.ENDED, handleEnded);
    };
  }, [callId, conversationId, leave, onClose]);

  // Room là nguồn sự thật cho trạng thái nói/mute/camera; roster gateway lấp chỗ
  // cho người đã tham gia nhưng track chưa về. Gộp theo identity (= userId).
  const displayParticipants = useMemo<GroupCallParticipant[]>(() => {
    const byId = new Map<string, GroupCallParticipant>();
    for (const person of serverParticipants) {
      byId.set(person.id, {
        identity: person.id,
        name: person.username || person.id,
        isLocal: false,
        isSpeaking: false,
        isMuted: false,
        isCameraEnabled: false,
        videoTrack: null,
      });
    }
    for (const person of participants) {
      byId.set(person.identity, person);
    }
    return [...byId.values()];
  }, [participants, serverParticipants]);

  // Ghim một người lên khung chính (chủ đích, không tự đảo theo lượt nói). Nếu
  // người bị ghim rời phòng thì `pinned` tự về null → quay lại lưới.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const pinned = pinnedId
    ? (displayParticipants.find((p) => p.identity === pinnedId) ?? null)
    : null;
  const stripParticipants = displayParticipants.filter(
    (p) => p.identity !== pinned?.identity,
  );

  // Số cột theo số người (bản thiết kế mục 01): ≤4 → 2 cột; 5–9 → 3 cột desktop.
  const n = displayParticipants.length;
  const gridColsClass =
    n <= 1
      ? "grid-cols-1"
      : n <= 4
        ? "grid-cols-2"
        : "grid-cols-2 sm:grid-cols-3";

  const title = conversation?.displayName || "Cuộc gọi nhóm";

  const statusLabel = useMemo(() => {
    if (connectionState === "connecting") return "Đang kết nối...";
    if (connectionState === "error") return "Không kết nối được";
    if (connectionState === "disconnected") return "Cuộc gọi đã kết thúc";
    return durationLabel;
  }, [connectionState, durationLabel]);

  const handleLeave = () => {
    leave();
    // Client tự rời phòng LiveKit; báo gateway để phát lại STATE cho người khác.
    socket.emit(SOCKET_EVENTS.GROUP_CALL.LEAVE, { callId });
    onClose();
  };

  // Thu nhỏ: thanh gọn, không backdrop → vẫn nhắn tin được. Audio của phòng nằm
  // trong container ẩn do useGroupCall tạo (còn sống vì component không unmount).
  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-border bg-card p-2 pr-3 shadow-lg animate-fade-in">
        <div className="relative shrink-0">
          <div className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
            {isVideo ? (
              <Video className="size-5" />
            ) : (
              <Users className="size-5" />
            )}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-success ring-2 ring-card" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {statusLabel} · {displayParticipants.length} người
          </p>
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={onToggleMinimize}
          aria-label="Mở lại cuộc gọi nhóm"
          className="size-10 rounded-full"
        >
          <Maximize2 className="size-5" />
        </Button>
        <Button
          variant="destructive"
          size="icon"
          onClick={handleLeave}
          aria-label="Rời cuộc gọi"
          className="size-10 rounded-full"
        >
          <PhoneOff className="size-5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cuộc gọi nhóm"
      className="fixed inset-0 z-50 flex animate-overlay-in items-center justify-center bg-scrim p-4 backdrop-blur-sm"
    >
      <div
        className={cn(
          "relative flex w-full animate-dialog-in flex-col rounded-2xl border p-6 shadow-lg",
          // Sân khấu video dùng nền trung tính tối để tên + điều khiển dễ đọc.
          isVideo
            ? "max-w-3xl border-white/10 bg-neutral-950 text-white"
            : "max-w-sm border-border bg-card",
        )}
      >
        <div className="mb-4 flex flex-col items-center text-center">
          <div
            className={cn(
              "mb-3 flex size-14 items-center justify-center rounded-full",
              isVideo ? "bg-white/10 text-white" : "bg-primary/15 text-primary",
            )}
          >
            {isVideo ? (
              <Video className="size-7" aria-hidden="true" />
            ) : (
              <Users className="size-7" aria-hidden="true" />
            )}
          </div>
          <h3
            className={cn(
              "mb-1 text-xl font-semibold tracking-[-0.01em]",
              isVideo ? "text-white" : "text-foreground",
            )}
          >
            {title}
          </h3>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "text-sm tabular-nums",
              connectionState === "error"
                ? "font-medium text-warning-text"
                : isVideo
                  ? "text-white/70"
                  : "text-muted-foreground",
            )}
          >
            {connectionState === "connected" && (
              <span className="sr-only">Thời lượng cuộc gọi </span>
            )}
            {statusLabel}
          </p>
        </div>

        {isVideo ? (
          pinned ? (
            // Ghim: một khung chính lớn + dải nhỏ những người còn lại.
            <div className="mb-6 flex flex-col gap-2">
              <div className="h-[52vh] w-full">
                <GroupCallVideoTile
                  participant={pinned}
                  isPinned
                  fill
                  onTogglePin={() => setPinnedId(null)}
                />
              </div>
              {stripParticipants.length > 0 && (
                <ul
                  className="custom-scrollbar flex gap-2 overflow-x-auto pb-1"
                  aria-label="Người trong cuộc gọi"
                >
                  {stripParticipants.map((participant) => (
                    <li
                      key={participant.identity}
                      className="w-24 shrink-0 animate-pop-in"
                    >
                      <GroupCallVideoTile
                        participant={participant}
                        onTogglePin={() => setPinnedId(participant.identity)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <ul
              className={cn(
                "custom-scrollbar mb-6 grid max-h-[60vh] gap-2 overflow-y-auto",
                gridColsClass,
              )}
              aria-label="Người trong cuộc gọi"
            >
              {displayParticipants.map((participant) => (
                // Someone joining pops into the grid instead of appearing.
                <li key={participant.identity} className="animate-pop-in">
                  <GroupCallVideoTile
                    participant={participant}
                    onTogglePin={() => setPinnedId(participant.identity)}
                  />
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul
            className="custom-scrollbar mb-6 max-h-64 space-y-1 overflow-y-auto"
            aria-label="Người trong cuộc gọi"
          >
            {displayParticipants.map((participant) => (
              <li
                key={participant.identity}
                className={cn(
                  "flex animate-stagger-in items-center gap-3 rounded-xl px-2 py-2 transition-colors",
                  participant.isSpeaking ? "bg-success/10" : "bg-transparent",
                )}
              >
                <Avatar
                  className={cn(
                    "size-10 ring-2 transition-colors",
                    participant.isSpeaking
                      ? "ring-success"
                      : "ring-transparent",
                  )}
                >
                  <AvatarFallback>{participant.name?.[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {participant.name}
                    {participant.isLocal && (
                      <span className="text-muted-foreground"> (Bạn)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {participant.isSpeaking ? "Đang nói" : "Đang nghe"}
                  </p>
                </div>
                {participant.isMuted ? (
                  <MicOff
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-label="Đã tắt micro"
                  />
                ) : (
                  <Volume2
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-center gap-4 sm:gap-6">
          {onToggleMinimize && (
            <Button
              variant="secondary"
              size="icon"
              onClick={onToggleMinimize}
              aria-label="Thu nhỏ cuộc gọi"
              className="size-14 rounded-full"
            >
              <Minimize2 className="size-6" />
            </Button>
          )}

          <Button
            variant="secondary"
            size="icon"
            onClick={() => void toggleMic()}
            aria-label={isMicEnabled ? "Tắt micro" : "Bật micro"}
            aria-pressed={!isMicEnabled}
            className="size-14 rounded-full"
          >
            {isMicEnabled ? (
              <Mic className="size-6" />
            ) : (
              <MicOff className="size-6" />
            )}
          </Button>

          {isVideo && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void toggleCamera()}
              aria-label={isCameraEnabled ? "Tắt camera" : "Bật camera"}
              aria-pressed={!isCameraEnabled}
              className="size-14 rounded-full"
            >
              {isCameraEnabled ? (
                <Video className="size-6" />
              ) : (
                <VideoOff className="size-6" />
              )}
            </Button>
          )}

          {isVideo && isCameraEnabled && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void switchCamera()}
              aria-label="Đổi camera"
              className="size-14 rounded-full"
            >
              <SwitchCamera className="size-6" />
            </Button>
          )}

          <Button
            variant="destructive"
            size="icon"
            onClick={handleLeave}
            aria-label="Rời cuộc gọi"
            className="size-14 rounded-full"
          >
            <PhoneOff className="size-6" />
          </Button>
        </div>
      </div>

      {/* roomName giữ lại để đối chiếu/log; không hiển thị nổi bật. */}
      <span className="sr-only">Phòng {roomName}</span>
    </div>
  );
}
