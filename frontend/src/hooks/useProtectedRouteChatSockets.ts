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
  markConversationMention,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import {
  ackMessage,
  addMessage,
  failMessage,
  revokeMessage,
  updateMessagePoll,
  type Message,
  type PollData,
} from "@/redux/slices/messageSlice";
import { selectUser } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";

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
        const conversation = await getConversationByIdAPI(targetConversationId);
        dispatch(applyConversationUpdate({ conversation }));
        knownConversationIdsRef.current.add(targetConversationId);
        return conversation;
      } catch {
        return null;
      }
    };

    const processIncomingMessage = async (message: Message) => {
      const hydratedConversation = await ensureConversationHydrated(
        message.conversationId,
      );

      dispatch(addMessage(message));
      if (user?.id && message.mentionUserIds?.includes(user.id)) {
        dispatch(markConversationMention({
          conversationId: message.conversationId,
          messageId: message.id,
        }));
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
    }) => {
      if (!payload.conversationId) return;
      dispatch(
        failMessage({
          conversationId: payload.conversationId,
          clientMessageId: payload.clientMessageId,
        }),
      );
    };

    const systemMessageHandler = ({ message }: { message: Message }) => {
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
