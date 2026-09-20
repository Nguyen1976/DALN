import { createConversationAPI, getConversationsAPI } from "@/apis/chat";
import {
  createAsyncThunk,
  createSelector,
  createSlice,
} from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import type { Message } from "./messageSlice";
import { MessageMapper } from "@/utils/messageMapper";
import { logoutAPI } from "./userSlice";
import { displayNameOf } from "@/utils/displayName";

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
  unreadCount: number;
  unreadMentionCount: number;
  lastMentionMessageId: string | null;
  membershipStatus: "ACTIVE" | "REMOVED" | "LEFT";
  canSendMessage: boolean;
  memberCount: number;
  /**
   * Id đối phương của hội thoại DIRECT, phi chuẩn hoá từ backend.
   * Danh sách hội thoại không còn kèm `members` (truy vấn đó đắt tuyến tính
   * theo số thành viên), nên đây là nguồn duy nhất để biết đối phương là ai
   * ở màn danh sách.
   */
  peerUserId: string | null;
  createdAt: string;
  updatedAt: string;
  members?: ConversationMember[];
  lastMessageId?: string | null;
  lastMessageAt?: string | null;
  lastMessageText?: string;
  lastMessageSenderId?: string | null;
  lastMessageSenderName?: string | null;
  lastMessageSenderAvatar?: string | null;
}

export type ConversationState = Conversation[];

const initialState: ConversationState = [];

/**
 * The newer copy wins field by field. List rows come without `members`, so a
 * list refresh keeps the members an opened conversation already has.
 */
const mergeConversation = (
  existing: Conversation,
  incoming: Conversation,
): Conversation => ({ ...existing, ...incoming });

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
  ({ limit, cursor }: { limit: number; cursor: string | null }) =>
    getConversationsAPI(limit, cursor),
);

export const createConversation = createAsyncThunk(
  `/chat/create`,
  (formData: FormData) => createConversationAPI(formData),
);

export const conversationSlice = createSlice({
  name: "conversations",
  initialState,
  reducers: {
    addConversation: (
      state,
      action: PayloadAction<{ conversation: Conversation }>,
    ) => {
      upsertConversation(state, action.payload.conversation);
    },
    updateNewMessage: (
      state,
      action: PayloadAction<{ conversationId: string; lastMessage: Message }>,
    ) => {
      const { conversationId, lastMessage } = action.payload;
      const target = state.find(
        (conversation) => conversation.id === conversationId,
      );
      if (!target) return;

      const preview = MessageMapper.previewText(lastMessage);
      const updated: Conversation = {
        ...target,
        lastMessageId: lastMessage.id,
        lastMessageAt: lastMessage.createdAt || target.lastMessageAt,
        lastMessageText: preview,
        lastMessageSenderId: lastMessage.senderId,
        lastMessageSenderName: lastMessage.senderMember
          ? displayNameOf(lastMessage.senderMember)
          : null,
        lastMessageSenderAvatar: lastMessage.senderMember?.avatar || null,
        updatedAt: lastMessage.createdAt || target.updatedAt,
      };

      const rest = state.filter(
        (conversation) => conversation.id !== conversationId,
      );
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
      action: PayloadAction<{ conversation: Conversation }>,
    ) => {
      upsertConversation(state, action.payload.conversation);
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
      const existingIds = new Set(
        target.members.map((member) => member.userId),
      );
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
      if (conversation) conversation.unreadCount += 1;
    },
    markConversationRead: (
      state,
      action: PayloadAction<{ conversationId: string }>,
    ) => {
      const target = state.find(
        (conversation) => conversation.id === action.payload.conversationId,
      );
      if (!target) return;
      target.unreadCount = 0;
    },
    markConversationMention: (
      state,
      action: PayloadAction<{ conversationId: string; messageId: string }>,
    ) => {
      const target = state.find(
        (item) => item.id === action.payload.conversationId,
      );
      if (!target) return;
      target.unreadMentionCount += 1;
      target.lastMentionMessageId = action.payload.messageId;
    },
    clearConversationMentions: (
      state,
      action: PayloadAction<{ conversationId: string }>,
    ) => {
      const target = state.find(
        (item) => item.id === action.payload.conversationId,
      );
      if (!target) return;
      target.unreadMentionCount = 0;
      target.lastMentionMessageId = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getConversations.fulfilled, (state, action) => {
        for (const conversation of action.payload.items) {
          const index = state.findIndex((item) => item.id === conversation.id);
          if (index === -1) {
            state.push(conversation);
            continue;
          }
          state[index] = mergeConversation(state[index], conversation);
        }
      })
      // The creator also gets `chat.new_conversation`; upserting twice is fine.
      .addCase(createConversation.fulfilled, (state, action) => {
        upsertConversation(state, action.payload);
      })
      .addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectConversation = (state: RootState) => state.conversations;

export const selectConversationById = createSelector(
  [
    selectConversation,
    (_state: RootState, conversationId: string) => conversationId,
  ],
  (conversations, conversationId) =>
    conversations.find((conversation) => conversation.id === conversationId),
);

/**
 * The other person in a direct conversation. `peerUserId` comes with every
 * conversation; `members` only covers rows stored before it existed.
 */
export const peerIdOf = (
  conversation: Pick<Conversation, "type" | "peerUserId" | "members">,
  selfId: string,
): string | undefined =>
  conversation.type === "DIRECT"
    ? (conversation.peerUserId ??
      conversation.members?.find((member) => member.userId !== selfId)?.userId)
    : undefined;

/** The direct conversation with `userId` among these, if there is one. */
export const findDirectConversationWith = (
  conversations: Conversation[],
  userId: string,
) =>
  conversations.find(
    (conversation) =>
      conversation.type === "DIRECT" &&
      (conversation.peerUserId === userId ||
        conversation.members?.some((member) => member.userId === userId)),
  );

export const selectDirectConversationWith = (
  state: RootState,
  userId: string | null | undefined,
) =>
  userId ? findDirectConversationWith(state.conversations, userId) : undefined;

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
  markConversationMention,
  clearConversationMentions,
} = conversationSlice.actions;

export default conversationSlice.reducer;
