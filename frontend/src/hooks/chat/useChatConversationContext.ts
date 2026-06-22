import { useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation } from "react-router";
import {
  applyConversationUpdate,
  selectConversationById,
  type Conversation,
} from "@/redux/slices/conversationSlice";
import { selectTypingUsersInConversation } from "@/redux/slices/typingIndicatorSlice";
import {
  hydrateSeenStatusFromMembers,
  selectConversationSeenStatus,
} from "@/redux/slices/seenStatusSlice";
import { selectUser } from "@/redux/slices/userSlice";
import { getConversationByIdAPI } from "@/apis";
import type { AppDispatch, RootState } from "@/redux/store";

export function useChatConversationContext(conversationId?: string) {
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();
  const user = useSelector(selectUser);
  const hydratedConversationRef = useRef<string | null>(null);

  const conversation = useSelector((state: RootState) =>
    conversationId ? selectConversationById(state, conversationId) : undefined,
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
      : selectConversationSeenStatus(state, ""),
  );

  const conversationMembers = effectiveConversation?.members || [];

  const memberNamesMap = useMemo(
    () =>
      new Map(
        conversationMembers.map((member) => [
          member.userId,
          member.username || member.fullName || "Unknown",
        ]),
      ),
    [conversationMembers],
  );

  const memberAvatarMap = useMemo(
    () =>
      new Map(
        conversationMembers.map((member) => [
          member.userId,
          member.avatar || "",
        ]),
      ),
    [conversationMembers],
  );

  const typingUserNames = useMemo(
    () =>
      typingUsers
        .filter((uid) => uid !== user.id)
        .map((uid) => memberNamesMap.get(uid) || "Unknown user"),
    [memberNamesMap, typingUsers, user.id],
  );

  const seenMessages = useMemo(() => {
    const result: Record<
      string,
      { userId: string; username?: string; avatar?: string }[]
    > = {};

    Object.entries(allSeenStatus).forEach(([messageId, seenUsers]) => {
      result[messageId] = seenUsers.map((seen) => ({
        userId: seen.userId,
        username: memberNamesMap.get(seen.userId),
        avatar: memberAvatarMap.get(seen.userId),
      }));
    });

    return result;
  }, [allSeenStatus, memberAvatarMap, memberNamesMap]);

  const hydratedSeenRef = useRef<string>("");

  useEffect(() => {
    hydratedSeenRef.current = "";
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !conversationMembers.length) return;

    const signature = conversationMembers
      .map((member) => `${member.userId}:${member.lastReadMessageId ?? ""}`)
      .join("|");

    if (signature === hydratedSeenRef.current) return;
    hydratedSeenRef.current = signature;

    dispatch(
      hydrateSeenStatusFromMembers({
        conversationId,
        currentUserId: user.id,
        members: conversationMembers,
      }),
    );
  }, [conversationId, conversationMembers, dispatch, user.id]);

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
