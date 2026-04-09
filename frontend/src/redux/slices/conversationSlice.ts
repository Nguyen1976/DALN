import authorizeAxiosInstance from "@/utils/authorizeAxios";
import { API_ROOT } from "@/utils/constant";
import {
  createAsyncThunk,
  createSelector,
  createSlice,
} from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import type { Message } from "./messageSlice";
import { toast } from "sonner";
import { logoutAPI } from "./userSlice";

export interface ConversationMember {
  userId: string;
  role?: "ADMIN" | "MEMBER" | "OWNER";
  /** timestamp (ms) */
  lastReadMessageId?: string;
  lastReadAt?: string;
  username?: string;
  avatar?: string;
  fullName?: string;
  lastMessageAt?: string;
}

export interface Conversation {
  id: string;
  type: string;
  unreadCount?: string;
  membershipStatus?: "ACTIVE" | "REMOVED" | "LEFT";
  canSendMessage?: boolean;
  groupName?: string | undefined;
  groupAvatar?: string | undefined;
  memberCount?: number;
  createdAt: string;
  updatedAt?: string | undefined;
  members?: ConversationMember[];
  lastMessage?: Message | null;
  lastMessageAt?: string;
  lastMessageText?: string;
  lastMessageSenderId?: string | null;
  lastMessageSenderName?: string | null;
  lastMessageSenderAvatar?: string | null;
}

export type ConversationState = Conversation[];

const initialState: ConversationState = [];

const getConversationTitle = (conversation: Conversation, userId?: string) => {
  if (conversation.type !== "DIRECT") {
    return conversation.groupName || "Nhóm chat";
  }

  const otherMember = conversation.members?.find(
    (member) => member.userId !== userId,
  );

  return (
    otherMember?.username ||
    otherMember?.fullName ||
    conversation.groupName ||
    "Trò chuyện trực tiếp"
  );
};

const getConversationAvatar = (conversation: Conversation, userId?: string) => {
  if (conversation.type !== "DIRECT") {
    return conversation.groupAvatar || "";
  }

  const otherMember = conversation.members?.find(
    (member) => member.userId !== userId,
  );

  return otherMember?.avatar || conversation.groupAvatar || "";
};

const getConversationMemberCount = (conversation: Conversation) => {
  return conversation.memberCount ?? conversation.members?.length ?? 0;
};

export const getConversations = createAsyncThunk(
  `/chat/conversations`,
  async (
    { limit = 10, cursor }: { limit: number; cursor: string | null },
    { getState },
  ) => {
    const state = getState() as RootState;
    const userId = state.user.id;
    cursor = cursor?.replaceAll("+", "%2B") || null;
    const response = await authorizeAxiosInstance.get(
      `${API_ROOT}/chat/conversations?limit=${limit}&cursor=${cursor ?? ""}`,
    );
    return { userId, conversations: response.data.data };
  },
);

