import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";

/** Per conversation: how far each other member has read (userId → seq). */
export type ConversationReadMarks = Record<string, number>;

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
    /** Someone read up to `seq`. Marks only move forward: reads arrive out of order. */
    updateSeenStatus: (
      state,
      action: PayloadAction<{
        conversationId: string;
        userId: string;
        seq: number;
      }>,
    ) => {
      const { conversationId, userId, seq } = action.payload;
      const marks = (state.readBy[conversationId] ??= {});
      marks[userId] = Math.max(marks[userId] ?? 0, seq);
    },

    /** Read marks as the members list reports them, after a page load. */
    hydrateSeenStatusFromMembers: (
      state,
      action: PayloadAction<{
        conversationId: string;
        currentUserId: string;
        members: Array<{ userId: string; lastReadSeq?: number | null }>;
      }>,
    ) => {
      const { conversationId, currentUserId, members } = action.payload;
      const marks = (state.readBy[conversationId] ??= {});
      for (const { userId, lastReadSeq } of members) {
        if (userId !== currentUserId && lastReadSeq) {
          marks[userId] = Math.max(marks[userId] ?? 0, lastReadSeq);
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
