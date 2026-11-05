import { getMessagesAfterAPI, getMessagesAPI } from "@/apis/chat";
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
  /**
   * Position in the conversation, set by the server (null on an optimistic
   * copy until its ack). The thread is ordered by it, and a jump in it means
   * a message was missed.
   */
  seq?: number | null;
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
    /** Tệp/ảnh đầu tiên của tin gốc, để quote vẽ được thumbnail thay vì tên file. */
    attachmentName?: string;
    attachmentType?: "IMAGE" | "VIDEO" | "FILE";
    attachmentUrl?: string;
    attachmentMimeType?: string;
    attachmentThumbnailUrl?: string;
  };
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
  /** A resync (`syncAfter`) is in flight for this conversation. */
  syncing: Record<string, boolean>;
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
  syncing: {},
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
 * Newest-first order, a total order so every merge agrees with every other.
 *
 * Messages the server has numbered come by `seq`, the conversation's own
 * order. Our own messages still waiting for their ack have no `seq` yet and
 * are the newest of all — they were just sent — kept in the order we sent
 * them. Timestamps are only a tie-breaker among those: the sender's clock is
 * not the server's.
 *
 * The store keeps messages newest-first and `selectMessage` reverses them for
 * display; sorting on merge keeps one true order whichever channel (page,
 * socket, resync) delivered a message first.
 */
function compareNewestFirst(a: Message, b: Message): number {
  const aNumbered = typeof a.seq === "number";
  const bNumbered = typeof b.seq === "number";
  if (aNumbered && bNumbered) return (b.seq as number) - (a.seq as number);
  if (aNumbered !== bNumbered) return aNumbered ? 1 : -1;
  const at = new Date(a.createdAt ?? 0).getTime();
  const bt = new Date(b.createdAt ?? 0).getTime();
  if (at !== bt) return bt - at;
  return String(b.id).localeCompare(String(a.id));
}

/** The highest seq loaded for a conversation; null when nothing is loaded. */
export function maxSeqOf(messages: Message[] | undefined): number | null {
  let max: number | null = null;
  for (const message of messages ?? []) {
    if (typeof message.seq === "number" && (max === null || message.seq > max)) {
      max = message.seq;
    }
  }
  return max;
}

/** Same message from two channels: the server id, or our clientMessageId. */
const sameMessage = (a: Message, b: Message) =>
  a.id === b.id ||
  (Boolean(a.clientMessageId) && a.clientMessageId === b.clientMessageId);

/** At most this many resync pages before dropping the cache instead. */
const SYNC_PAGES = 2;
const SYNC_LIMIT = 50;

/**
 * What came after the newest message we have, oldest first. Called when a
 * message arrives whose seq skips ahead (one was missed), and for the open
 * conversation after a reconnect. Past two pages the gap is too wide to
 * patch: the cache is dropped and the first page reloads instead, which also
 * keeps a long absence from bursting the API rate limit.
 */
export const syncAfter = createAsyncThunk(
  `/chat/messages/sync`,
  async (conversationId: string, { getState }) => {
    const state = getState() as RootState;
    const after = maxSeqOf(state.message.messages[conversationId]);
    if (after === null) return { conversationId, items: [], reset: false };
    const items: Message[] = [];
    let cursor = after;
    for (let page = 0; page < SYNC_PAGES; page++) {
      const result = await getMessagesAfterAPI(conversationId, SYNC_LIMIT, cursor);
      items.push(...result.items);
      const last = result.items[result.items.length - 1];
      if (!result.hasMore || typeof last?.seq !== "number") {
        return { conversationId, items, reset: false };
      }
      cursor = last.seq;
    }
    return { conversationId, items: [], reset: true };
  },
  {
    // One resync per conversation at a time; a burst of gaps shares it.
    condition: (conversationId, { getState }) =>
      !(getState() as RootState).message.syncing[conversationId],
  },
);

/** Keep only our own messages still on their way; the rest reloads on open. */
function dropCache(state: MessageState, conversationId: string) {
  const unsent = (state.messages[conversationId] ?? []).filter(
    (m) => m.status === "pending" || m.status === "failed",
  );
  if (unsent.length) state.messages[conversationId] = unsent;
  else delete state.messages[conversationId];
  delete state.pagination[conversationId];
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
        currentMessages.sort(compareNewestFirst);
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
        // It has its seq now: move it from the pending tail to its place.
        currentMessages.sort(compareNewestFirst);
      }
    },
    /**
     * After a reconnect: what we hold for conversations other than the open
     * one may be missing messages. Drop it (our unsent messages stay) so the
     * first page reloads when they are opened — cheaper than resyncing all.
     */
    dropOtherConversations: (state, action: PayloadAction<string | null>) => {
      for (const conversationId of Object.keys(state.messages)) {
        if (conversationId !== action.payload) dropCache(state, conversationId);
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

    builder
      .addCase(syncAfter.pending, (state, action) => {
        state.syncing[action.meta.arg] = true;
      })
      .addCase(syncAfter.rejected, (state, action) => {
        delete state.syncing[action.meta.arg];
      })
      .addCase(syncAfter.fulfilled, (state, action) => {
        const { conversationId, items, reset } = action.payload;
        delete state.syncing[conversationId];
        if (reset) {
          dropCache(state, conversationId);
          return;
        }
        const current = state.messages[conversationId];
        if (!current) return;
        for (const message of items) {
          const index = current.findIndex((m) => sameMessage(m, message));
          if (index === -1) current.push(message);
          else current[index] = { ...current[index], ...message, status: "sent" };
        }
        current.sort(compareNewestFirst);
      });

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
  dropOtherConversations,
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
