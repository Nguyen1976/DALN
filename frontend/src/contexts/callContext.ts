import { createContext, useContext } from "react";

export type CallType = "audio" | "video";

export type CallContextValue = {
  /** Bắt đầu cuộc gọi 1-1 (DIRECT) ra ngoài. */
  startDirectCall: (conversationId: string, callType: CallType) => void;
  /** Bắt đầu cuộc gọi nhóm (GROUP) ra ngoài. */
  startGroupCall: (conversationId: string, callType: CallType) => void;
  /** Có cuộc gọi ra ngoài đang hoạt động không (để UI tránh mở trùng). */
  hasActiveOutgoingCall: boolean;
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
