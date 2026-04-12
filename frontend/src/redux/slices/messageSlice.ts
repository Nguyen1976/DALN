import authorizeAxiosInstance from "@/utils/authorizeAxios";
import { API_ROOT } from "@/utils/constant";
import {
  createAsyncThunk,
  createSelector,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { logoutAPI } from "./userSlice";

export interface SenderMember {
  userId: string;
  username: string;
  fullName: string;
  avatar: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  type?: "TEXT" | "IMAGE" | "VIDEO" | "FILE";
  content?: string;
  clientMessageId?: string;
  replyToMessageId?: string | undefined;
  isDeleted?: boolean;
  isRevoked?: boolean;
  deleteType?: string;
  createdAt?: string;
  senderMember?: SenderMember | undefined;
  medias?: {
    id?: string;
    mediaType: "IMAGE" | "VIDEO" | "FILE";
    objectKey?: string;
    url: string;
    mimeType: string;
    size: string;
    width?: number;
    height?: number;
    duration?: number;
    thumbnailUrl?: string;
    sortOrder?: number;
  }[];
  status?: "sent" | "pending" | "failed";
  tempMessageId?: string;
}

export interface MessageState {
  messages: Record<string, Message[]>;
  pagination: Record<
    string,
    {
      oldestCursor: string | null;
      hasMore: boolean;
    }
  >;
}

const initialState: MessageState = {
  messages: {},
  pagination: {},
};

export const getMessages = createAsyncThunk(
  `/chat/messages`,
  async ({
    conversationId,
    limit = 20,
    cursor,
  }: {
    conversationId: string;
    limit?: number;
    cursor?: string | null;
  }) => {
    const response = await authorizeAxiosInstance.get(
      `${API_ROOT}/chat/messages/${conversationId}?limit=${limit}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`,
    );
    return {
      ...response.data.data,
      conversationId,
      limit,
      cursor: cursor || null,
    };
  },
);

export const messageSlice = createSlice({
  name: "message",
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<Message>) => {
      const message = action.payload;
      if (!state.messages[message.conversationId]) {
        state.messages[message.conversationId] = [];
      }
      const currentMessages = state.messages[message.conversationId];
      //check trong message có message nào tồn tại id giống với tempId k
      const index = currentMessages.findIndex(
        (m) =>
          m.id === message.id ||
          m.id === message.tempMessageId ||
          (message.clientMessageId &&
            m.clientMessageId &&
            m.clientMessageId === message.clientMessageId),
      );
      if (index !== -1) {
        //messsage của mình
        currentMessages[index] = {
          ...currentMessages[index],
          ...message,
          status: "sent",
        };
        return;
      } else {
        //message của họ
        state.messages[message.conversationId].unshift(message);
      }
    },
    ackMessage: (
      state,
      action: PayloadAction<{
        conversationId: string;
        clientMessageId?: string;
        serverMessageId: string;
        message?: Message;
      }>,
    ) => {
      const { conversationId, clientMessageId, serverMessageId, message } =
        action.payload;
      const currentMessages = state.messages[conversationId] || [];

      const index = currentMessages.findIndex(
        (m) =>
          (clientMessageId && m.clientMessageId === clientMessageId) ||
          m.id === clientMessageId,
      );

      if (index !== -1) {
        currentMessages[index] = {
          ...currentMessages[index],
          ...(message || {}),
          id: serverMessageId,
          status: "sent",
          tempMessageId: undefined,
        };
      }
    },
    failMessage: (
      state,
      action: PayloadAction<{
        conversationId: string;
        clientMessageId?: string;
      }>,
    ) => {
      const { conversationId, clientMessageId } = action.payload;
      const currentMessages = state.messages[conversationId] || [];
      const index = currentMessages.findIndex(
        (m) =>
          m.id === clientMessageId ||
          (clientMessageId && m.clientMessageId === clientMessageId),
      );
      if (index !== -1) {
        currentMessages[index] = {
          ...currentMessages[index],
          status: "failed",
        };
      }
    },
    revokeMessage: (
      state,
      action: PayloadAction<{
        conversationId: string;
        messageId: string;
      }>,
    ) => {
      const { conversationId, messageId } = action.payload;
      const currentMessages = state.messages[conversationId] || [];
      const index = currentMessages.findIndex(
        (message) =>
          message.id === messageId || message.clientMessageId === messageId,
      );

      if (index !== -1) {
        currentMessages[index] = {
          ...currentMessages[index],
          isRevoked: true,
          content: "",
          text: "",
          medias: [],
        };
      }
    },
    deleteMessageForMe: (
      state,
      action: PayloadAction<{
        conversationId: string;
        messageId: string;
      }>,
    ) => {
      const { conversationId, messageId } = action.payload;
      const currentMessages = state.messages[conversationId] || [];
      state.messages[conversationId] = currentMessages.filter(
        (message) =>
          message.id !== messageId && message.clientMessageId !== messageId,
      );
    },
    clearConversationMessages: (
      state,
      action: PayloadAction<{ conversationId: string }>,
    ) => {
      delete state.messages[action.payload.conversationId];
      delete state.pagination[action.payload.conversationId];
    },
  },
  extraReducers: (builder) => {
    builder.addCase(
      getMessages.fulfilled,
      (
        state,
        action: PayloadAction<{
          messages: Message[];
          conversationId: string;
          limit: number;
          cursor: string | null;
        }>,
      ) => {
        const { messages, conversationId, limit, cursor } = action.payload;
        const current = state.messages[conversationId] || [];

        const mergedSource = cursor
          ? [...current, ...messages]
          : [...messages, ...current];

        const merged = mergedSource.filter((message, index, array) => {
          return (
            index ===
            array.findIndex(
              (item) =>
                item.id === message.id ||
                (Boolean(item.clientMessageId) &&
                  item.clientMessageId === message.clientMessageId),
            )
          );
        });

        state.messages[conversationId] = merged;

        const oldestCursor =
          merged.length > 0
            ? (merged[merged.length - 1]?.createdAt ?? null)
            : null;

        state.pagination[conversationId] = {
          oldestCursor,
          hasMore: messages.length >= limit,
        };
      },
    );

    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectMessage = createSelector(
  [
    (state: RootState) => state.message.messages,
    (_: RootState, conversationId?: string) => conversationId,
  ],
  (messagesMap, conversationId) => {
    if (!conversationId) return [];
    const messages = messagesMap[conversationId];
    if (!messages) return [];

    return [...messages].reverse();
  },
);

export const selectMessagePagination = createSelector(
  [
    (state: RootState) => state.message.pagination,
    (_: RootState, conversationId?: string) => conversationId,
  ],
  (paginationMap, conversationId) => {
    if (!conversationId) {
      return {
        oldestCursor: null,
        hasMore: false,
      };
    }

    return (
      paginationMap[conversationId] || {
        oldestCursor: null,
        hasMore: false,
      }
    );
  },
);

export const {
  addMessage,
  ackMessage,
  failMessage,
  revokeMessage,
  deleteMessageForMe,
  clearConversationMessages,
} = messageSlice.actions;
export default messageSlice.reducer;
