import { useCallback, useRef, useEffect } from "react";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";

interface UseTypingIndicatorProps {
  conversationId: string;
  enabled?: boolean;
}

/**
 * Hook để manage typing indicator
 * - Emit 'typing' event khi người dùng gõ
 * - Tự động dừng sau 3 giây không gõ
 * - Sử dụng debounce để tránh gửi liên tục
 */
export const useTypingIndicator = ({
  conversationId,
  enabled = true,
}: UseTypingIndicatorProps) => {
  const START_KEEPALIVE_MS = 4000;

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepAliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const isTypingRef = useRef(false);
  const isInputFocusedRef = useRef(false);

  const clearTypingTimers = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }
  }, []);

  const emitTypingStart = useCallback(() => {
    if (!enabled || !conversationId) return;

    socket.emit(SOCKET_EVENTS.CHAT.USER_TYPING, {
      conversationId,
      status: "start",
    });
  }, [conversationId, enabled]);

  const ensureKeepAlive = useCallback(() => {
    if (keepAliveIntervalRef.current) return;

    keepAliveIntervalRef.current = setInterval(() => {
      if (!isTypingRef.current || !isInputFocusedRef.current) return;
      emitTypingStart();
    }, START_KEEPALIVE_MS);
  }, [emitTypingStart]);

  const stopTyping = useCallback(() => {
    if (!conversationId) return;

    if (isTypingRef.current) {
      socket.emit(SOCKET_EVENTS.CHAT.USER_TYPING, {
        conversationId,
        status: "stop",
      });
      isTypingRef.current = false;
    }

    clearTypingTimers();
  }, [clearTypingTimers, conversationId]);

  const handleInputFocus = useCallback(() => {
    isInputFocusedRef.current = true;

    if (!isTypingRef.current) return;

    emitTypingStart();
    ensureKeepAlive();
  }, [emitTypingStart, ensureKeepAlive]);

  const handleInputBlur = useCallback(() => {
    isInputFocusedRef.current = false;
    stopTyping();
  }, [stopTyping]);

  const handleTyping = useCallback(
    (nextValue?: string) => {
      if (!enabled || !conversationId) return;

      if (typeof nextValue === "string" && nextValue.trim() === "") {
        stopTyping();
        return;
      }

      // Nếu chưa emit 'start', emit start
      if (!isTypingRef.current) {
        emitTypingStart();
        isTypingRef.current = true;
        ensureKeepAlive();
      }

      // Nếu đã có typing state, đảm bảo keepalive đang chạy
      ensureKeepAlive();

      // Không dùng timeout auto-stop theo vài giây nữa.
      // Stop sẽ được gửi ngay khi blur/xóa text/gửi tin/chuyển tab.
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    },
    [conversationId, emitTypingStart, enabled, ensureKeepAlive, stopTyping],
  );

  // Cleanup khi component unmount
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTyping();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      isInputFocusedRef.current = false;
      stopTyping();
    };
  }, [stopTyping]);

  return { handleTyping, stopTyping, handleInputFocus, handleInputBlur };
};
