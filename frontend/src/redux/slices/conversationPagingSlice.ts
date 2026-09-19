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
  /** Where the next page starts, as the server said; null once complete. */
  nextCursor: string | null;
}

const initialState: ConversationPagingState = {
  loaded: false,
  nextCursor: null,
};

export const conversationPagingSlice = createSlice({
  name: "conversationPaging",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(getConversations.fulfilled, (state, action) => {
      state.loaded = true;
      state.nextCursor = action.payload.nextCursor;
    });
    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectConversationsLoaded = (state: RootState) =>
  state.conversationPaging.loaded;
export const selectConversationsNextCursor = (state: RootState) =>
  state.conversationPaging.nextCursor;
/** More to page in: the first page has not come yet, or it had a cursor. */
export const selectConversationsHasMore = (state: RootState) =>
  !state.conversationPaging.loaded || state.conversationPaging.nextCursor !== null;

export default conversationPagingSlice.reducer;
