import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import VoiceCallModal, {
  type VoiceCallMode,
} from "@/components/VoiceCallModal";
import GroupCallModal from "@/components/GroupCallModal";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { describeGroupCallError } from "@/utils/groupCallError";
import {
  CallContext,
  type CallContextValue,
  type CallType,
} from "./callContext";

type ActiveVoiceCall = {
  conversationId: string;
  mode: VoiceCallMode;
  callType: CallType;
};

type ActiveGroupCall = {
  callId: string;
  conversationId: string;
  roomName: string;
  url: string;
  token: string;
  callType: CallType;
  iceServers?: RTCIceServer[];
};

type GroupCallStartAck =
  | {
      ok: true;
      callId: string;
      roomName: string;
      url: string;
      token: string;
      callType?: CallType;
      iceServers?: RTCIceServer[];
    }
  | { ok: false; code?: string };

/**
 * CallProvider — giữ cuộc gọi RA NGOÀI (outgoing) sống xuyên suốt ứng dụng.
 *
 * Trước đây state cuộc gọi nằm trong trang Chat nên chuyển route (mở hội thoại
 * khác, sang trang bạn bè…) là cúp máy. Đưa lên cấp app (ngoài router) để "thu
 * nhỏ để tiếp tục nhắn tin" hoạt động: full/minimized chỉ là cách hiển thị, KHÔNG
 * tạo lại kết nối. Cuộc gọi ĐẾN vẫn do IncomingCallManager quản (cũng cấp app).
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const [voiceCall, setVoiceCall] = useState<ActiveVoiceCall | null>(null);
  const [voiceMinimized, setVoiceMinimized] = useState(false);
  const [groupCall, setGroupCall] = useState<ActiveGroupCall | null>(null);
  const [groupMinimized, setGroupMinimized] = useState(false);

  const startDirectCall = useCallback(
    (conversationId: string, callType: CallType) => {
      if (!conversationId) return;
      setVoiceMinimized(false);
      setVoiceCall({ conversationId, mode: "outgoing", callType });
    },
    [],
  );

  const startGroupCall = useCallback(
    (conversationId: string, callType: CallType) => {
      if (!conversationId) return;
      socket.emit(
        SOCKET_EVENTS.GROUP_CALL.START,
        { conversationId, callType },
        (ack?: GroupCallStartAck) => {
          if (ack?.ok) {
            setGroupMinimized(false);
            setGroupCall({
              callId: ack.callId,
              conversationId,
              roomName: ack.roomName,
              url: ack.url,
              token: ack.token,
              // Phòng đã mở giữ nguyên callType — tin theo ack của server.
              callType: ack.callType ?? callType,
              iceServers: ack.iceServers,
            });
          } else {
            toast.error(describeGroupCallError(ack?.code));
          }
        },
      );
    },
    [],
  );

  const value = useMemo<CallContextValue>(
    () => ({
      startDirectCall,
      startGroupCall,
      hasActiveOutgoingCall: voiceCall !== null || groupCall !== null,
    }),
    [startDirectCall, startGroupCall, voiceCall, groupCall],
  );

  return (
    <CallContext.Provider value={value}>
      {children}

      {voiceCall && (
        <VoiceCallModal
          conversationId={voiceCall.conversationId}
          mode={voiceCall.mode}
          callType={voiceCall.callType}
          minimized={voiceMinimized}
          onToggleMinimize={() => setVoiceMinimized((v) => !v)}
          onClose={() => {
            setVoiceCall(null);
            setVoiceMinimized(false);
          }}
        />
      )}

      {groupCall && (
        <GroupCallModal
          callId={groupCall.callId}
          roomName={groupCall.roomName}
          url={groupCall.url}
          token={groupCall.token}
          conversationId={groupCall.conversationId}
          callType={groupCall.callType}
          iceServers={groupCall.iceServers}
          minimized={groupMinimized}
          onToggleMinimize={() => setGroupMinimized((v) => !v)}
          onClose={() => {
            setGroupCall(null);
            setGroupMinimized(false);
          }}
        />
      )}
    </CallContext.Provider>
  );
}
