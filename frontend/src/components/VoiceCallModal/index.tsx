import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  selectConversationById,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import { selectUser } from "@/redux/slices/userSlice";
import { Phone, PhoneOff, Mic, MicOff, Volume2, UserX } from "lucide-react";
import { useSelector } from "react-redux";
import { useWebRTC } from "@/hooks/useWebRTC";
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
  } = useWebRTC(socket);

  callStatusRef.current = callStatus;

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
      if (peerUserId) {
        endCall(peerUserId, "no_answer");
      } else {
        cleanup();
      }
      setShowBusyResult(true);
      scheduleClose(BUSY_DISMISS_MS);
      return;
    }

    if (mode === "incoming" && callStatusRef.current === "idle") {
      cleanup();
      onClose();
    }
  }, [cleanup, endCall, mode, onClose, peerUserId, scheduleClose]);

  useCallRingTimeout({
    active: isRinging,
    durationMs: CALL_RING_TIMEOUT_MS,
    onTimeout: handleRingTimeout,
  });

  const statusLabel = useMemo(() => {
    if (showBusyResult || callStatus === "no_answer") {
      return "Người dùng bận";
    }
    if (mode === "incoming" && callStatus === "idle") {
      return "Cuộc gọi đến...";
    }
    if (callStatus === "calling") return "Đang gọi...";
    if (callStatus === "connected") return "Đang trong cuộc gọi";
    if (callStatus === "rejected") return "Cuộc gọi bị từ chối";
    if (callStatus === "ended") return "Cuộc gọi đã kết thúc";
    return "Đang kết nối...";
  }, [callStatus, mode, showBusyResult]);

  useEffect(() => {
    if (mode !== "outgoing" || !peerUserId || startedOutgoingRef.current) {
      return;
    }

    startedOutgoingRef.current = true;
    void startCall(peerUserId, conversationId).catch((error) => {
      console.error("Không thể bắt đầu cuộc gọi:", error);
      onClose();
    });
  }, [conversationId, mode, onClose, peerUserId, startCall]);

  useEffect(() => {
    const handleCallAccepted = async ({
      answer,
    }: {
      answer: RTCSessionDescriptionInit;
    }) => {
      await handleReceiveAnswer(answer);
    };

    const handleIceCandidate = async ({
      candidate,
    }: {
      candidate: RTCIceCandidateInit;
    }) => {
      await handleReceiveIceCandidate(candidate);
    };

    const handleCallRejected = () => {
      cleanup();
      onClose();
    };

    const handleCallEnded = ({
      reason,
    }: {
      reason?: "no_answer";
    } = {}) => {
      if (
        mode === "outgoing" &&
        callStatusRef.current === "calling" &&
        reason === "no_answer"
      ) {
        setShowBusyResult(true);
        cleanup();
        scheduleClose(BUSY_DISMISS_MS);
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
    cleanup,
    handleReceiveAnswer,
    handleReceiveIceCandidate,
    mode,
    onClose,
    scheduleClose,
  ]);

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
    if (!callerId || !incomingOffer) return;

    try {
      await acceptCall(callerId, incomingOffer);
    } catch (error) {
      console.error("Không thể chấp nhận cuộc gọi:", error);
      onClose();
    }
  };

  const handleReject = () => {
    if (callerId) {
      rejectCall(callerId);
    }
    cleanup();
    onClose();
  };

  const handleEndCall = () => {
    if (peerUserId) {
      endCall(peerUserId);
    } else {
      cleanup();
    }
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
              showBusyResult || callStatus === "no_answer"
                ? "font-medium text-warning-text"
                : "text-muted-foreground",
            )}
          >
            {statusLabel}
          </p>

          {showBusyResult || callStatus === "no_answer" ? (
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
