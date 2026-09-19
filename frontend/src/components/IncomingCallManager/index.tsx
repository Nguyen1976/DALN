import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Phone, PhoneOff, Video } from "@/components/icons";
import { toast } from "sonner";
import VoiceCallModal, {
  type VoiceCallMode,
} from "@/components/VoiceCallModal";
import GroupCallModal from "@/components/GroupCallModal";
import CallRingAvatar from "@/components/VoiceCallModal/CallRingAvatar";
import { Button } from "@/components/ui/button";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { CALL_RING_TIMEOUT_MS } from "@/constants/call";
import { useIncomingCallRingtone } from "@/hooks/useIncomingCallRingtone";
import { describeGroupCallError } from "@/utils/groupCallError";
import { selectFriend } from "@/redux/slices/friendSlice";
import type { Conversation } from "@/redux/slices/conversationSlice";
import type { RootState } from "@/redux/store";

type CallType = "audio" | "video";

type IncomingCallState = {
  mode: VoiceCallMode;
  /** ID phiên do gateway cấp; dùng để accept/reject/ice/ended. */
  callId: string;
  callerId: string;
  incomingOffer: RTCSessionDescriptionInit;
  conversationId?: string;
  callerDisplayName: string;
  callerDisplayAvatar: string;
  callType: CallType;
};

/** Chuông gọi nhóm đang đổ (chưa chấp nhận). */
type IncomingGroupCallState = {
  callId: string;
  conversationId: string;
  roomName: string;
  title: string;
  callerName: string;
  callerAvatar: string;
  callType: CallType;
};

/** Cuộc gọi nhóm đã chấp nhận và đã có url/token để join. */
type ActiveGroupCallState = {
  callId: string;
  conversationId: string;
  roomName: string;
  url: string;
  token: string;
  callType: CallType;
  startWithCamera: boolean;
  iceServers?: RTCIceServer[];
};

/** Hình dạng ack của `group_call.accept`. */
type GroupCallAcceptAck =
  | {
      ok: true;
      url: string;
      token: string;
      callType?: CallType;
      iceServers?: RTCIceServer[];
    }
  | { ok: false; code?: string };

function findConversationByCaller(
  conversations: Conversation[],
  callerId: string,
  conversationId?: string,
) {
  if (conversationId) {
    const byId = conversations.find((item) => item.id === conversationId);
    if (byId) return byId;
  }

  return conversations.find(
    (item) =>
      item.type === "DIRECT" &&
      (item.peerUserId === callerId ||
        item.members?.some((member) => member.userId === callerId)),
  );
}

