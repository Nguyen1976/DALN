import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { getConversationByIdAPI } from "@/apis";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import {
  addConversationMembers,
  applyConversationUpdate,
  removeConversationMember,
  selectConversation,
  setConversationAccessState,
  updateNewMessage,
  upUnreadCount,
  markConversationMention,
  getConversations,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import {
  ackMessage,
  addMessage,
  dropOtherConversations,
  failMessage,
  maxSeqOf,
  syncAfter,
  revokeMessage,
  updateMessagePoll,
  type Message,
  type PollData,
} from "@/redux/slices/messageSlice";
import { selectUser } from "@/redux/slices/userSlice";
import type { AppDispatch, RootState } from "@/redux/store";
import {
  findTextMessage,
  nextBusyDelay,
  pendingTextMessages,
  sendTextMessage,
} from "@/lib/resendPending";

export function useProtectedRouteChatSockets(conversationId?: string) {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const user = useSelector(selectUser);
  /** Số lần đã tự gửi lại vì server bận, theo clientMessageId. */
  const busyAttemptsRef = useRef(new Map<string, number>());
  const conversations = useSelector(selectConversation);

  const selectedChatIdRef = useRef<string | null>(conversationId ?? null);
  const knownConversationIdsRef = useRef<Set<string>>(new Set());
  const conversationsRef = useRef(conversations);

  useEffect(() => {
    knownConversationIdsRef.current = new Set(
      conversations.map((item) => item.id),
    );
  }, [conversations]);

  useEffect(() => {
    selectedChatIdRef.current = conversationId ?? null;
  }, [conversationId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    const ensureConversationHydrated = async (targetConversationId: string) => {
      if (knownConversationIdsRef.current.has(targetConversationId)) {
        return null;
      }

      try {
        const conversation = await getConversationByIdAPI(targetConversationId);
        dispatch(applyConversationUpdate({ conversation }));
        knownConversationIdsRef.current.add(targetConversationId);
        return conversation;
      } catch {
        return null;
      }
    };

    // Tin tới với seq nhảy cóc (seq > lớn nhất đang có + 1) nghĩa là đã lỡ tin
    // ở giữa: lấy bù. Gom các lần nhảy trong 300 ms thành một lần gọi.
    //
    // `gapStarts` giữ nơi khoảng trống bắt đầu, vì tin làm lộ nó vào store ngay
    // nên lúc lấy bù, seq lớn nhất đã nằm sau chỗ thiếu. Lấy bù hỏng thì mốc còn
    // đó cho lần sau: một khi seq lớn nhất đã vượt qua thì không còn gì nhắc lại.
    const gapStarts = new Map<string, number>();
    const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const noteGap = (targetConversationId: string, after: number) => {
      const known = gapStarts.get(targetConversationId);
      gapStarts.set(
        targetConversationId,
        known === undefined ? after : Math.min(known, after),
      );
    };
    const scheduleSync = (targetConversationId: string) => {
      clearTimeout(syncTimers.get(targetConversationId));
      syncTimers.set(
        targetConversationId,
        setTimeout(() => {
          syncTimers.delete(targetConversationId);
          void runSync(targetConversationId);
        }, 300),
      );
    };
    const runSync = async (targetConversationId: string) => {
      const after = gapStarts.get(targetConversationId);
      gapStarts.delete(targetConversationId);
      const result = await dispatch(
        syncAfter({ conversationId: targetConversationId, after }),
      );
      if (!syncAfter.rejected.match(result)) return;
      if (after !== undefined) noteGap(targetConversationId, after);
      // Một lần lấy bù khác đang chạy, nó có thể đã đọc xong trước tin này.
      if (result.meta.condition) scheduleSync(targetConversationId);
    };
    /** Gọi TRƯỚC khi tin vào store, với mọi đường đưa tin có seq vào store. */
    const detectGap = (message: Message) => {
      const before = maxSeqOf(
        store.getState().message.messages[message.conversationId],
      );
      if (
        before !== null &&
        typeof message.seq === "number" &&
        message.seq > before + 1
      ) {
        noteGap(message.conversationId, before);
        scheduleSync(message.conversationId);
      }
    };

    const processIncomingMessage = async (message: Message) => {
      detectGap(message);
      const hydratedConversation = await ensureConversationHydrated(
        message.conversationId,
      );

      dispatch(addMessage(message));
      if (user?.id && message.mentionUserIds?.includes(user.id)) {
        dispatch(
          markConversationMention({
            conversationId: message.conversationId,
            messageId: message.id,
          }),
        );
      }
      dispatch(
        updateNewMessage({
          conversationId: message.conversationId,
          lastMessage: message,
        }),
      );

      if (
        message.conversationId !== selectedChatIdRef.current &&
        !hydratedConversation
      ) {
        dispatch(upUnreadCount({ conversationId: message.conversationId }));
      }
    };

    const newMessageHandler = ({ message }: { message: Message }) => {
      void processIncomingMessage(message);
    };

    /** Our own message, saved: the ack is the stored message itself. */
    const ackHandler = (payload: {
      clientMessageId?: string;
      message: Message;
    }) => {
      detectGap(payload.message);
      dispatch(ackMessage(payload));
      dispatch(
        updateNewMessage({
          conversationId: payload.message.conversationId,
          lastMessage: payload.message,
        }),
      );
    };

    const errorHandler = (payload: {
      clientMessageId?: string;
      conversationId?: string;
      code?: string;
    }) => {
      if (!payload.conversationId) return;

      // Queue phía server đầy: tự gửi lại sau 2s, 4s, 8s rồi mới báo lỗi.
      const { conversationId: cid, clientMessageId } = payload;
      if (payload.code === "SERVER_BUSY" && clientMessageId) {
        const attempts = busyAttemptsRef.current.get(clientMessageId) ?? 0;
        const delay = nextBusyDelay(attempts);
        const message = findTextMessage(
          store.getState().message,
          cid,
          clientMessageId,
        );
        if (delay !== null && message) {
          busyAttemptsRef.current.set(clientMessageId, attempts + 1);
          window.setTimeout(() => sendTextMessage(dispatch, message), delay);
          return;
        }
        busyAttemptsRef.current.delete(clientMessageId);
      }

      dispatch(
        failMessage({
          conversationId: payload.conversationId,
          clientMessageId: payload.clientMessageId,
        }),
      );
    };

    const systemMessageHandler = ({ message }: { message: Message }) => {
      detectGap(message);
      dispatch(addMessage(message));
      dispatch(
        updateNewMessage({
          conversationId: message.conversationId,
          lastMessage: message,
        }),
      );
    };

    const revokedMessageHandler = (payload: {
      conversationId: string;
      messageId: string;
      message?: Message;
    }) => {
      if (!payload?.conversationId || !payload?.messageId) return;

      const currentConversation = conversationsRef.current.find(
        (item) => item.id === payload.conversationId,
      );

      dispatch(
        revokeMessage({
          conversationId: payload.conversationId,
          messageId: payload.messageId,
        }),
      );

      if (
        payload.message &&
        currentConversation?.lastMessageId === payload.messageId
      ) {
        dispatch(
          updateNewMessage({
            conversationId: payload.conversationId,
            lastMessage: payload.message,
          }),
        );
      }
    };

    // A vote or a close by anyone, you included: the whole poll as it is now.
    const pollHandler = (payload: {
      conversationId: string;
      messageId: string;
      poll: PollData;
    }) => {
      dispatch(updateMessagePoll(payload));
    };

    const memberAddedHandler = (payload: {
      conversationId: string;
      memberIds: string[];
      members?: Array<{
        userId: string;
        role?: "ADMIN" | "MEMBER" | "OWNER";
        username?: string;
        fullName?: string;
        avatar?: string;
      }>;
    }) => {
      dispatch(
        addConversationMembers({
          conversationId: payload.conversationId,
          memberIds: payload.memberIds || [],
          members: payload.members || [],
        }),
      );
    };

    const memberRemovedHandler = (payload: {
      conversationId: string;
      targetUserId: string;
    }) => {
      dispatch(
        removeConversationMember({
          conversationId: payload.conversationId,
          userId: payload.targetUserId,
        }),
      );

      if (payload.targetUserId === user.id) {
        dispatch(
          setConversationAccessState({
            conversationId: payload.conversationId,
            membershipStatus: "REMOVED",
            canSendMessage: false,
          }),
        );
      }
    };

    const memberLeftHandler = (payload: {
      conversationId: string;
      actorId: string;
    }) => {
      dispatch(
        removeConversationMember({
          conversationId: payload.conversationId,
          userId: payload.actorId,
        }),
      );

      if (payload.actorId === user.id) {
        dispatch(
          setConversationAccessState({
            conversationId: payload.conversationId,
            membershipStatus: "LEFT",
            canSendMessage: false,
          }),
        );
      }
    };

    const conversationUpdateHandler = (payload: {
      conversation: Conversation;
    }) => {
      dispatch(applyConversationUpdate(payload));
    };

    // Nối lại sau khi rớt (gateway chết, mạng chập chờn): gửi lại mọi tin văn
    // bản chưa có ACK, giữ nguyên clientMessageId nên server không lưu trùng.
    // Lần kết nối đầu không có gì để gửi lại.
    let connectedOnce = socket.connected;
    const reconnectHandler = () => {
      if (!connectedOnce) {
        connectedOnce = true;
        // Lần kết nối đầu cũng có thể đã lỡ tin: trang tải trang đầu qua HTTP
        // TRƯỚC khi socket kịp kết nối, tin tới giữa hai lúc đó không đến qua
        // socket. Chưa tải gì (syncAfter tự bỏ qua) thì không tốn request.
        const open = selectedChatIdRef.current;
        if (open) void runSync(open);
        return;
      }
      for (const message of pendingTextMessages(store.getState().message)) {
        sendTextMessage(dispatch, message);
      }
      // Trong lúc mất kết nối có thể đã lỡ tin. Hội thoại đang mở: lấy bù
      // ngay theo seq. Hội thoại khác: bỏ cache, mở ra thì tải lại trang đầu
      // (lấy bù tất cả cùng lúc dễ chạm hạn mức API). Danh sách hội thoại tải
      // lại trang đầu để badge và tin cuối đúng với server.
      const open = selectedChatIdRef.current;
      dispatch(dropOtherConversations(open));
      for (const id of [...gapStarts.keys()]) {
        if (id !== open) gapStarts.delete(id);
      }
      if (open) void runSync(open);
      void dispatch(getConversations({ limit: 20, cursor: null }));
    };

    socket.on("connect", reconnectHandler);
    socket.on(SOCKET_EVENTS.CHAT.MESSAGE_NEW, newMessageHandler);
    socket.on(SOCKET_EVENTS.CHAT.MESSAGE_ACK, ackHandler);
    socket.on(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, errorHandler);
    socket.on(SOCKET_EVENTS.CHAT.MESSAGE_SYSTEM, systemMessageHandler);
    socket.on(SOCKET_EVENTS.CHAT.MESSAGE_REVOKED, revokedMessageHandler);
    socket.on(SOCKET_EVENTS.CHAT.POLL_UPDATED, pollHandler);
    socket.on(SOCKET_EVENTS.CHAT.POLL_CLOSED, pollHandler);
    socket.on(SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_ADDED, memberAddedHandler);
    socket.on(
      SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_REMOVED,
      memberRemovedHandler,
    );
    socket.on(SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_LEFT, memberLeftHandler);
    socket.on(
      SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
      conversationUpdateHandler,
    );

    return () => {
      for (const timer of syncTimers.values()) clearTimeout(timer);
      socket.off("connect", reconnectHandler);
      socket.off(SOCKET_EVENTS.CHAT.MESSAGE_NEW, newMessageHandler);
      socket.off(SOCKET_EVENTS.CHAT.MESSAGE_ACK, ackHandler);
      socket.off(SOCKET_EVENTS.CHAT.MESSAGE_ERROR, errorHandler);
      socket.off(SOCKET_EVENTS.CHAT.MESSAGE_SYSTEM, systemMessageHandler);
      socket.off(SOCKET_EVENTS.CHAT.MESSAGE_REVOKED, revokedMessageHandler);
      socket.off(SOCKET_EVENTS.CHAT.POLL_UPDATED, pollHandler);
      socket.off(SOCKET_EVENTS.CHAT.POLL_CLOSED, pollHandler);
      socket.off(
        SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_ADDED,
        memberAddedHandler,
      );
      socket.off(
        SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_REMOVED,
        memberRemovedHandler,
      );
      socket.off(
        SOCKET_EVENTS.CHAT.CONVERSATION_MEMBER_LEFT,
        memberLeftHandler,
      );
      socket.off(
        SOCKET_EVENTS.CHAT.CONVERSATION_UPDATE,
        conversationUpdateHandler,
      );
    };
  }, [dispatch, store, user.id]);
}
