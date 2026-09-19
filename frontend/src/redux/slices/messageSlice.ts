import { getMessagesAPI } from "@/apis/chat";
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

export interface PollOption {
  id: string;
  text: string;
  count: number;
}

export interface PollData {
  id: string;
  question: string;
  isMultipleChoice: boolean;
  isClosed: boolean;
  closedAt: string | null;
  options: PollOption[];
  /** People who have voted (one vote can pick several options). */
  totalVoters: number;
  /** Your own vote; only on copies the server made for you. */
  myOptionIds?: string[];
}

/** Dữ liệu tin tổng kết cuộc gọi (type=CALL) để render thẻ + nút gọi lại. */
export interface CallInfo {
  scope: "direct" | "group";
  callType: "audio" | "video";
  /** COMPLETED | ENDED | MISSED | REJECTED | UNREACHABLE ... */
  outcome?: string;
  durationSeconds?: number;
  participantCount?: number;
  startedBy?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type?: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "POLL" | "CALL";
  /** Với type=CALL: dữ liệu để render thẻ cuộc gọi + nút Gọi lại/Tham gia lại. */
  callInfo?: CallInfo;
  /** Nhãn đúng như trong text cho từng lượt nhắc — server resolve, client chỉ tô. */
  mentions?: ({ userId: string; label: string } | { all: true; label: string })[];
  mentionUserIds?: string[];
  clientMessageId?: string;
  replyToMessageId?: string;
  /** Tin nhắn được trích dẫn, đã được máy chủ dựng sẵn để hiển thị. */
  replyTo?: {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    type: string;
    isRevoked: boolean;
    attachmentName?: string;
  };
  isDeleted?: boolean;
  isRevoked?: boolean;
  /** Tin nhắn do hệ thống ghi, không phải nội dung người dùng gõ. */
  isSystem?: boolean;
  createdAt?: string;
  senderMember?: SenderMember;
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
    fileName?: string;
    sortOrder?: number;
  }[];
  poll?: PollData;
  status?: "sent" | "pending" | "failed";
}

export interface MessageState {
  /**
   * Half-written message per conversation.
   *
   * Kept in the store, not in the composer: leaving a thread unmounts
   * ChatWindow, so a component-local draft died the moment the user clicked
   * away. The `message` slice is excluded from persistence, so drafts stay in
   * memory only and are dropped on logout with everything else.
   */
  drafts: Record<string, string>;
  messages: Record<string, Message[]>;
  pagination: Record<
    string,
    {
      /** Where older messages continue, as the server said; null at the start. */
      nextCursor: string | null;
      hasMore: boolean;
    }
  >;
}

const initialState: MessageState = {
  drafts: {},
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
    const { items, nextCursor } = await getMessagesAPI(
      conversationId,
      limit,
      cursor ?? null,
    );
    return { messages: items, nextCursor, conversationId, cursor: cursor ?? null };
  },
);

/**
 * Newest-first order, matching the server's (createdAt desc, id desc).
 *
 * The store keeps messages newest-first and `selectMessage` reverses them for
 * display. Merging a page from the server with a message that had already
 * arrived over the socket used to be a plain concatenation, so the newest
 * message could end up at the tail: it rendered at the top of the thread, and
 * "the last message" — used for the read receipt and for scrolling — pointed at
 * an older one. Sorting on merge keeps one true order regardless of which
 * channel delivered a message first.
 */
