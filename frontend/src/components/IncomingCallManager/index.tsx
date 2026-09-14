import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import VoiceCallModal, {
  type VoiceCallMode,
} from "@/components/VoiceCallModal";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { selectFriend } from "@/redux/slices/friendSlice";
import type { Conversation } from "@/redux/slices/conversationSlice";
import type { RootState } from "@/redux/store";

type IncomingCallState = {
  mode: VoiceCallMode;
  /** ID phiên do gateway cấp; dùng để accept/reject/ice/ended. */
  callId: string;
  callerId: string;
  incomingOffer: RTCSessionDescriptionInit;
  conversationId?: string;
  callerDisplayName: string;
  callerDisplayAvatar: string;
};

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
  const conversations = useSelector(
    (state: RootState) => state.conversations ?? [],
  );
  const friends = useSelector(selectFriend);

  useEffect(() => {
    const handleIncomingCall = ({
      callId,
      callerId,
      offer,
      conversationId,
    }: {
      callId: string;
      callerId: string;
      offer: RTCSessionDescriptionInit;
      conversationId?: string;
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
      });
    };

    socket.on(SOCKET_EVENTS.CALL.INCOMING_CALL, handleIncomingCall);

    return () => {
      socket.off(SOCKET_EVENTS.CALL.INCOMING_CALL, handleIncomingCall);
    };
  }, [conversations, friends]);

  if (!incomingCall) return null;

  return (
    <VoiceCallModal
      conversationId={incomingCall.conversationId}
      callerDisplayName={incomingCall.callerDisplayName}
      callerDisplayAvatar={incomingCall.callerDisplayAvatar}
      mode={incomingCall.mode}
      callerId={incomingCall.callerId}
      callId={incomingCall.callId}
      incomingOffer={incomingCall.incomingOffer}
      onClose={() => setIncomingCall(null)}
    />
  );
}
