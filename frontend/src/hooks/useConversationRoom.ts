import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { socket } from "@/lib/socket";
import { clearTypingUsers } from "@/redux/slices/typingIndicatorSlice";
import { markConversationRead } from "@/redux/slices/conversationSlice";
import type { AppDispatch } from "@/redux/store";

/**
 * Hook để manage việc join/leave Socket.io rooms cho conversation
 * Khi mở conversation, join vào room để nhận typing/read events
 * Khi đóng, tự động leave room
 * Cũng mark messages as read khi vào conversation
 */
export const useConversationRoom = (conversationId?: string) => {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (!conversationId) return;

    const handleConnect = () => {
      socket.emit("conversation:join", { conversationId });
      // Mark all messages as read when opening conversation
      dispatch(markConversationRead({ conversationId }));
    };

    if (socket.connected) {
      handleConnect();
    } else {
      socket.on("connect", handleConnect);
    }

    // Cleanup: Leave room khi unmount hoặc conversationId thay đổi
    return () => {
      socket.off("connect", handleConnect);
      socket.emit("conversation:leave", { conversationId });
      dispatch(clearTypingUsers(conversationId));
    };
  }, [conversationId, dispatch]);
};
