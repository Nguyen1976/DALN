import { socket } from "@/lib/socket";
import { selectUser } from "@/redux/slices/userSlice";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useParams } from "react-router";
import { useEffect, useRef } from "react";
import { getConversationByIdAPI } from "@/apis";
import {
  ackMessage,
  addMessage,
  failMessage,
  revokeMessage,
  type Message,
} from "@/redux/slices/messageSlice";
import type { AppDispatch } from "@/redux/store";
import {
  addConversationMembers,
  applyConversationUpdate,
  removeConversationMember,
  setConversationAccessState,
  updateNewMessage,
  upUnreadCount,
  selectConversation,
} from "@/redux/slices/conversationSlice";
import { useSound } from "use-sound";
import notificationSound from "@/assets/notification.mp3";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { conversationId } = useParams();

  const selectedChatIdRef = useRef<string | null>(conversationId);
  const knownConversationIdsRef = useRef<Set<string>>(new Set());

  const [play] = useSound(notificationSound, { volume: 0.5 });

  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);
  const conversations = useSelector(selectConversation);
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
    const normalizeIncomingMessage = (raw: any): Message | null => {
      const source = raw?.message ?? raw;
      if (!source) return null;

      const normalized: Message = {
        ...source,
        id: source.id || source._id,
        conversationId:
          source.conversationId || source.conversation?.id || source.chatId,
        text: source.text ?? source.content ?? "",
        content: source.content ?? source.text ?? "",
      };

      if (!normalized.id || !normalized.conversationId) return null;
      return normalized;
    };

    const ensureConversationHydrated = async (targetConversationId: string) => {
      if (knownConversationIdsRef.current.has(targetConversationId))
        return null;

      try {
        const response = await getConversationByIdAPI(targetConversationId);
        if (!response?.conversation) return null;

        dispatch(
          applyConversationUpdate({
            conversation: response.conversation as any,
          }),
        );
        knownConversationIdsRef.current.add(targetConversationId);
        return response.conversation; // Return to indicate newly hydrated
      } catch {
        // Ignore hydration errors for inaccessible conversations.
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

      // Only increment unreadCount if:
      // 1. User is NOT currently viewing this conversation
      // 2. Conversation was NOT just hydrated from API (API unreadCount is already accurate)
      if (message.conversationId !== selectedChatIdRef.current) {
        // If not newly hydrated, increment unread count for this incoming message
        if (!hydratedConversation) {
          dispatch(
            upUnreadCount({
              conversationId: message.conversationId,
            }),
          );
        }
      }
      // play();
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
      conversation: any;
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

    socket.on("message:new", newMessageHandler);
    socket.on("message:ack", ackHandler);
    socket.on("message:error", errorHandler);
    socket.on("message:system", systemMessageHandler);
    socket.on("message:revoked", revokedMessageHandler);
    socket.on("conversation:member_added", memberAddedHandler);
    socket.on("conversation:member_removed", memberRemovedHandler);
    socket.on("conversation:member_left", memberLeftHandler);
    socket.on("conversation:update", conversationUpdateHandler);

    return () => {
      socket.off("message:new", newMessageHandler);
      socket.off("message:ack", ackHandler);
      socket.off("message:error", errorHandler);
      socket.off("message:system", systemMessageHandler);
      socket.off("message:revoked", revokedMessageHandler);
      socket.off("conversation:member_added", memberAddedHandler);
      socket.off("conversation:member_removed", memberRemovedHandler);
      socket.off("conversation:member_left", memberLeftHandler);
      socket.off("conversation:update", conversationUpdateHandler);
    };
  }, [dispatch, play, user.id]);

  if (!user?.id) {
    console.log("no user");
    return <Navigate to="/auth" replace />;
  }

  return children;
};

export default ProtectedRoute;
