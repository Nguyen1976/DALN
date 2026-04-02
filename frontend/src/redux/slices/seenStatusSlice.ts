import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";

/**
 * Seen Status - Trạng thái xem tin nhắn
 * Lưu trữ những users nào đã xem tin nhắn nào
 */
export interface SeenStatus {
  messageId: string;
  userId: string;
  username?: string;
  avatar?: string;
  seenAt?: string;
}

export interface ConversationSeenStatus {
  [messageId: string]: SeenStatus[];
}

export interface SeenStatusState {
  seenByUser: Record<string, ConversationSeenStatus>; // { [conversationId]: { [messageId]: SeenStatus[] } }
}

const initialState: SeenStatusState = {
  seenByUser: {},
};

export const seenStatusSlice = createSlice({
  name: "seenStatus",
  initialState,
  reducers: {
    /**
     * Cập nhật trạng thái xem cho user trong conversation
     * Khi user nào đó đã xem tin nhắn, update bộ nhớ
     */
    updateSeenStatus: (
      state,
      action: PayloadAction<{
        conversationId: string;
        userId: string;
        lastReadMessageId: string;
        username?: string;
        avatar?: string;
      }>,
    ) => {
      const { conversationId, userId, lastReadMessageId, username, avatar } =
        action.payload;

      if (!state.seenByUser[conversationId]) {
        state.seenByUser[conversationId] = {};
      }

      // Mỗi user chỉ nên xuất hiện ở tin nhắn mới nhất đã đọc.
      Object.keys(state.seenByUser[conversationId]).forEach((messageId) => {
        state.seenByUser[conversationId][messageId] = state.seenByUser[
          conversationId
        ][messageId].filter((s) => s.userId !== userId);

        if (state.seenByUser[conversationId][messageId].length === 0) {
          delete state.seenByUser[conversationId][messageId];
        }
      });

      // Cập nhật thông tin đã xem cho message đó
      if (!state.seenByUser[conversationId][lastReadMessageId]) {
        state.seenByUser[conversationId][lastReadMessageId] = [];
      }

      const existingIndex = state.seenByUser[conversationId][
        lastReadMessageId
      ].findIndex((s) => s.userId === userId);

      if (existingIndex >= 0) {
        // User này đã xem rồi, update thời gian
        state.seenByUser[conversationId][lastReadMessageId][
          existingIndex
        ].seenAt = new Date().toISOString();
      } else {
        // Thêm user mới vào danh sách seen
        state.seenByUser[conversationId][lastReadMessageId].push({
          messageId: lastReadMessageId,
          userId,
          username,
          avatar,
          seenAt: new Date().toISOString(),
        });
      }
    },

    /**
     * Xóa hết seen status của 1 conversation khi reload
     */
    clearConversationSeenStatus: (
      state,
      action: PayloadAction<string>, // conversationId
    ) => {
      delete state.seenByUser[action.payload];
    },

    /**
     * Xóa hết seen status
     */
    clearAllSeenStatus: (state) => {
      state.seenByUser = {};
    },
  },
});

export const {
  updateSeenStatus,
  clearConversationSeenStatus,
  clearAllSeenStatus,
} = seenStatusSlice.actions;

// Selector: Lấy danh sách users đã xem 1 tin nhắn
export const selectSeenUsersForMessage = (
  state: RootState,
  conversationId: string,
  messageId: string,
) => {
  const seenState = state.seenStatus as SeenStatusState;
  if (
    !seenState.seenByUser[conversationId] ||
    !seenState.seenByUser[conversationId][messageId]
  ) {
    return [];
  }
  return seenState.seenByUser[conversationId][messageId];
};

export default seenStatusSlice.reducer;
