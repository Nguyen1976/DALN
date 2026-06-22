import authorizeAxiosInstance from "@/utils/authorizeAxios";
import {
  createAsyncThunk,
  createSelector,
  createSlice,
} from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import type { Message } from "./messageSlice";
import { MessageMapper } from "@/utils/messageMapper";
import { toast } from "sonner";
import { logoutAPI } from "./userSlice";

export interface ConversationMember {
  userId: string;
  role?: "ADMIN" | "MEMBER" | "OWNER";
  lastReadAt?: string | null;
  lastReadMessageId?: string | null;
  username?: string;
  avatar?: string;
  fullName?: string;
  lastMessageAt?: string | null;
}

export interface Conversation {
  id: string;
  type: string;
  groupName?: string | null;
  groupAvatar?: string | null;
  displayName: string;
  displayAvatar: string;
  unreadCount: string;
  membershipStatus?: "ACTIVE" | "REMOVED" | "LEFT";
  canSendMessage?: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  members?: ConversationMember[];
  lastMessage?: Message | null;
  lastMessageId?: string | null;
  lastMessageAt?: string | null;
  lastMessageText?: string;
  lastMessageSenderId?: string | null;
  lastMessageSenderName?: string | null;
  lastMessageSenderAvatar?: string | null;
}

export type ConversationState = Conversation[];

const initialState: ConversationState = [];

const mergeConversation = (
  existing: Conversation,
  incoming: Conversation,
): Conversation => ({
  ...existing,
  ...incoming,
  members: incoming.members?.length ? incoming.members : existing.members,
  canSendMessage: incoming.canSendMessage ?? existing.canSendMessage,
  membershipStatus:
    incoming.membershipStatus || existing.membershipStatus || "ACTIVE",
});

const upsertConversation = (
  state: ConversationState,
  conversation: Conversation,
) => {
  const index = state.findIndex((item) => item.id === conversation.id);
  if (index === -1) {
    state.unshift(conversation);
    return;
  }
  state[index] = mergeConversation(state[index], conversation);
};

export const getConversations = createAsyncThunk(
  `/chat/conversations`,
  async ({ limit = 10, cursor }: { limit: number; cursor: string | null }) => {
    cursor = cursor?.replaceAll("+", "%2B") || null;
    const response = await authorizeAxiosInstance.get(
      `/chat/conversations?limit=${limit}&cursor=${cursor ?? ""}`,
    );
    return response.data.data as Conversation[];
  },
);