function compareNewestFirst(a: Message, b: Message): number {
  const at = new Date(a.createdAt ?? 0).getTime();
  const bt = new Date(b.createdAt ?? 0).getTime();
  if (at !== bt) return bt - at;
  return String(b.id).localeCompare(String(a.id));
}

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
        // Chèn đúng vị trí theo thứ tự thời gian: tin đến trễ qua socket không
        // được nhảy lên đầu và đẩy tin mới hơn xuống dưới.
        currentMessages.push(message);
        currentMessages.sort(compareNewestFirst);
      }
    },
    /** The server saved one of ours: swap the optimistic copy for it. */
    ackMessage: (
      state,
      action: PayloadAction<{ clientMessageId?: string; message: Message }>,
    ) => {
      const { clientMessageId, message } = action.payload;
      if (!clientMessageId) return;
      const currentMessages = state.messages[message.conversationId] || [];
      const index = currentMessages.findIndex(
        (m) => m.clientMessageId === clientMessageId,
      );
      if (index !== -1) {
        currentMessages[index] = {
          ...currentMessages[index],
          ...message,
          status: "sent",
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
      // Only a message still waiting can fail. The ack-timeout watchdog fires
      // for every send; without this guard it would flip messages that had
      // already been confirmed into "chưa gửi được" twelve seconds later.
      if (index !== -1 && currentMessages[index].status === "pending") {
        currentMessages[index] = {
          ...currentMessages[index],
          status: "failed",
        };
      }
    },
    /** Đưa một tin nhắn thất bại trở lại hàng chờ trước khi gửi lại. */
    retryMessage: (
      state,
      action: PayloadAction<{
        conversationId: string;
        clientMessageId: string;
      }>,
    ) => {
      const { conversationId, clientMessageId } = action.payload;
      const list = state.messages[conversationId] || [];
      const index = list.findIndex(
        (m) => m.id === clientMessageId || m.clientMessageId === clientMessageId,
      );
      if (index !== -1) {
        list[index] = { ...list[index], status: "pending" };
      }
    },

    /** Bỏ hẳn một tin nhắn chưa gửi được khỏi hàng chờ. */
    discardMessage: (
      state,
      action: PayloadAction<{
        conversationId: string;
        clientMessageId: string;
      }>,
    ) => {
      const { conversationId, clientMessageId } = action.payload;
      const list = state.messages[conversationId] || [];
      state.messages[conversationId] = list.filter(
        (m) => m.id !== clientMessageId && m.clientMessageId !== clientMessageId,
      );
    },

    setDraft: (
      state,
      action: PayloadAction<{ conversationId: string; text: string }>,
    ) => {
      const { conversationId, text } = action.payload;
      if (text) state.drafts[conversationId] = text;
      else delete state.drafts[conversationId];
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
    /**
     * A poll's new state. Events for everyone do not carry your own vote, so
     * the one already known is kept unless the update brings one.
     */
    updateMessagePoll: (
      state,
      action: PayloadAction<{
        conversationId: string;
        messageId: string;
        poll: PollData;
      }>,
    ) => {
      const { conversationId, messageId, poll } = action.payload;
      const currentMessages = state.messages[conversationId] || [];
      const target = currentMessages.find(
        (message) =>
          message.id === messageId || message.clientMessageId === messageId,
      );

      if (!target) return;

      target.poll = { ...target.poll, ...poll };
      target.type = "POLL";
      target.content = poll.question;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(
      getMessages.fulfilled,
      (state, action) => {
        const { messages, nextCursor, conversationId, cursor } = action.payload;
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

        merged.sort(compareNewestFirst);
        state.messages[conversationId] = merged;

        state.pagination[conversationId] = {
          nextCursor,
          hasMore: nextCursor !== null,
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

export const selectDraft = (state: RootState, conversationId?: string) =>
  conversationId ? (state.message.drafts[conversationId] ?? "") : "";

export const selectMessagePagination = createSelector(
  [
    (state: RootState) => state.message.pagination,
    (_: RootState, conversationId?: string) => conversationId,
  ],
  (paginationMap, conversationId) => {
    const page = conversationId ? paginationMap[conversationId] : undefined;
    // `loaded`: the first page has been fetched, even if it held nothing —
    // an empty thread used to be refetched every time it was opened.
    return page
      ? { ...page, loaded: true }
      : { nextCursor: null, hasMore: false, loaded: false };
  },
);

export const {
  addMessage,
  ackMessage,
  failMessage,
  setDraft,
  retryMessage,
  discardMessage,
  revokeMessage,
  deleteMessageForMe,
  clearConversationMessages,
  updateMessagePoll,
} = messageSlice.actions;
export default messageSlice.reducer;
