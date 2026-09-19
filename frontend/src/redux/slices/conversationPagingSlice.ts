import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { getConversations } from "./conversationSlice";
import { logoutAPI } from "./userSlice";

/**
 * How far the conversation list has been paged. The list itself stays a plain
 * array in `conversations` (read in many places); this sits beside it so the
 * chat sidebar and the Groups tab, which both page it and both unmount on a
 * tab change, pick up where they left off instead of starting over.
 */
interface ConversationPagingState {
  /** The first page has arrived this session (possibly empty). */
  loaded: boolean;
  /** False once a page came back shorter than asked. */
  hasMore: boolean;
}

const initialState: ConversationPagingState = { loaded: false, hasMore: true };

export const conversationPagingSlice = createSlice({
  name: "conversationPaging",
  initialState,
  reducers: {
    /** Nothing left to page from (no conversation carries a timestamp). */
    markConversationsExhausted: (state) => {
      state.hasMore = false;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(getConversations.fulfilled, (state, action) => {
      state.loaded = true;
      state.hasMore = (action.payload?.length ?? 0) >= action.meta.arg.limit;
    });
    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectConversationsLoaded = (state: RootState) =>
  state.conversationPaging.loaded;
export const selectConversationsHasMore = (state: RootState) =>
  state.conversationPaging.hasMore;

export const { markConversationsExhausted } = conversationPagingSlice.actions;
export default conversationPagingSlice.reducer;
