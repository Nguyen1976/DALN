import authorizeAxiosInstance from "@/utils/authorizeAxios";
import { API_ROOT } from "@/utils/constant";

export const makeFriendRequest = async (
  email: string,
): Promise<{ status: string }> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/user/make-friend`,
    { email },
  );
  return response.data;
};

export const getFriendRequestDetail = async (friendRequestId: string) => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/user/detail-friend-request?friendRequestId=${friendRequestId}`,
  );
  return response.data.data;
};

export const registerAPI = async (data: {
  email: string;
  username: string;
  password: string;
}): Promise<{ email: string; requiresOtpVerification: boolean }> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/user/register`,
    data,
  );
  return response.data.data;
};

export const verifyOtpAPI = async (data: { email: string; otp: string }) => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/user/verify-otp`,
    data,
  );
  return response.data.data;
};

export const resendOtpAPI = async (data: { email: string }) => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/user/resend-otp`,
    data,
  );
  return response.data.data;
};

export interface FromUser {
  email: string;
  username: string;
  avatar: string;
  id: string;
}

export interface DetailMakeFriendResponse {
  id: string;
  fromUser: FromUser | undefined;
  toUserId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface FriendRequestListItem {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  fromUser: FromUser;
}

export const getFriendRequestsAPI = async ({
  limit,
  page,
}: {
  limit: number;
  page: number;
}): Promise<FriendRequestListItem[]> => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/user/list-friend-requests?limit=${limit}&page=${page}`,
  );
  return response.data.data.friendRequests || [];
};

export const updateFriendRequestStatus = async ({
  inviterId,
  inviteeName,
  status,
}: {
  inviterId: string;
  inviteeName: string;
  status: "ACCEPTED" | "REJECTED";
}): Promise<{ status: string }> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/user/update-status-make-friend`,
    { inviterId, inviteeName, status },
  );
  return response.data;
};

export interface UserProfileByIdResponse {
  fullName: string;
  username: string;
  email: string;
  bio: string;
  avatar: string;
}

export interface SearchFriendItem {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  fullName?: string;
  status?: boolean;
}

export const getUserProfileByIdAPI = async (
  userId: string,
): Promise<UserProfileByIdResponse> => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/user?userId=${userId}`,
  );
  return response.data.data;
};

export const searchUsersAPI = async (
  keyword: string,
): Promise<SearchFriendItem[]> => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/user/search?keyword=${encodeURIComponent(keyword)}`,
  );
  return response.data.data.friends || [];
};

export interface ConversationByFriendResponse {
  conversation: {
    id: string;
    type: string;
    unreadCount?: string;
    groupName?: string;
    groupAvatar?: string;
    memberCount?: number;
    createdAt: string;
    updatedAt?: string;
    members: Array<{
      userId: string;
      lastReadAt?: string;
      username?: string;
      avatar?: string;
      fullName?: string;
      lastMessageAt?: string;
    }>;
    lastMessage: {
      id: string;
      conversationId: string;
      senderId: string;
      text: string;
      isDeleted?: boolean;
      createdAt: string;
      senderMember?: {
        userId: string;
        username?: string;
        avatar?: string;
        fullName?: string;
      };
    } | null;
  };
}

export const getConversationByFriendIdAPI = async (
  friendId: string,
): Promise<ConversationByFriendResponse> => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/chat/conversation-by-friend/?friendId=${friendId}`,
  );
  return response.data.data;
};

export interface SearchConversationItem {
  id: string;
  type: string;
  unreadCount?: string;
  groupName?: string;
  groupAvatar?: string;
  memberCount?: number;
  createdAt: string;
  updatedAt?: string;
  lastMessageAt?: string | null;
  lastMessageText?: string;
  lastMessageSenderId?: string | null;
  lastMessageSenderName?: string | null;
  lastMessageSenderAvatar?: string | null;
  members?: Array<{
    userId: string;
    lastReadAt?: string;
    username?: string;
    avatar?: string;
    fullName?: string;
    lastMessageAt?: string;
  }>;
  lastMessage?: {
    id: string;
    conversationId: string;
    senderId: string;
    text: string;
    isDeleted?: boolean;
    createdAt: string;
    senderMember?: {
      userId: string;
      username?: string;
      avatar?: string;
      fullName?: string;
    };
  } | null;
}

export interface ConversationByIdResponse {
  conversation: SearchConversationItem;
}

export const getConversationByIdAPI = async (
  conversationId: string,
): Promise<ConversationByIdResponse> => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/chat/conversations/${conversationId}`,
  );
  return response.data.data;
};

export const searchConversationsAPI = async (
  keyword: string,
): Promise<SearchConversationItem[]> => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/chat/search?keyword=${encodeURIComponent(keyword)}`,
  );
  return response.data.data || [];
};

export type MessageType = "TEXT" | "IMAGE" | "VIDEO" | "FILE";

export interface UploadMediaUrlResponse {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresInSeconds: string;
}

export interface MessageMediaInput {
  mediaType: "IMAGE" | "VIDEO" | "FILE";
  objectKey: string;
  url: string;
  mimeType: string;
  size: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
  sortOrder?: number;
}

export const createMessageUploadUrlAPI = async (payload: {
  conversationId: string;
  type: "IMAGE" | "VIDEO" | "FILE";
  mimeType: string;
  fileName: string;
  size: string;
}): Promise<UploadMediaUrlResponse> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/chat/media/presign`,
    payload,
  );
  return response.data.data;
};

export const uploadFileToSignedUrl = async (
  uploadUrl: string,
  file: File,
  _mimeType: string,
): Promise<void> => {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
  });

  if (!response.ok) {
    throw new Error("Tải tệp lên kho lưu trữ thất bại");
  }
};

export interface ConversationAssetMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  type?: "TEXT" | "IMAGE" | "VIDEO" | "FILE";
  createdAt: string;
  medias?: Array<{
    id?: string;
    mediaType: "IMAGE" | "VIDEO" | "FILE" | string;
    url: string;
    mimeType: string;
    size: string;
    sortOrder?: number;
  }>;
}

export const getConversationAssetsAPI = async ({
  conversationId,
  kind,
  limit = 20,
  cursor,
}: {
  conversationId: string;
  kind: "MEDIA" | "LINK" | "DOC";
  limit?: number;
  cursor?: string | null;
}): Promise<{ messages: ConversationAssetMessage[]; nextCursor?: string }> => {
  const response = await authorizeAxiosInstance.get(
    `${API_ROOT}/chat/assets?conversationId=${encodeURIComponent(
      conversationId,
    )}&kind=${kind}&limit=${limit}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`,
  );

  return response.data.data;
};

export const addMembersToConversationAPI = async (payload: {
  conversationId: string;
  memberIds?: string[];
  members?: Array<{
    userId: string;
    username?: string;
    fullName?: string;
    avatar?: string;
  }>;
}): Promise<{ status: string }> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/chat/add-member`,
    payload,
  );
  return response.data.data;
};

export const removeMemberFromConversationAPI = async (payload: {
  conversationId: string;
  targetUserId: string;
}): Promise<{ status: string }> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/chat/remove-member`,
    payload,
  );
  return response.data.data;
};

export const leaveConversationAPI = async (payload: {
  conversationId: string;
}): Promise<{ status: string; promotedUserId?: string }> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/chat/leave-group`,
    payload,
  );
  return response.data.data;
};

export const deleteConversationAPI = async (payload: {
  conversationId: string;
}): Promise<{ status: string }> => {
  const response = await authorizeAxiosInstance.post(
    `${API_ROOT}/chat/delete-conversation`,
    payload,
  );
  return response.data.data;
};
