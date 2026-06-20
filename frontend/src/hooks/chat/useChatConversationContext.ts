import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation } from "react-router";
import {
  applyConversationUpdate,
  type Conversation,
  type ConversationState,
} from "@/redux/slices/conversationSlice";
import { selectTypingUsersInConversation } from "@/redux/slices/typingIndicatorSlice";
import { selectConversationSeenStatus } from "@/redux/slices/seenStatusSlice";
import { selectUser } from "@/redux/slices/userSlice";
import { getConversationByIdAPI } from "@/apis";
import type { AppDispatch, RootState } from "@/redux/store";

export function useChatConversationContext(conversationId?: string) {
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();
  const user = useSelector(selectUser);
  const hydratedConversationRef = useRef<string | null>(null);

  const conversation = useSelector(
    (state: { conversations: ConversationState }) =>
      state.conversations?.find((c) => c.id === conversationId),
  );

  const pendingConversation = (
    location.state as { conversation?: Conversation } | null
  )?.conversation;

  const fallbackConversation =
    pendingConversation?.id === conversationId ? pendingConversation : undefined;

  const effectiveConversation = conversation || fallbackConversation;
  const canSendMessage = effectiveConversation?.canSendMessage !== false;
  const membershipStatus = effectiveConversation?.membershipStatus || "ACTIVE";
  const canLoadMessages = membershipStatus === "ACTIVE";

  const conversationName = effectiveConversation?.displayName || "Trò chuyện";
  const conversationAvatar = effectiveConversation?.displayAvatar || "";

  const typingUsers = useSelector((state: RootState) =>
    selectTypingUsersInConversation(state, conversationId || ""),
  );

  const allSeenStatus = useSelector((state: RootState) =>
    conversationId
      ? selectConversationSeenStatus(state, conversationId)
      : {},
  );

  const conversationMembers = effectiveConversation?.members || [];
  const memberNamesMap = new Map(
    conversationMembers.map((member) => [
      member.userId,
      member.username || member.fullName || "Unknown",
    ]),
  );
  const memberAvatarMap = new Map(
    conversationMembers.map((member) => [member.userId, member.avatar || ""]),
  );

  const typingUserNames = typingUsers
    .filter((uid) => uid !== user.id)
    .map((uid) => memberNamesMap.get(uid) || "Unknown user");

  const seenMessages: Record<
    string,
    { userId: string; username?: string; avatar?: string }[]
  > = {};

  Object.entries(allSeenStatus).forEach(([messageId, seenUsers]) => {
    seenMessages[messageId] = seenUsers.map((seen) => ({
      userId: seen.userId,
      username: memberNamesMap.get(seen.userId),
      avatar: memberAvatarMap.get(seen.userId),
    }));
  });

  useEffect(() => {
    if (!conversationId) return;
    if (effectiveConversation?.members?.length) return;
    if (hydratedConversationRef.current === conversationId) return;

    hydratedConversationRef.current = conversationId;

    void (async () => {
      try {
        const response = await getConversationByIdAPI(conversationId);
        if (!response?.conversation) return;

        dispatch(
          applyConversationUpdate({
            conversation: response.conversation as Conversation,
          }),
        );
      } catch {
        hydratedConversationRef.current = null;
      }
    })();
  }, [conversationId, dispatch, effectiveConversation?.members?.length]);

  return {
    user,
    conversation,
    effectiveConversation,
    canSendMessage,
    membershipStatus,
    canLoadMessages,
    conversationName,
    conversationAvatar,
    typingUserNames,
    seenMessages,
  };
}
