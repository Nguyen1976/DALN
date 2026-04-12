import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { socket } from "@/lib/socket";
import { clearTypingUsers } from "@/redux/slices/typingIndicatorSlice";
import {
  markConversationRead,
  selectConversationById,
} from "@/redux/slices/conversationSlice";
import { selectUser } from "@/redux/slices/userSlice";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import type { AppDispatch, RootState } from "@/redux/store";

/**
 * Hook để manage việc join/leave Socket.io rooms cho conversation
 * Khi mở conversation, join vào room để nhận typing/read events
 * Khi đóng, tự động leave room
 * Cũng mark messages as read khi vào conversation
 */
export const useConversationRoom = (conversationId?: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const conversation = useSelector((state: RootState) =>
    conversationId ? selectConversationById(state, conversationId) : null,
  );
  const user = useSelector(selectUser);

  const isObjectId = (value?: string | null) =>
    typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

  useEffect(() => {
    if (!conversationId) return;

    const handleConnect = () => {
      socket.emit("conversation:join", { conversationId });
      // Mark all messages as read when opening conversation
      dispatch(markConversationRead({ conversationId }));

      // Emit message:read event to trigger BE unreadCount reset
      if (
        conversation?.lastMessage?.id &&
        isObjectId(conversation.lastMessage.id) &&
        conversation.lastMessage.senderId !== user.id
      ) {
        socket.emit(SOCKET_EVENTS.CHAT.MESSAGE_READ, {
          conversationId,
          lastMessageId: conversation.lastMessage.id,
        });
      }
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
  }, [conversationId, conversation?.lastMessage?.id, dispatch]);
};
