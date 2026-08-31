import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { markConversationRead } from "@/redux/slices/conversationSlice";
import { getMessages, type Message } from "@/redux/slices/messageSlice";
import type { AppDispatch } from "@/redux/store";

interface MessagePagination {
  oldestCursor: string | null;
  hasMore: boolean;
}

interface UseChatMessagesScrollOptions {
  conversationId?: string;
  messages: Message[];
  pagination: MessagePagination;
  canLoadMessages: boolean;
  userId: string;
  focusMessageId?: string | null;
  onFocusHandled?: () => void;
}

export function useChatMessagesScroll({
  conversationId,
  messages,
  pagination,
  canLoadMessages,
  userId,
  focusMessageId,
  onFocusHandled,
}: UseChatMessagesScrollOptions) {
  const dispatch = useDispatch<AppDispatch>();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    null,
  );

  // Which conversation has already been pinned to its newest message.
  const initialPinnedForRef = useRef<string | null>(null);

  useEffect(() => {
    initialPinnedForRef.current = null;
    setIsAtBottom(true);
  }, [conversationId]);

  useEffect(() => {
    if (!isAtBottom || !messages.length) return;

    const isInitial = initialPinnedForRef.current !== conversationId;

    // Opening a thread must land on the newest message immediately. A smooth
    // scroll animates through the whole history, and the "load older" observer
    // at the top fires mid-animation and prepends content underneath it — the
    // thread then opens stranded somewhere in the middle. Jump on the first
    // pin, animate only for messages that arrive afterwards.
    const scrollNow = () => {
      const container = containerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      } else {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }
    };

    if (isInitial) {
      initialPinnedForRef.current = conversationId ?? null;
      scrollNow();
      // Bubbles settle a frame later (avatars, wrapped text); pin again once
      // the final height is known.
      requestAnimationFrame(scrollNow);
      window.setTimeout(scrollNow, 120);
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isAtBottom, conversationId]);

  useEffect(() => {
    if (!conversationId || !canLoadMessages || messages.length > 0) return;

    dispatch(
      getMessages({
        conversationId,
        limit: 20,
        cursor: null,
      }),
    );
  }, [canLoadMessages, conversationId, dispatch, messages.length]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || !canLoadMessages) return;
    if (!pagination.hasMore || !pagination.oldestCursor || isLoadingOlder) {
      return;
    }

    const container = containerRef.current;
    const previousHeight = container?.scrollHeight || 0;

    setIsLoadingOlder(true);
    try {
      await dispatch(
        getMessages({
          conversationId,
          limit: 20,
          cursor: pagination.oldestCursor,
        }),
      ).unwrap();
    } finally {
      requestAnimationFrame(() => {
        const current = containerRef.current;
        if (current) {
          const nextHeight = current.scrollHeight;
          current.scrollTop = nextHeight - previousHeight + current.scrollTop;
        }
      });
      setIsLoadingOlder(false);
    }
  }, [
    canLoadMessages,
    conversationId,
    dispatch,
    isLoadingOlder,
    pagination.hasMore,
    pagination.oldestCursor,
  ]);

  useEffect(() => {
    if (!canLoadMessages) return;

    const container = containerRef.current;
    const sentinel = topSentinelRef.current;
    if (!container || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Ignore the sentinel until the thread has been pinned to the bottom:
        // on mount it is trivially in view, and loading older messages there
        // yanks the viewport away from the newest message.
        if (initialPinnedForRef.current !== conversationId) return;
        if (entries[0]?.isIntersecting) {
          void loadOlderMessages();
        }
      },
      {
        root: container,
        rootMargin: "120px 0px 0px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMessages, conversationId, loadOlderMessages]);

  useEffect(() => {
    if (!canLoadMessages || !focusMessageId || !conversationId) return;

    const targetElement = document.getElementById(`message-${focusMessageId}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightMessageId(focusMessageId);
      window.setTimeout(() => {
        setHighlightMessageId((prev) =>
          prev === focusMessageId ? null : prev,
        );
      }, 1800);
      onFocusHandled?.();
      return;
    }

    if (pagination.hasMore && !isLoadingOlder) {
      void loadOlderMessages();
    }
  }, [
    canLoadMessages,
    conversationId,
    focusMessageId,
    isLoadingOlder,
    loadOlderMessages,
    messages,
    onFocusHandled,
    pagination.hasMore,
  ]);

  // Highest message id already reported as read, per conversation. The effect
  // below runs on every change to `messages`, and the initial fetch can land
  // after a socket delivery — without this the hook would report an older id
  // right after a newer one and drag the read marker backwards.
  const reportedReadRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!canLoadMessages || !conversationId || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.senderId === userId) return;
    if (lastMessage.id.startsWith("temp-")) return;

    const alreadyReported = reportedReadRef.current[conversationId];
    if (alreadyReported && alreadyReported >= lastMessage.id) return;
    reportedReadRef.current[conversationId] = lastMessage.id;

    socket.emit(SOCKET_EVENTS.CHAT.MESSAGE_READ, {
      conversationId,
      lastMessageId: lastMessage.id,
    });

    dispatch(markConversationRead({ conversationId }));
  }, [canLoadMessages, conversationId, dispatch, messages, userId]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const threshold = 120;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    setIsAtBottom(atBottom);

    if (canLoadMessages && el.scrollTop <= 24) {
      void loadOlderMessages();
    }
  }, [canLoadMessages, loadOlderMessages]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return {
    containerRef,
    bottomRef,
    topSentinelRef,
    isAtBottom,
    highlightMessageId,
    handleScroll,
    scrollToBottom,
  };
}
