import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  applyConversationUpdate,
  selectConversationById,
} from "@/redux/slices/conversationSlice";
import { selectTypingUsersInConversation } from "@/redux/slices/typingIndicatorSlice";
import {
  hydrateSeenStatusFromMembers,
  selectConversationSeenStatus,
} from "@/redux/slices/seenStatusSlice";
import { selectUser } from "@/redux/slices/userSlice";
import { getConversationByIdAPI } from "@/apis";
import { getErrorMessage } from "@/utils/getErrorMessage";
import type { AppDispatch, RootState } from "@/redux/store";
import { displayNameOf } from "@/utils/displayName";

export function useChatConversationContext(conversationId?: string) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);
  const hydratedConversationRef = useRef<string | null>(null);

  const conversation = useSelector((state: RootState) =>
    conversationId ? selectConversationById(state, conversationId) : undefined,
  );

  // Until the conversation has loaded, nothing says otherwise.
  const canSendMessage = conversation?.canSendMessage ?? true;
  const membershipStatus = conversation?.membershipStatus ?? "ACTIVE";
  const canLoadMessages = membershipStatus === "ACTIVE";

  const conversationName = conversation?.displayName || "Trò chuyện";
  const conversationAvatar = conversation?.displayAvatar || "";

  const typingUsers = useSelector((state: RootState) =>
    selectTypingUsersInConversation(state, conversationId || ""),
  );

  const readMarks = useSelector((state: RootState) =>
    selectConversationSeenStatus(state, conversationId ?? ""),
  );

  const conversationMembers = conversation?.members || [];

  const memberNamesMap = useMemo(
    () =>
      new Map(
        conversationMembers.map((member) => [
          member.userId,
          displayNameOf(member) || "Unknown",
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

  /** Who has read up to each message, for the receipts under it. */
  const seenMessages = useMemo(() => {
    const result: Record<
      string,
      { userId: string; username?: string; avatar?: string }[]
    > = {};
    for (const [userId, messageId] of Object.entries(readMarks)) {
      (result[messageId] ??= []).push({
        userId,
        username: memberNamesMap.get(userId),
        avatar: memberAvatarMap.get(userId),
      });
    }
    return result;
  }, [readMarks, memberAvatarMap, memberNamesMap]);

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
    if (conversation?.members?.length) return;
    if (hydratedConversationRef.current === conversationId) return;

    hydratedConversationRef.current = conversationId;
    setLoadError(null);

    void (async () => {
      try {
        const conversation = await getConversationByIdAPI(conversationId);
        setLoadError(null);
        dispatch(applyConversationUpdate({ conversation }));
      } catch (error) {
        hydratedConversationRef.current = null;
        // Swallowing this left the user staring at "Chọn một cuộc trò chuyện",
        // as if nothing had been picked, when the real answer is that the
        // conversation does not exist or is not theirs.
        setLoadError(
          getErrorMessage(
            error,
            "Không mở được cuộc trò chuyện này. Có thể nó không tồn tại hoặc bạn không còn là thành viên.",
          ),
        );
      }
    })();
  }, [conversationId, dispatch, conversation?.members?.length]);

  return {
    user,
    conversation,
    canSendMessage,
    membershipStatus,
    canLoadMessages,
    conversationName,
    conversationAvatar,
    typingUserNames,
    seenMessages,
    loadError,
  };
}
