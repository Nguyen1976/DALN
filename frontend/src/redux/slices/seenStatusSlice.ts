import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";

/** Per conversation: how far each other member has read (userId → messageId). */
export type ConversationReadMarks = Record<string, string>;

export interface SeenStatusState {
  readBy: Record<string, ConversationReadMarks>;
}

const initialState: SeenStatusState = {
  readBy: {},
};

export const seenStatusSlice = createSlice({
  name: "seenStatus",
  initialState,
  reducers: {
    /** Someone read up to `lastReadMessageId`. */
    updateSeenStatus: (
      state,
      action: PayloadAction<{
        conversationId: string;
        userId: string;
        lastReadMessageId: string;
      }>,
    ) => {
      const { conversationId, userId, lastReadMessageId } = action.payload;
      (state.readBy[conversationId] ??= {})[userId] = lastReadMessageId;
    },

    /** Read marks as the members list reports them, after a page load. */
    hydrateSeenStatusFromMembers: (
      state,
      action: PayloadAction<{
        conversationId: string;
        currentUserId: string;
        members: Array<{ userId: string; lastReadMessageId?: string | null }>;
      }>,
    ) => {
      const { conversationId, currentUserId, members } = action.payload;
      const marks = (state.readBy[conversationId] ??= {});
      for (const { userId, lastReadMessageId } of members) {
        if (userId !== currentUserId && lastReadMessageId) {
          marks[userId] = lastReadMessageId;
        }
      }
    },

    clearConversationSeenStatus: (state, action: PayloadAction<string>) => {
      delete state.readBy[action.payload];
    },
  },
});

export const {
  updateSeenStatus,
  hydrateSeenStatusFromMembers,
  clearConversationSeenStatus,
} = seenStatusSlice.actions;

const NO_MARKS: ConversationReadMarks = {};

export const selectConversationSeenStatus = (
  state: RootState,
  conversationId: string,
) => state.seenStatus.readBy[conversationId] ?? NO_MARKS;

export default seenStatusSlice.reducer;
