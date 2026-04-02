import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";

/**
 * Typing Indicator State
 * Lưu trữ danh sách users đang gõ trong mỗi conversation
 * Format: { [conversationId]: Set<userId> }
 */
export interface TypingIndicatorState {
  typingUsers: Record<string, string[]>;
}

const initialState: TypingIndicatorState = {
  typingUsers: {},
};

export const typingIndicatorSlice = createSlice({
  name: "typingIndicator",
  initialState,
  reducers: {
    /**
     * Thêm user vào danh sách typing của conversation
     */
    addTypingUser: (
      state,
      action: PayloadAction<{ conversationId: string; userId: string }>,
    ) => {
      const { conversationId, userId } = action.payload;
      if (!state.typingUsers[conversationId]) {
        state.typingUsers[conversationId] = [];
      }
      if (!state.typingUsers[conversationId].includes(userId)) {
        state.typingUsers[conversationId].push(userId);
      }
    },

    /**
     * Xóa user khỏi danh sách typing của conversation
     */
    removeTypingUser: (
      state,
      action: PayloadAction<{ conversationId: string; userId: string }>,
    ) => {
      const { conversationId, userId } = action.payload;
      if (!state.typingUsers[conversationId]) return;

      state.typingUsers[conversationId] = state.typingUsers[
        conversationId
      ].filter((id) => id !== userId);

      // Xóa entry nếu không còn user nào đang gõ
      if (state.typingUsers[conversationId].length === 0) {
        delete state.typingUsers[conversationId];
      }
    },

    /**
     * Xóa tất cả typing users của 1 conversation
     */
    clearTypingUsers: (
      state,
      action: PayloadAction<string>, // conversationId
    ) => {
      delete state.typingUsers[action.payload];
    },
  },
});

export const { addTypingUser, removeTypingUser, clearTypingUsers } =
  typingIndicatorSlice.actions;

// Selector
export const selectTypingUsersInConversation = (
  state: RootState,
  conversationId: string,
) => {
  const typingState = state.typingIndicator as TypingIndicatorState;
  const users = typingState.typingUsers[conversationId];
  return users ? [...users] : [];
};

export default typingIndicatorSlice.reducer;
