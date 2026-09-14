import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  selectConversationById,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import { selectUser } from "@/redux/slices/userSlice";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  UserX,
  WifiOff,
} from "lucide-react";
import { useSelector } from "react-redux";
import { describeCallError, useWebRTC } from "@/hooks/useWebRTC";
import { toast } from "sonner";
import { useCallRingTimeout } from "@/hooks/useCallRingTimeout";
import { useIncomingCallRingtone } from "@/hooks/useIncomingCallRingtone";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { CALL_RING_TIMEOUT_MS } from "@/constants/call";
import CallRingAvatar from "./CallRingAvatar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RootState } from "@/redux/store";

export type VoiceCallMode = "outgoing" | "incoming";

const BUSY_DISMISS_MS = 2_500;

interface VoiceCallModalProps {
  conversationId?: string;
  callerDisplayName?: string;
  callerDisplayAvatar?: string;
  mode?: VoiceCallMode;
  callerId?: string;
  /** ID phiên cuộc gọi (chế độ incoming lấy từ sự kiện incoming_call). */
  callId?: string;
  incomingOffer?: RTCSessionDescriptionInit;
  onClose: () => void;
}

function getPeerUserId(
  conversation: Conversation | undefined,
  currentUserId: string,
) {
  return conversation?.members?.find(
    (member) => member.userId !== currentUserId,
  )?.userId;
}

