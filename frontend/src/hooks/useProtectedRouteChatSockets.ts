import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
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
  type Conversation,
} from "@/redux/slices/conversationSlice";
import {
  ackMessage,
  addMessage,
  failMessage,
  revokeMessage,
  updateMessagePoll,
  type Message,
} from "@/redux/slices/messageSlice";
import { selectUser } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";

function normalizeIncomingMessage(raw: unknown): Message | null {
  const source =
    raw && typeof raw === "object" && "message" in raw
      ? (raw as { message?: unknown }).message
      : raw;

  if (!source || typeof source !== "object") return null;

  const record = source as Record<string, unknown>;
  const conversation = record.conversation as { id?: string } | undefined;

  const normalized: Message = {
    ...(source as Message),
    id: String(record.id || record._id || ""),
    conversationId: String(
      record.conversationId || conversation?.id || record.chatId || "",
    ),
    text: String(record.text ?? record.content ?? ""),
    content: String(record.content ?? record.text ?? ""),
  };

  if (!normalized.id || !normalized.conversationId) return null;
  return normalized;
}

interface PollSocketPayload {
  conversationId: string;
  messageId: string;
  pollId: string;
  question: string;
  isMultipleChoice: boolean;
  isClosed: boolean;
  closedAt?: string | null;
  options: Array<{ id: string; text: string; count: number }>;
}

function toPollUpdatePayload(payload: PollSocketPayload) {
  return {
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    poll: {
      id: payload.pollId,
      question: payload.question,
      isMultipleChoice: Boolean(payload.isMultipleChoice),
      isClosed: Boolean(payload.isClosed),
      closedAt: payload.closedAt || null,
      options: payload.options || [],
    },
  };
}

export function useProtectedRouteChatSockets(conversationId?: string) {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);
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
        const response = await getConversationByIdAPI(targetConversationId);
        if (!response?.conversation) return null;

        dispatch(
          applyConversationUpdate({
            conversation: response.conversation as Conversation,
          }),
        );
        knownConversationIdsRef.current.add(targetConversationId);
        return response.conversation;
      } catch {
        return null;
      }
    };

    const processIncomingMessage = async (message: Message) => {
      const hydratedConversation = await ensureConversationHydrated(
        message.conversationId,
      );

      dispatch(addMessage(message));
      dispatch(
        updateNewMessage({
          conversationId: message.conversationId,
          lastMessage: { ...message },
        }),
      );

      if (
        message.conversationId !== selectedChatIdRef.current &&
        !hydratedConversation
      ) {
        dispatch(upUnreadCount({ conversationId: message.conversationId }));
      }
    };

    const newMessageHandler = (payload: { message: Message }) => {
      const normalized = normalizeIncomingMessage(payload);
      if (!normalized) return;
      void processIncomingMessage(normalized);
    };

    const ackHandler = (payload: {
      conversationId: string;
      clientMessageId?: string;
      serverMessageId: string;
      message?: Message;
    }) => {
      dispatch(
        ackMessage({
          conversationId: payload.conversationId,
          clientMessageId: payload.clientMessageId,
          serverMessageId: payload.serverMessageId,
          message: payload.message,
        }),
      );

      if (payload.message) {
        dispatch(
          updateNewMessage({
            conversationId: payload.conversationId,
            lastMessage: payload.message,
          }),
        );
      }
    };

    const errorHandler = (payload: {
      clientMessageId?: string;
      conversationId?: string;
    }) => {
      if (!payload.conversationId) return;
      dispatch(
        failMessage({
          conversationId: payload.conversationId,
          clientMessageId: payload.clientMessageId,
        }),
      );
    };

    const systemMessageHandler = (payload: { message: Message }) => {
      const message = normalizeIncomingMessage(payload);
      if (!message) return;

      dispatch(addMessage(message));
      dispatch(
        updateNewMessage({
          conversationId: message.conversationId,
          lastMessage: { ...message },
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
        currentConversation?.lastMessage?.id === payload.messageId
      ) {
        const normalized = normalizeIncomingMessage({
          message: payload.message,
        });
        if (normalized) {
          dispatch(
            updateNewMessage({
              conversationId: payload.conversationId,
              lastMessage: normalized,
            }),
          );
        }
      }
    };

    const pollHandler = (payload: PollSocketPayload) => {
      if (!payload?.conversationId || !payload?.messageId || !payload?.pollId) {
        return;
      }
      dispatch(updateMessagePoll(toPollUpdatePayload(payload)));
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
      membershipStatus?: "ACTIVE" | "REMOVED" | "LEFT";
      canSendMessage?: boolean;
    }) => {
      if (!payload?.conversation) return;
      dispatch(
        applyConversationUpdate({
          conversation: payload.conversation,
          membershipStatus: payload.membershipStatus,
          canSendMessage: payload.canSendMessage,
        }),
      );
    };

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
  }, [dispatch, user.id]);
}