export default function IncomingCallManager() {
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(
    null,
  );
  const [incomingGroupCall, setIncomingGroupCall] =
    useState<IncomingGroupCallState | null>(null);
  const [activeGroupCall, setActiveGroupCall] =
    useState<ActiveGroupCallState | null>(null);
  // Thu nhỏ cho cuộc gọi ĐẾN đã bắt máy (giữ cuộc gọi sống, vẫn nhắn tin được).
  const [voiceMinimized, setVoiceMinimized] = useState(false);
  const [groupMinimized, setGroupMinimized] = useState(false);
  const conversations = useSelector(
    (state: RootState) => state.conversations ?? [],
  );
  const friends = useSelector(selectFriend);

  // Đổ chuông cho gọi nhóm khi đang có lời mời chưa xử lý.
  useIncomingCallRingtone(incomingGroupCall !== null);

  useEffect(() => {
    const handleIncomingCall = ({
      callId,
      callerId,
      offer,
      conversationId,
      callType,
    }: {
      callId: string;
      callerId: string;
      offer: RTCSessionDescriptionInit;
      conversationId?: string;
      callType?: CallType;
    }) => {
      // Không có callId thì không thể accept/reject đúng phiên → bỏ qua.
      if (!callId) return;

      const conversation = findConversationByCaller(
        conversations,
        callerId,
        conversationId,
      );
      const friend = friends.find((item) => item.id === callerId);

      setIncomingCall({
        mode: "incoming",
        callId,
        callerId,
        incomingOffer: offer,
        conversationId: conversation?.id ?? conversationId,
        callerDisplayName:
          conversation?.displayName ||
          friend?.fullName ||
          friend?.username ||
          "Cuộc gọi đến",
        callerDisplayAvatar:
          conversation?.displayAvatar || friend?.avatar || "",
        callType: callType === "video" ? "video" : "audio",
      });
    };

    // Một tab khác của mình đã bắt máy → tab này đóng màn hình chuông.
    const handleClaimed = ({ callId }: { callId?: string } = {}) => {
      setIncomingCall((prev) =>
        prev && (!callId || prev.callId === callId) ? null : prev,
      );
    };

    socket.on(SOCKET_EVENTS.CALL.INCOMING_CALL, handleIncomingCall);
    socket.on(SOCKET_EVENTS.CALL.CLAIMED, handleClaimed);

    return () => {
      socket.off(SOCKET_EVENTS.CALL.INCOMING_CALL, handleIncomingCall);
      socket.off(SOCKET_EVENTS.CALL.CLAIMED, handleClaimed);
    };
  }, [conversations, friends]);

  useEffect(() => {
    const handleGroupIncoming = ({
      callId,
      conversationId,
      roomName,
      from,
      callType,
    }: {
      callId: string;
      conversationId: string;
      roomName: string;
      from?: { id: string; username: string };
      callType?: CallType;
    }) => {
      if (!callId) return;

      const conversation = conversations.find(
        (item) => item.id === conversationId,
      );
      const friend = from ? friends.find((item) => item.id === from.id) : undefined;
      const callerName =
        from?.username || friend?.fullName || friend?.username || "Ai đó";

      setIncomingGroupCall({
        callId,
        conversationId,
        roomName,
        title: conversation?.displayName || "Cuộc gọi nhóm",
        callerName,
        callerAvatar: conversation?.displayAvatar || "",
        callType: callType === "video" ? "video" : "audio",
      });
    };

    // Nếu cuộc gọi kết thúc trước khi kịp bắt máy, tắt chuông đang đổ.
    const handleGroupEnded = ({
      callId,
      conversationId,
    }: { callId?: string; conversationId?: string } = {}) => {
      setIncomingGroupCall((prev) =>
        prev && (prev.callId === callId || prev.conversationId === conversationId)
          ? null
          : prev,
      );
    };

    socket.on(SOCKET_EVENTS.GROUP_CALL.INCOMING, handleGroupIncoming);
    socket.on(SOCKET_EVENTS.GROUP_CALL.ENDED, handleGroupEnded);

    return () => {
      socket.off(SOCKET_EVENTS.GROUP_CALL.INCOMING, handleGroupIncoming);
      socket.off(SOCKET_EVENTS.GROUP_CALL.ENDED, handleGroupEnded);
    };
  }, [conversations, friends]);

  const handleAcceptGroup = (withCamera = true) => {
    const call = incomingGroupCall;
    if (!call) return;

    socket.emit(
      SOCKET_EVENTS.GROUP_CALL.ACCEPT,
      { callId: call.callId },
      (ack?: GroupCallAcceptAck) => {
        if (ack?.ok) {
          const callType = ack.callType ?? call.callType;
          setActiveGroupCall({
            callId: call.callId,
            conversationId: call.conversationId,
            roomName: call.roomName,
            url: ack.url,
            token: ack.token,
            callType,
            // Chỉ bật camera khi là cuộc gọi video VÀ người nhận chọn "kèm camera".
            startWithCamera: callType === "video" && withCamera,
            iceServers: ack.iceServers,
          });
        } else {
          toast.error(describeGroupCallError(ack?.code));
        }
        setIncomingGroupCall(null);
      },
    );
  };

  const handleDeclineGroup = () => {
    if (incomingGroupCall) {
      socket.emit(SOCKET_EVENTS.GROUP_CALL.DECLINE, {
        callId: incomingGroupCall.callId,
      });
    }
    setIncomingGroupCall(null);
  };

  return (
    <>
      {incomingCall && (
        <VoiceCallModal
          conversationId={incomingCall.conversationId}
          callerDisplayName={incomingCall.callerDisplayName}
          callerDisplayAvatar={incomingCall.callerDisplayAvatar}
          mode={incomingCall.mode}
          callType={incomingCall.callType}
          callerId={incomingCall.callerId}
          callId={incomingCall.callId}
          incomingOffer={incomingCall.incomingOffer}
          minimized={voiceMinimized}
          onToggleMinimize={() => setVoiceMinimized((v) => !v)}
          onClose={() => {
            setIncomingCall(null);
            setVoiceMinimized(false);
          }}
        />
      )}

      {incomingGroupCall && !activeGroupCall && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cuộc gọi nhóm đến"
          className="fixed inset-0 z-50 flex animate-overlay-in items-center justify-center bg-scrim p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-sm animate-dialog-in rounded-2xl border border-border bg-card p-8 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <CallRingAvatar
                displayName={incomingGroupCall.title}
                displayAvatar={incomingGroupCall.callerAvatar}
                active
                durationMs={CALL_RING_TIMEOUT_MS}
              />

              <h3 className="mb-1 text-xl font-semibold tracking-[-0.01em] text-foreground">
                {incomingGroupCall.title}
              </h3>
              <p
                role="status"
                aria-live="polite"
                className="mb-8 text-sm text-muted-foreground"
              >
                {incomingGroupCall.callerName} đang mời bạn vào cuộc gọi{" "}
                {incomingGroupCall.callType === "video" ? "video " : ""}nhóm...
              </p>

              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-6">
                  {incomingGroupCall.callType === "video" && (
                    <Button
                      variant="success"
                      size="icon"
                      onClick={() => handleAcceptGroup(true)}
                      aria-label="Tham gia cuộc gọi nhóm"
                      title="Tham gia kèm camera"
                      className="size-14 rounded-full"
                    >
                      <Video className="size-6" aria-hidden="true" />
                    </Button>
                  )}

                  <Button
                    variant={
                      incomingGroupCall.callType === "video"
                        ? "secondary"
                        : "success"
                    }
                    size="icon"
                    onClick={() => handleAcceptGroup(false)}
                    aria-label={
                      incomingGroupCall.callType === "video"
                        ? "Tham gia chỉ âm thanh"
                        : "Tham gia cuộc gọi nhóm"
                    }
                    title={
                      incomingGroupCall.callType === "video"
                        ? "Tham gia chỉ âm thanh"
                        : "Tham gia"
                    }
                    className="size-14 rounded-full"
                  >
                    <Phone className="size-6" aria-hidden="true" />
                  </Button>

                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={handleDeclineGroup}
                    aria-label="Từ chối cuộc gọi nhóm"
                    className="size-14 rounded-full"
                  >
                    <PhoneOff className="size-6" />
                  </Button>
                </div>
                {incomingGroupCall.callType === "video" && (
                  <p className="text-xs text-muted-foreground">
                    Tham gia kèm camera hoặc chỉ âm thanh
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeGroupCall && (
        <GroupCallModal
          callId={activeGroupCall.callId}
          roomName={activeGroupCall.roomName}
          url={activeGroupCall.url}
          token={activeGroupCall.token}
          conversationId={activeGroupCall.conversationId}
          callType={activeGroupCall.callType}
          startWithCamera={activeGroupCall.startWithCamera}
          iceServers={activeGroupCall.iceServers}
          minimized={groupMinimized}
          onToggleMinimize={() => setGroupMinimized((v) => !v)}
          onClose={() => {
            setActiveGroupCall(null);
            setGroupMinimized(false);
          }}
        />
      )}
    </>
  );
}
