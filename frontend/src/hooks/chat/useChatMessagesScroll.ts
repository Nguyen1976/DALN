import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

// Tab đang hiển thị hay không. Đọc qua useSyncExternalStore để không lỡ lần đổi
// nào xảy ra giữa lúc render và lúc đăng ký listener.
function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function isDocumentVisible() {
  return document.visibilityState === "visible";
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
  const isPageVisible = useSyncExternalStore(
    subscribeToVisibility,
    isDocumentVisible,
  );
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    null,
  );

  // Which conversation has already been pinned to its newest message.
  const initialPinnedForRef = useRef<string | null>(null);

  // Scroll ONLY the message list. `element.scrollIntoView()` scrolls every
  // scrollable ancestor as well — including the app shell, which is
  // `overflow-hidden` but still scrollable from script — and with its default
  // `block: "start"` it lifts the bottom of the thread to the top of the
  // screen, dragging the whole app up and leaving empty space below.
  const scrollListToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  // Hội thoại nào mở ra cũng bắt đầu ở cuối danh sách. `isAtBottom` còn là điều
  // kiện để báo "đã xem" (xem effect bên dưới): giá trị true này, cùng việc ghim
  // xuống cuối khi tải xong, là thứ khiến mở hội thoại được tính là đã xem ngay.
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
    if (isInitial) {
      initialPinnedForRef.current = conversationId ?? null;
      const scrollNow = () => scrollListToBottom("auto");
      scrollNow();
      // Bubbles settle a frame later (avatars, wrapped text); pin again once
      // the final height is known.
      requestAnimationFrame(scrollNow);
      window.setTimeout(scrollNow, 120);
      return;
    }

    scrollListToBottom("smooth");
  }, [messages.length, isAtBottom, conversationId, scrollListToBottom]);

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
    const container = containerRef.current;
    if (targetElement && container) {
      // Centre the message inside the list only (see scrollListToBottom for
      // why scrollIntoView is not used).
      const offset =
        targetElement.getBoundingClientRect().top -
        container.getBoundingClientRect().top;
      container.scrollTo({
        top:
          container.scrollTop +
          offset -
          (container.clientHeight - targetElement.clientHeight) / 2,
        behavior: "smooth",
      });
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

  // Chỉ báo "đã xem" khi người dùng thực sự nhìn thấy tin nhắn: hội thoại đang
  // mở, tab đang hiển thị và danh sách đang ở (gần) cuối. Chưa đủ điều kiện thì
  // hoãn lại; effect chạy lại ngay khi điều kiện thành đúng — tab hiện lên lại
  // (`isPageVisible`), hoặc người dùng cuộn / bấm nút xuống cuối (`handleScroll`
  // đặt `isAtBottom` = true). Trước đây tin được báo đã xem ngay khi tới, kể cả
  // lúc người dùng đang cuộn lên đọc lịch sử hay tab đang ở nền.
  useEffect(() => {
    if (!canLoadMessages || !conversationId || messages.length === 0) return;
    if (!isPageVisible || !isAtBottom) return;

    // Tin mới nhất của người khác đã có id thật. Tin của chính mình (kể cả tin
    // `temp-` đang chờ gửi) không bao giờ được báo, nhưng cũng không được che
    // mất tin của người khác đứng trước nó: đang cuộn lên thì có tin tới, rồi
    // người dùng trả lời luôn — tin tới đó vẫn phải được báo là đã xem.
    let latestFromOthers: Message | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.senderId === userId || message.id.startsWith("temp-")) {
        continue;
      }
      latestFromOthers = message;
      break;
    }
    if (!latestFromOthers) return;

    const alreadyReported = reportedReadRef.current[conversationId];
    if (alreadyReported && alreadyReported >= latestFromOthers.id) return;
    reportedReadRef.current[conversationId] = latestFromOthers.id;

    socket.emit(SOCKET_EVENTS.CHAT.MESSAGE_READ, {
      conversationId,
      lastMessageId: latestFromOthers.id,
    });

    dispatch(markConversationRead({ conversationId }));
  }, [
    canLoadMessages,
    conversationId,
    dispatch,
    isAtBottom,
    isPageVisible,
    messages,
    userId,
  ]);

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
    scrollListToBottom("smooth");
  }, [scrollListToBottom]);

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