export const createConversation = createAsyncThunk(
  `/chat/create`,
  async (formData: FormData) => {
    const response = await authorizeAxiosInstance.post(
      "/chat/create",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return response.data.data as { conversation: Conversation };
  },
);

export const conversationSlice = createSlice({
  name: "conversations",
  initialState,
  reducers: {
    addConversation: (
      state,
      action: PayloadAction<{ conversation: Conversation }>,
    ) => {
      upsertConversation(state, {
        ...action.payload.conversation,
        unreadCount: action.payload.conversation.unreadCount || "0",
      });
    },
    updateNewMessage: (
      state,
      action: PayloadAction<{ conversationId: string; lastMessage: Message }>,
    ) => {
      const { conversationId, lastMessage } = action.payload;
      const target = state.find((conversation) => conversation.id === conversationId);
      if (!target) return;

      const preview = MessageMapper.previewText(lastMessage);
      const updated: Conversation = {
        ...target,
        lastMessage,
        lastMessageId: lastMessage.id,
        lastMessageAt: lastMessage.createdAt || target.lastMessageAt,
        lastMessageText: preview,
        lastMessageSenderId: lastMessage.senderId,
        lastMessageSenderName:
          lastMessage.senderMember?.fullName ||
          lastMessage.senderMember?.username ||
          null,
        lastMessageSenderAvatar: lastMessage.senderMember?.avatar || null,
        updatedAt: lastMessage.createdAt || target.updatedAt,
      };

      const rest = state.filter((conversation) => conversation.id !== conversationId);
      state.splice(0, state.length, updated, ...rest);
    },
    setConversationAccessState: (
      state,
      action: PayloadAction<{
        conversationId: string;
        membershipStatus: "ACTIVE" | "REMOVED" | "LEFT";
        canSendMessage: boolean;
      }>,
    ) => {
      const target = state.find(
        (conversation) => conversation.id === action.payload.conversationId,
      );
      if (!target) return;

      target.membershipStatus = action.payload.membershipStatus;
      target.canSendMessage = action.payload.canSendMessage;
    },
    applyConversationUpdate: (
      state,
      action: PayloadAction<{
        conversation: Conversation;
        membershipStatus?: "ACTIVE" | "REMOVED" | "LEFT";
        canSendMessage?: boolean;
      }>,
    ) => {
      const { conversation, membershipStatus, canSendMessage } = action.payload;
      upsertConversation(state, {
        ...conversation,
        membershipStatus:
          membershipStatus || conversation.membershipStatus || "ACTIVE",
        canSendMessage:
          canSendMessage ?? conversation.canSendMessage ?? true,
      });
    },
    addConversationMembers: (
      state,
      action: PayloadAction<{
        conversationId: string;
        memberIds: string[];
        members?: Array<{
          userId: string;
          role?: "ADMIN" | "MEMBER" | "OWNER";
          username?: string;
          fullName?: string;
          avatar?: string;
        }>;
      }>,
    ) => {
      const target = state.find(
        (conversation) => conversation.id === action.payload.conversationId,
      );
      if (!target) return;

      target.members ||= [];
      const incomingById = new Map(
        (action.payload.members || []).map((member) => [member.userId, member]),
      );
      const existingIds = new Set(target.members.map((member) => member.userId));
      let addedCount = 0;

      for (let index = 0; index < target.members.length; index += 1) {
        const existing = target.members[index];
        const incoming = incomingById.get(existing.userId);
        if (!incoming) continue;
        target.members[index] = { ...existing, ...incoming };
      }

      for (const memberId of action.payload.memberIds) {
        if (existingIds.has(memberId)) continue;
        const incoming = incomingById.get(memberId);
        addedCount += 1;
        target.members.push({
          userId: memberId,
          role: incoming?.role,
          username: incoming?.username,
          fullName: incoming?.fullName,
          avatar: incoming?.avatar,
        });
      }

      if (addedCount > 0) {
        target.memberCount += addedCount;
      }
    },
    removeConversationMember: (
      state,
      action: PayloadAction<{
        conversationId: string;
        userId: string;
      }>,
    ) => {
      const target = state.find(
        (conversation) => conversation.id === action.payload.conversationId,
      );
      if (!target?.members) return;

      const beforeCount = target.members.length;
      target.members = target.members.filter(
        (member) => member.userId !== action.payload.userId,
      );
      const removedCount = beforeCount - target.members.length;
      if (removedCount > 0) {
        target.memberCount = Math.max(target.memberCount - removedCount, 0);
      }
    },
    removeConversationById: (
      state,
      action: PayloadAction<{ conversationId: string }>,
    ) => {
      return state.filter(
        (conversation) => conversation.id !== action.payload.conversationId,
      );
    },
    upUnreadCount: (
      state,
      action: PayloadAction<{ conversationId: string }>,
    ) => {
      const conversation = state.find(
        (item) => item.id === action.payload.conversationId,
      );
      if (!conversation || conversation.unreadCount === "5+") return;

      const next = Number(conversation.unreadCount) + 1;
      conversation.unreadCount = next > 5 ? "5+" : String(next);
    },
    markConversationRead: (
      state,
      action: PayloadAction<{ conversationId: string }>,
    ) => {
      const target = state.find(
        (conversation) => conversation.id === action.payload.conversationId,
      );
      if (!target) return;
      target.unreadCount = "0";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getConversations.fulfilled, (state, action) => {
        for (const conversation of action.payload || []) {
          const index = state.findIndex((item) => item.id === conversation.id);
          if (index === -1) {
            state.push(conversation);
            continue;
          }
          state[index] = mergeConversation(state[index], conversation);
        }
      })
      .addCase(createConversation.fulfilled, (state, action) => {
        upsertConversation(state, action.payload.conversation);
        toast.success("Đã tạo cuộc trò chuyện thành công");
      })
      .addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectConversation = (state: RootState) => state.conversations;

export const selectConversationById = createSelector(
  [selectConversation, (_state: RootState, conversationId: string) => conversationId],
  (conversations, conversationId) =>
    conversations.find((conversation) => conversation.id === conversationId),
);

export const {
  addConversation,
  updateNewMessage,
  upUnreadCount,
  markConversationRead,
  setConversationAccessState,
  applyConversationUpdate,
  addConversationMembers,
  removeConversationMember,
  removeConversationById,
} = conversationSlice.actions;

export default conversationSlice.reducer;
