import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import {
  addTypingUser,
  removeTypingUser,
} from "@/redux/slices/typingIndicatorSlice";
import { updateSeenStatus } from "@/redux/slices/seenStatusSlice";
import { selectUser } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";

/**
 * Hook để setup socket event listeners cho typing indicator và seen status
 * Chỉ cần gọi một lần ở root component
 */
export const useChatSocketEvents = () => {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    const typingTimeouts = typingTimeoutsRef.current;

    // ===== TYPING INDICATOR =====
    const handleUserTyping = (data: {
      conversationId: string;
      userId: string;
      status: "start" | "stop";
    }) => {
      if (!data?.conversationId || !data?.userId || !data?.status) return;

      const timeoutKey = `${data.conversationId}:${data.userId}`;
      const existingTimeout = typingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        typingTimeouts.delete(timeoutKey);
      }

      if (data.status === "start") {
        // Thêm user vào danh sách đang gõ
        dispatch(
          addTypingUser({
            conversationId: data.conversationId,
            userId: data.userId,
          }),
        );

        // Fallback: tự remove nếu không nhận được stop event
        const fallbackTimeout = setTimeout(() => {
          dispatch(
            removeTypingUser({
              conversationId: data.conversationId,
              userId: data.userId,
            }),
          );
          typingTimeouts.delete(timeoutKey);
        }, 5500);
        typingTimeouts.set(timeoutKey, fallbackTimeout);
      } else if (data.status === "stop") {
        // Xóa user khỏi danh sách đang gõ
        dispatch(
          removeTypingUser({
            conversationId: data.conversationId,
            userId: data.userId,
          }),
        );
      }
    };

    // ===== SEEN STATUS =====
    const handleUserRead = (data: {
      conversationId: string;
      userId: string;
      lastReadMessageId?: string;
      lastMessageId?: string;
    }) => {
      // Không dispatch nếu là chính mình (đã xử lý phía local)
      if (data.userId === user.id) return;

      const normalizedLastReadMessageId =
        data.lastReadMessageId || data.lastMessageId;
      if (!normalizedLastReadMessageId) return;

      dispatch(
        updateSeenStatus({
          conversationId: data.conversationId,
          userId: data.userId,
          lastReadMessageId: normalizedLastReadMessageId,
        }),
      );
    };

    // Register event listeners
    socket.on(SOCKET_EVENTS.CHAT.USER_TYPING, handleUserTyping);
    socket.on(SOCKET_EVENTS.CHAT.USER_READ, handleUserRead);

    // Cleanup
    return () => {
      socket.off(SOCKET_EVENTS.CHAT.USER_TYPING, handleUserTyping);
      socket.off(SOCKET_EVENTS.CHAT.USER_READ, handleUserRead);

      typingTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      typingTimeouts.clear();
    };
  }, [dispatch, user.id]);
};
