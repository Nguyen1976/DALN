import { api, type Page } from "@/utils/authorizeAxios";
import type { Conversation } from "@/redux/slices/conversationSlice";
import type { Message, PollData } from "@/redux/slices/messageSlice";

export type AssetKind = "MEDIA" | "LINK" | "DOC";
export type UploadType = "IMAGE" | "VIDEO" | "FILE";

export interface UploadMediaUrlResponse {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresInSeconds: number;
}

export interface MessageMediaInput {
  mediaType: UploadType;
  objectKey: string;
  url: string;
  mimeType: string;
  size: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
  fileName?: string;
  sortOrder?: number;
}

const cursorParam = (cursor: string | null | undefined) =>
  cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";

export const getConversationsAPI = (limit: number, cursor: string | null) =>
  api.get<Page<Conversation>>(
    `/chat/conversations?limit=${limit}${cursorParam(cursor)}`,
  );

export const getConversationByIdAPI = (conversationId: string) =>
  api.get<Conversation>(`/chat/conversations/${conversationId}`);

export const getConversationByFriendIdAPI = (friendId: string) =>
  api.get<Conversation>(`/chat/conversation-by-friend?friendId=${friendId}`);

export const searchConversationsAPI = (keyword: string) =>
  api.get<Conversation[]>(`/chat/search?keyword=${encodeURIComponent(keyword)}`);

/** A new group: `groupName`, one `memberIds` entry per friend, optional `groupAvatar`. */
export const createConversationAPI = (formData: FormData) =>
  api.post<Conversation>("/chat/create", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const getMessagesAPI = (
  conversationId: string,
  limit: number,
  cursor: string | null,
) =>
  api.get<Page<Message>>(
    `/chat/messages/${conversationId}?limit=${limit}${cursorParam(cursor)}`,
  );

export const clearConversationMentionsAPI = (conversationId: string) =>
  api.post("/chat/mentions/clear", { conversationId });

export const revokeMessageAPI = (data: {
  conversationId: string;
  messageId: string;
}) => api.post<Message>("/chat/messages/revoke", data);

export const deleteMessageForMeAPI = (data: {
  conversationId: string;
  messageId: string;
}) => api.post("/chat/messages/delete-for-me", data);

export const clearConversationHistoryAPI = (data: { conversationId: string }) =>
  api.post("/chat/conversations/clear-history", data);

/** The new poll's message (the poll is on it). */
export const createPollAPI = (data: {
  conversationId: string;
  question: string;
  options: string[];
  isMultipleChoice: boolean;
}) => api.post<Message>("/chat/polls", data);

/** A poll's state after a vote or a close, and which message it is on. */
export interface PollUpdate {
  conversationId: string;
  messageId: string;
  poll: PollData;
}

export const submitPollVoteAPI = (data: { pollId: string; optionIds: string[] }) =>
  api.post<PollUpdate>("/chat/polls/vote", data);

export const closePollAPI = (data: { pollId: string }) =>
  api.post<PollUpdate>("/chat/polls/close", data);

export const createMessageUploadUrlAPI = (payload: {
  conversationId: string;
  type: UploadType;
  mimeType: string;
  fileName: string;
  size: string;
}) => api.post<UploadMediaUrlResponse>("/chat/media/presign", payload);

export const uploadFileToSignedUrl = async (
  uploadUrl: string,
  file: File,
  mimeType: string,
): Promise<void> => {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    // The pre-signed URL is signed with this content type; sending the value
    // the server resolved (rather than letting the browser guess from the
    // File) keeps the signature valid for files whose extension and reported
    // type disagree.
    headers: { "Content-Type": mimeType },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Tải tệp lên kho lưu trữ thất bại");
  }
};

export const getConversationAssetsAPI = ({
  conversationId,
  kind,
  limit = 20,
  cursor,
}: {
  conversationId: string;
  kind: AssetKind;
  limit?: number;
  cursor?: string | null;
}) =>
  api.get<Page<Message>>(
    `/chat/assets?conversationId=${encodeURIComponent(
      conversationId,
    )}&kind=${kind}&limit=${limit}${cursorParam(cursor)}`,
  );

export const addMembersToConversationAPI = (payload: {
  conversationId: string;
  memberIds: string[];
}) => api.post("/chat/add-member", payload);

export const removeMemberFromConversationAPI = (payload: {
  conversationId: string;
  targetUserId: string;
}) => api.post("/chat/remove-member", payload);

export const promoteMemberAPI = (payload: {
  conversationId: string;
  targetUserId: string;
}) => api.post("/chat/promote-member", payload);

export const leaveConversationAPI = (payload: { conversationId: string }) =>
  api.post("/chat/leave-group", payload);

export const deleteConversationAPI = (payload: { conversationId: string }) =>
  api.post("/chat/delete-conversation", payload);
