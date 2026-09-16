import { createContext, useContext } from "react";

export type CallType = "audio" | "video";

/** Phòng nhóm đang mở, lấy từ banner "Tham gia" (group_call.query_state). */
export type ActiveGroupRoom = {
  callId: string;
  conversationId: string;
  roomName: string;
  callType: CallType;
};

export type CallContextValue = {
  /** Bắt đầu cuộc gọi 1-1 (DIRECT) ra ngoài. */
  startDirectCall: (conversationId: string, callType: CallType) => void;
  /** Bắt đầu cuộc gọi nhóm (GROUP) ra ngoài. */
  startGroupCall: (conversationId: string, callType: CallType) => void;
  /** Tham gia một phòng nhóm ĐANG diễn ra (từ banner discovery). */
  joinGroupRoom: (room: ActiveGroupRoom) => void;
  /** Có cuộc gọi ra ngoài đang hoạt động không (để UI tránh mở trùng). */
  hasActiveOutgoingCall: boolean;
  /** Id các hội thoại NHÓM đang có phòng gọi mở (chấm "đang gọi" ở danh sách). */
  activeGroupConversationIds: string[];
};

// Context + hook tách khỏi CallProvider.tsx để file provider chỉ export component
// (react-refresh/only-export-components).
export const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error("useCall must be used within a CallProvider");
  }
  return ctx;
}
