import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
  type ActiveGroupRoom,
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
  startWithCamera: boolean;
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

type GroupCallAcceptAck =
  | { ok: true; url: string; token: string; callType?: CallType; iceServers?: RTCIceServer[] }
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
  // Hội thoại nhóm đang có phòng mở → chấm "đang gọi" ở danh sách. Cập nhật từ
  // broadcast group_call.state (gửi tới mọi thành viên khi ai đó vào/ra) + ended.
  const [activeGroupIds, setActiveGroupIds] = useState<string[]>([]);

  useEffect(() => {
    const onState = (p: {
      conversationId?: string;
      participants?: unknown[];
    } = {}) => {
      const cid = p.conversationId;
      if (!cid) return;
      const alive = (p.participants?.length ?? 0) > 0;
      setActiveGroupIds((prev) => {
        const has = prev.includes(cid);
        if (alive && !has) return [...prev, cid];
        if (!alive && has) return prev.filter((id) => id !== cid);
        return prev;
      });
    };
    const onEnded = (p: { conversationId?: string } = {}) => {
      if (!p.conversationId) return;
      setActiveGroupIds((prev) => prev.filter((id) => id !== p.conversationId));
    };
    socket.on(SOCKET_EVENTS.GROUP_CALL.STATE, onState);
    socket.on(SOCKET_EVENTS.GROUP_CALL.ENDED, onEnded);
    return () => {
      socket.off(SOCKET_EVENTS.GROUP_CALL.STATE, onState);
      socket.off(SOCKET_EVENTS.GROUP_CALL.ENDED, onEnded);
    };
  }, []);

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
              startWithCamera: (ack.callType ?? callType) === "video",
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

  // Tham gia phòng nhóm ĐANG diễn ra (banner discovery): accept để lấy token; vào
  // với camera TẮT để không bất ngờ mở camera, người dùng tự bật khi muốn.
  const joinGroupRoom = useCallback((room: ActiveGroupRoom) => {
    socket.emit(
      SOCKET_EVENTS.GROUP_CALL.ACCEPT,
      { callId: room.callId },
      (ack?: GroupCallAcceptAck) => {
        if (ack?.ok) {
          setGroupMinimized(false);
          setGroupCall({
            callId: room.callId,
            conversationId: room.conversationId,
            roomName: room.roomName,
            url: ack.url,
            token: ack.token,
            callType: ack.callType ?? room.callType,
            startWithCamera: false,
            iceServers: ack.iceServers,
          });
        } else {
          toast.error(describeGroupCallError(ack?.code));
        }
      },
    );
  }, []);

  const value = useMemo<CallContextValue>(
    () => ({
      startDirectCall,
      startGroupCall,
      joinGroupRoom,
      hasActiveOutgoingCall: voiceCall !== null || groupCall !== null,
      activeGroupConversationIds: activeGroupIds,
    }),
    [
      startDirectCall,
      startGroupCall,
      joinGroupRoom,
      voiceCall,
      groupCall,
      activeGroupIds,
    ],
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
          startWithCamera={groupCall.startWithCamera}
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
