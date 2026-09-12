import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { socket } from "@/lib/socket";
import { clearTypingUsers } from "@/redux/slices/typingIndicatorSlice";
import type { AppDispatch } from "@/redux/store";

/**
 * Join room `conversation:<id>` để nhận typing / user:read_batch của hội thoại
 * đang mở.
 *
 * Effect chỉ phụ thuộc vào `conversationId`. Trước đây nó còn phụ thuộc vào tin
 * nhắn cuối cùng, nên mỗi tin mới lại leave rồi join lại room — socket có thể
 * lỡ typing / user:read_batch trong khoảng hở đó — và gửi thêm một
 * `message:read` trùng. Việc báo "đã xem" giờ chỉ do useChatMessagesScroll lo,
 * và chỉ khi người dùng thực sự nhìn thấy tin nhắn.
 */
export const useConversationRoom = (conversationId?: string) => {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (!conversationId) return;

    const joinRoom = () => {
      socket.emit("conversation:join", { conversationId });
    };

    // Room gắn với từng kết nối: sau khi reconnect server coi đây là socket mới
    // và không còn giữ room cũ, nên phải join lại mỗi lần "connect".
    if (socket.connected) joinRoom();
    socket.on("connect", joinRoom);

    return () => {
      socket.off("connect", joinRoom);
      socket.emit("conversation:leave", { conversationId });
      dispatch(clearTypingUsers(conversationId));
    };
  }, [conversationId, dispatch]);
};