export const createConversation = createAsyncThunk(
  `/chat/create`,
  async (formData: FormData) => {
    const response = await authorizeAxiosInstance.post(
      `${API_ROOT}/chat/create`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return response.data.data;
  },
);

export const conversationSlice = createSlice({
  name: "conversations",
  initialState,
  reducers: {
    addConversation: (
      state,
      action: PayloadAction<{ conversation: Conversation; userId: string }>,
    ) => {
      const { conversation, userId } = action.payload;

      state.unshift({
        ...conversation,
        groupName: getConversationTitle(conversation, userId),
        groupAvatar: getConversationAvatar(conversation, userId),
        memberCount: getConversationMemberCount(conversation),
        lastMessage:
          conversation.lastMessage !== undefined
            ? conversation.lastMessage
            : null,
        unreadCount: "0",
        membershipStatus: conversation.membershipStatus || "ACTIVE",
        canSendMessage: conversation.canSendMessage ?? true,
      });
    },
    updateNewMessage: (
      state,
      action: PayloadAction<{ conversationId: string; lastMessage: Message }>,
    ) => {
      const { conversationId, lastMessage } = action.payload;

      const updatedConversation = state.find((c) => c.id === conversationId);
      if (!updatedConversation) return state;

      const newConversation = {
        ...updatedConversation,
        lastMessage,
        lastMessageAt: lastMessage.createdAt,
        lastMessageText: lastMessage.text || lastMessage.content || "",
        lastMessageSenderId: lastMessage.senderId,
        lastMessageSenderName:
          lastMessage.senderMember?.fullName ||
          lastMessage.senderMember?.username ||
          "",
        lastMessageSenderAvatar: lastMessage.senderMember?.avatar || null,
        updatedAt: lastMessage.createdAt,
      };

      return [newConversation, ...state.filter((c) => c.id !== conversationId)];
    },
    setConversationAccessState: (
      state,
      action: PayloadAction<{
        conversationId: string;
        membershipStatus: "ACTIVE" | "REMOVED" | "LEFT";
        canSendMessage: boolean;
      }>,
    ) => {
      const target = state.find((conversation) => {
        return conversation.id === action.payload.conversationId;
      });

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

      const existingIndex = state.findIndex(
        (item) => item.id === conversation.id,
      );

      const nextConversation: Conversation = {
        ...conversation,
        memberCount: getConversationMemberCount(conversation),
        membershipStatus:
          membershipStatus || conversation.membershipStatus || "ACTIVE",
        canSendMessage:
          canSendMessage ??
          conversation.canSendMessage ??
          membershipStatus !== "REMOVED",
      };

      if (existingIndex === -1) {
        state.unshift(nextConversation);
        return;
      }

      state[existingIndex] = {
        ...state[existingIndex],
        ...nextConversation,
      };
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
      const target = state.find((conversation) => {
        return conversation.id === action.payload.conversationId;
      });
      if (!target) return;

      target.members ||= [];

      const incomingById = new Map(
        (action.payload.members || []).map((member) => [member.userId, member]),
      );

      const existingIds = new Set(
        target.members.map((member) => member.userId),
      );
      let addedCount = 0;

      for (let index = 0; index < target.members.length; index += 1) {
        const existing = target.members[index];
        const incoming = incomingById.get(existing.userId);
        if (!incoming) continue;

        target.members[index] = {
          ...existing,
          ...incoming,
        };
      }

      for (const memberId of action.payload.memberIds) {
        const incoming = incomingById.get(memberId);

        if (existingIds.has(memberId)) {
          continue;
        }

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
        target.memberCount =
          (target.memberCount ?? target.members.length ?? 0) + addedCount;
      }
    },
    removeConversationMember: (
      state,
      action: PayloadAction<{
        conversationId: string;
        userId: string;
      }>,
    ) => {
      const target = state.find((conversation) => {
        return conversation.id === action.payload.conversationId;
      });
      if (!target) return;

      target.members ||= [];

      const beforeCount = target.members.length;

      target.members = target.members.filter(
        (member) => member.userId !== action.payload.userId,
      );

      const removedCount = beforeCount - target.members.length;
      if (removedCount > 0) {
        target.memberCount = Math.max(
          (target.memberCount ?? beforeCount) - removedCount,
          0,
        );
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
      const { conversationId } = action.payload;
      const conversation = state.find((c) => c.id === conversationId);
      if (!conversation) return state;
      if (conversation.unreadCount === "5+") return state;
      const newUnreadCount = Number(conversation.unreadCount) + 1;
      conversation.unreadCount = String(
        newUnreadCount > 5 ? "5+" : newUnreadCount,
      );
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
      .addCase(
        getConversations.fulfilled,
        (
          state: ConversationState,
          action: PayloadAction<{
            conversations: Conversation[];
            userId: string;
          }>,
        ) => {
          const { conversations, userId } = action.payload;
          const oldState = state || [];
          state = [
            ...oldState,
            ...(conversations?.map((c) => ({
              ...c,
              groupName: getConversationTitle(c, userId),
              groupAvatar: getConversationAvatar(c, userId),
              memberCount: getConversationMemberCount(c),
              lastMessage: c.lastMessage !== undefined ? c.lastMessage : null,
              membershipStatus: c.membershipStatus || "ACTIVE",
              canSendMessage: c.canSendMessage ?? true,
            })) as Conversation[]),
          ];
          return state;
        },
      )
      .addCase(
        createConversation.fulfilled,
        (state, action: PayloadAction<{ conversation: Conversation }>) => {
          const c = action.payload.conversation;
          state.unshift({
            ...c,
            lastMessage: c.lastMessage !== undefined ? c.lastMessage : null,
            memberCount: getConversationMemberCount(c),
          });
          toast.success("Conversation created successfully");
        },
      )
      .addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectConversation = createSelector(
  (state: RootState) => state.conversations,
  (conversations) => conversations,
);

export const selectConversationById = (
  state: {
    conversations: ConversationState;
  },
  conversationId: string,
) => {
  return state.conversations?.find((c) => c.id === conversationId);
};

export const selectMessagesByConversationId = (
  state: {
    conversations: ConversationState;
  },
  conversationId: string,
) => {
  const conversation = state.conversations?.find(
    (c) => c.id === conversationId,
  );
  return conversation ? conversation.lastMessage : null;
};

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
