import type { Conversation } from "@/redux/slices/conversationSlice";

export function getDirectConversationPeer(
  conversation: Conversation | undefined,
  userId: string,
) {
  return conversation?.members?.find((member) => member.userId !== userId);
}

export function getConversationDisplayName(
  conversation: Conversation | undefined,
  userId: string,
) {
  if (!conversation) return "Trò chuyện";

  if (conversation.type === "DIRECT") {
    const peer = getDirectConversationPeer(conversation, userId);
    return (
      peer?.username ||
      peer?.fullName ||
      conversation.groupName ||
      "Trò chuyện trực tiếp"
    );
  }

  return conversation.groupName || "Nhóm chat";
}

export function getConversationDisplayAvatar(
  conversation: Conversation | undefined,
  userId: string,
) {
  if (!conversation) return "";

  if (conversation.type === "DIRECT") {
    return getDirectConversationPeer(conversation, userId)?.avatar || "";
  }

  return conversation.groupAvatar || "";
}
