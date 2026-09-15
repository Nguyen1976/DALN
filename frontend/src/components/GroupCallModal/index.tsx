import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  Mic,
  MicOff,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
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
  /** STUN/TURN (coturn) từ ack để LiveKit vượt NAT chặt; additive. */
  iceServers?: RTCIceServer[];
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
}: {
  participant: GroupCallParticipant;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const track = participant.videoTrack ?? null;
  const showVideo = participant.isCameraEnabled && Boolean(track);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !track) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return (
    <div
      className={cn(
        "relative aspect-3/4 overflow-hidden rounded-xl bg-muted ring-2 transition-colors",
        participant.isSpeaking ? "ring-success" : "ring-transparent",
      )}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.isLocal}
          className="size-full object-cover"
          // Camera của chính mình soi gương như thói quen người dùng.
          style={participant.isLocal ? { transform: "scaleX(-1)" } : undefined}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-2 text-center">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">
              {participant.name?.[0]}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-full truncate text-sm font-medium text-foreground">
            {participant.name}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-foreground/70 to-transparent px-2 py-1.5">
        {participant.isMuted && (
          <MicOff
            className="size-3.5 shrink-0 text-background"
            aria-label="Đã tắt micro"
          />
        )}
        <span className="truncate text-xs font-medium text-background">
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
  iceServers,
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
    leave,
  } = useGroupCall({ url, token, callType, iceServers, onDisconnected: onClose });

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cuộc gọi nhóm"
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
    >
      <div
        className={cn(
          "relative flex w-full flex-col rounded-2xl border border-border bg-card p-6 shadow-lg",
          isVideo ? "max-w-2xl" : "max-w-sm",
        )}
      >
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            {isVideo ? (
              <Video className="size-7" aria-hidden="true" />
            ) : (
              <Users className="size-7" aria-hidden="true" />
            )}
          </div>
          <h3 className="mb-1 text-xl font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h3>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "text-sm tabular-nums",
              connectionState === "error"
                ? "font-medium text-warning-text"
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
          <ul
            className="custom-scrollbar mb-6 grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3"
            aria-label="Người trong cuộc gọi"
          >
            {displayParticipants.map((participant) => (
              <li key={participant.identity}>
                <GroupCallVideoTile participant={participant} />
              </li>
            ))}
          </ul>
        ) : (
          <ul
            className="custom-scrollbar mb-6 max-h-64 space-y-1 overflow-y-auto"
            aria-label="Người trong cuộc gọi"
          >
            {displayParticipants.map((participant) => (
              <li
                key={participant.identity}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-2 py-2 transition-colors",
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

        <div className="flex items-center justify-center gap-6">
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
