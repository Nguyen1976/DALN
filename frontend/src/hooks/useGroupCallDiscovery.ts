import { useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import type { ActiveGroupRoom } from "@/contexts/callContext";

type QueryAck =
  | { ok: true; active: (ActiveGroupRoom & { participantCount?: number }) | null }
  | { ok: false; code?: string };

/**
 * Discovery: khi mở một hội thoại NHÓM, hỏi server phòng gọi có đang mở không để
 * hiện banner "Tham gia" (thiết kế mục 02). Cập nhật realtime theo group_call.state
 * (ai đó vào/ra) và group_call.ended (phòng đóng). Server là nguồn sự thật.
 */
export function useGroupCallDiscovery(
  conversationId: string | undefined,
  isGroup: boolean,
): ActiveGroupRoom | null {
  const [activeRoom, setActiveRoom] = useState<ActiveGroupRoom | null>(null);

  useEffect(() => {
    if (!conversationId || !isGroup) {
      setActiveRoom(null);
      return;
    }
    let cancelled = false;

    const query = () =>
      socket.emit(
        SOCKET_EVENTS.GROUP_CALL.QUERY_STATE,
        { conversationId },
        (ack?: QueryAck) => {
          if (cancelled) return;
          if (ack?.ok && ack.active) {
            setActiveRoom({
              callId: ack.active.callId,
              conversationId,
              roomName: ack.active.roomName,
              callType: ack.active.callType,
            });
          } else {
            setActiveRoom(null);
          }
        },
      );

    query();

    // Ai đó vào/ra phòng → hỏi lại trạng thái chuẩn (kể cả về 0 người → hết phòng).
    const onState = (p: { conversationId?: string } = {}) => {
      if (p.conversationId && p.conversationId !== conversationId) return;
      query();
    };
    const onEnded = (p: { conversationId?: string } = {}) => {
      if (p.conversationId && p.conversationId !== conversationId) return;
      setActiveRoom(null);
    };

    socket.on(SOCKET_EVENTS.GROUP_CALL.STATE, onState);
    socket.on(SOCKET_EVENTS.GROUP_CALL.ENDED, onEnded);
    return () => {
      cancelled = true;
      socket.off(SOCKET_EVENTS.GROUP_CALL.STATE, onState);
      socket.off(SOCKET_EVENTS.GROUP_CALL.ENDED, onEnded);
    };
  }, [conversationId, isGroup]);

  return activeRoom;
}