export default function VoiceCallModal({
  conversationId,
  callerDisplayName,
  callerDisplayAvatar,
  mode = "outgoing",
  callerId,
  callId,
  incomingOffer,
  onClose,
}: VoiceCallModalProps) {
  const user = useSelector(selectUser);
  const conversation = useSelector((state: RootState) =>
    conversationId ? selectConversationById(state, conversationId) : undefined,
  );

  const displayName =
    conversation?.displayName || callerDisplayName || "Cuộc gọi đến";
  const displayAvatar =
    conversation?.displayAvatar || callerDisplayAvatar || "";

  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const startedOutgoingRef = useRef(false);
  const callStatusRef = useRef<string>("idle");
  const dismissTimerRef = useRef<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showBusyResult, setShowBusyResult] = useState(false);

  const peerUserId = useMemo(() => {
    if (mode === "incoming" && callerId) return callerId;
    return getPeerUserId(conversation, user.id);
  }, [callerId, conversation, mode, user.id]);

  const {
    remoteStream,
    callStatus,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    handleReceiveAnswer,
    handleReceiveIceCandidate,
    toggleMute,
    cleanup,
    connectedAt,
    callIdRef,
  } = useWebRTC(socket);

  /**
   * Call duration, ticking from the moment audio actually flows.
   *
   * There was no timer at all: once connected the screen said "Đang trong
   * cuộc gọi" and nothing else, so a call could run for twenty minutes with
   * no way to tell.
   */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!connectedAt) {
      setElapsedSeconds(0);
      return;
    }
    const tick = () =>
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);

  const durationLabel = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [elapsedSeconds]);

  // Mirrored into a ref for the ring-timeout callback, which must read the
  // latest status without re-subscribing. Written in an effect: assigning a
  // ref during render is not allowed.
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  const isRinging =
    !showBusyResult &&
    ((mode === "outgoing" && callStatus === "calling") ||
      (mode === "incoming" && callStatus === "idle"));

  const shouldPlayIncomingRingtone = mode === "incoming" && isRinging;
  useIncomingCallRingtone(shouldPlayIncomingRingtone);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(
    (delayMs: number) => {
      clearDismissTimer();
      dismissTimerRef.current = window.setTimeout(() => {
        onClose();
      }, delayMs);
    },
    [clearDismissTimer, onClose],
  );

  const handleRingTimeout = useCallback(() => {
    if (mode === "outgoing" && callStatusRef.current === "calling") {
      // callId đã có từ ack incoming_call; endCall tự dùng nó (gateway suy ra
      // đối phương + conversationId từ phiên).
      endCall("no_answer");
      setShowBusyResult(true);
      scheduleClose(BUSY_DISMISS_MS);
      return;
    }

    if (mode === "incoming" && callStatusRef.current === "idle") {
      cleanup();
      onClose();
    }
  }, [cleanup, endCall, mode, onClose, scheduleClose]);

  useCallRingTimeout({
    active: isRinging,
    durationMs: CALL_RING_TIMEOUT_MS,
    onTimeout: handleRingTimeout,
  });

  const statusLabel = useMemo(() => {
    if (callStatus === "unreachable") return "Không kết nối được";
    if (showBusyResult || callStatus === "no_answer") {
      return "Người dùng bận";
    }
    if (mode === "incoming" && callStatus === "idle") {
      return "Cuộc gọi đến...";
    }
    if (callStatus === "calling") return "Đang gọi...";
    if (callStatus === "connecting") return "Đang kết nối...";
    if (callStatus === "connected") return "Đang trong cuộc gọi";
    if (callStatus === "rejected") return "Cuộc gọi bị từ chối";
    if (callStatus === "ended") return "Cuộc gọi đã kết thúc";
    return "Đang kết nối...";
  }, [callStatus, mode, showBusyResult]);

  useEffect(() => {
    if (
      mode !== "outgoing" ||
      !peerUserId ||
      !conversationId ||
      startedOutgoingRef.current
    ) {
      return;
    }

    startedOutgoingRef.current = true;
    // Theo hợp đồng: chỉ gửi conversationId + offer; gateway tự suy ra người
    // nhận và trả callId qua ack (được startCall lưu lại).
    void startCall(conversationId).catch((error) => {
      // Closing silently left the user with no idea why the call vanished.
      toast.error(describeCallError(error));
      onClose();
    });
  }, [conversationId, mode, onClose, peerUserId, startCall]);

  useEffect(() => {
    // Chỉ xử lý sự kiện đúng phiên của mình. Trước khi biết callId (người gọi
    // chưa nhận ack, người nhận chưa bấm nghe) thì không loại trừ.
    const isSameCall = (eventCallId?: string) =>
      !eventCallId || !callIdRef.current || eventCallId === callIdRef.current;

    const handleCallAccepted = async ({
      callId: eventCallId,
      answer,
    }: {
      callId?: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      if (!isSameCall(eventCallId)) return;
      await handleReceiveAnswer(answer);
    };

    const handleIceCandidate = async ({
      callId: eventCallId,
      candidate,
    }: {
      callId?: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (!isSameCall(eventCallId)) return;
      await handleReceiveIceCandidate(candidate);
    };

    const handleCallRejected = ({
      callId: eventCallId,
    }: { callId?: string } = {}) => {
      if (!isSameCall(eventCallId)) return;
      cleanup();
      onClose();
    };

    const handleCallEnded = ({
      callId: eventCallId,
      reason,
    }: {
      callId?: string;
      reason?: "no_answer" | "unreachable";
    } = {}) => {
      if (!isSameCall(eventCallId)) return;

      if (
        mode === "outgoing" &&
        callStatusRef.current === "calling" &&
        reason === "no_answer"
      ) {
        setShowBusyResult(true);
        // emit=false: đối phương đã kết thúc, ta chỉ dọn dẹp + hiển thị.
        endCall("no_answer", { emit: false });
        scheduleClose(BUSY_DISMISS_MS);
        return;
      }

      if (reason === "unreachable") {
        // Đối phương báo không kết nối được → hiển thị rồi tự đóng (effect
        // theo dõi callStatus 'unreachable').
        endCall("unreachable", { emit: false });
        return;
      }

      cleanup();
      onClose();
    };

    socket.on(SOCKET_EVENTS.CALL.CALL_ACCEPTED, handleCallAccepted);
    socket.on(SOCKET_EVENTS.CALL.ICE_CANDIDATE, handleIceCandidate);
    socket.on(SOCKET_EVENTS.CALL.CALL_REJECTED, handleCallRejected);
    socket.on(SOCKET_EVENTS.CALL.CALL_ENDED, handleCallEnded);

    return () => {
      socket.off(SOCKET_EVENTS.CALL.CALL_ACCEPTED, handleCallAccepted);
      socket.off(SOCKET_EVENTS.CALL.ICE_CANDIDATE, handleIceCandidate);
      socket.off(SOCKET_EVENTS.CALL.CALL_REJECTED, handleCallRejected);
      socket.off(SOCKET_EVENTS.CALL.CALL_ENDED, handleCallEnded);
    };
  }, [
    callIdRef,
    cleanup,
    endCall,
    handleReceiveAnswer,
    handleReceiveIceCandidate,
    mode,
    onClose,
    scheduleClose,
  ]);

  // Không kết nối được: giữ màn hình một nhịp để người dùng đọc được thông báo
  // rồi tự đóng, thay vì biến mất không rõ lý do.
  useEffect(() => {
    if (callStatus === "unreachable") {
      scheduleClose(BUSY_DISMISS_MS);
    }
  }, [callStatus, scheduleClose]);

  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (!audio) return;

    audio.srcObject = remoteStream;
    if (remoteStream) {
      void audio.play().catch(() => undefined);
    }
  }, [remoteStream]);

  useEffect(() => {
    return () => {
      clearDismissTimer();
      cleanup();
    };
  }, [cleanup, clearDismissTimer]);

  const handleAccept = async () => {
    if (!callId || !incomingOffer) return;

    try {
      await acceptCall(callId, incomingOffer);
    } catch (error) {
      toast.error(describeCallError(error));
      onClose();
    }
  };

  const handleReject = () => {
    if (callId) {
      rejectCall(callId);
    }
    cleanup();
    onClose();
  };

  const handleEndCall = () => {
    // endCall tự dùng callId của phiên (từ ack hoặc từ incoming_call); gateway
    // suy ra đối phương + conversationId nên client không khai lại.
    endCall();
    onClose();
  };

  const handleToggleMute = () => {
    setIsMuted(toggleMute());
  };

  if (mode === "outgoing" && !peerUserId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cuộc gọi thoại"
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
    >
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center text-center">
          <CallRingAvatar
            displayName={displayName}
            displayAvatar={displayAvatar}
            active={isRinging}
            durationMs={CALL_RING_TIMEOUT_MS}
          />

          <h3 className="mb-1 text-xl font-semibold tracking-[-0.01em] text-foreground">
            {displayName}
          </h3>
          {/* Call state is announced, not just displayed — a blind user gets
              "đang đổ chuông" / "đã kết nối" without watching the ring. */}
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "mb-8 text-sm",
              showBusyResult ||
                callStatus === "no_answer" ||
                callStatus === "unreachable"
                ? "font-medium text-warning-text"
                : "text-muted-foreground",
            )}
          >
            {statusLabel}
          </p>

          {callStatus === "connected" && (
            <p
              className="mt-1 text-center text-sm font-medium tabular-nums text-muted-foreground"
              aria-live="off"
            >
              <span className="sr-only">Thời lượng cuộc gọi </span>
              {durationLabel}
            </p>
          )}

          {callStatus === "unreachable" ? (
            <div className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning-text">
              <WifiOff className="size-7" aria-hidden="true" />
            </div>
          ) : showBusyResult || callStatus === "no_answer" ? (
            <div className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning-text">
              <UserX className="size-7" aria-hidden="true" />
            </div>
          ) : mode === "incoming" && callStatus === "idle" ? (
            <div className="flex gap-6">
              <Button
                variant="success"
                size="icon"
                onClick={() => void handleAccept()}
                aria-label="Chấp nhận cuộc gọi"
                className="size-14 rounded-full"
              >
                <Phone className="size-6" aria-hidden="true" />
              </Button>

              <Button
                variant="destructive"
                size="icon"
                onClick={handleReject}
                aria-label="Từ chối cuộc gọi"
                className="size-14 rounded-full"
              >
                <PhoneOff className="size-6" />
              </Button>
            </div>
          ) : callStatus === "connected" ? (
            <div className="flex gap-6">
              <Button
                variant="secondary"
                size="icon"
                onClick={handleToggleMute}
                aria-label={isMuted ? "Bật micro" : "Tắt micro"}
                aria-pressed={isMuted}
                className="size-14 rounded-full"
              >
                {isMuted ? (
                  <MicOff className="size-6" />
                ) : (
                  <Mic className="size-6" />
                )}
              </Button>

              <Button
                variant="destructive"
                size="icon"
                onClick={handleEndCall}
                aria-label="Kết thúc cuộc gọi"
                className="size-14 rounded-full"
              >
                <PhoneOff className="size-6" />
              </Button>

              <Button
                variant="secondary"
                size="icon"
                aria-label="Loa"
                className="size-14 rounded-full"
                disabled
              >
                <Volume2 className="size-6" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-6">
              <Button
                variant="destructive"
                size="icon"
                onClick={handleEndCall}
                aria-label="Hủy cuộc gọi"
                className="size-14 rounded-full"
              >
                <PhoneOff className="size-6" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
