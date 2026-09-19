import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { getMyRecommendationsAPI, type SuggestedFriend } from "@/apis";
import type { RootState } from "../store";
import { addNotification } from "./notificationSlice";
import { logoutAPI } from "./userSlice";

/**
 * Friend suggestions, kept across visits to the tab. The server rebuilds the
 * list once a day, so it is fetched once per session and refreshed only when
 * something changes it (an accepted request) or the window regains focus.
 */
interface RecommendationState {
  items: SuggestedFriend[];
  loaded: boolean;
  /** A request was accepted since: the list is refetched when next shown. */
  stale: boolean;
  status: "idle" | "loading" | "error";
  /** When the list last arrived, to throttle focus refreshes. */
  fetchedAt: number;
  /** Candidates the person already sent a request to this session. */
  sentIds: string[];
}

const initialState: RecommendationState = {
  items: [],
  loaded: false,
  stale: false,
  status: "idle",
  fetchedAt: 0,
  sentIds: [],
};

/** `ifOlderThan` (ms): skip the request when the list is fresher than that. */
export const fetchRecommendations = createAsyncThunk<
  SuggestedFriend[],
  { ifOlderThan?: number } | void
>(
  `/recommendation/me`,
  () => getMyRecommendationsAPI(),
  {
    condition: (options, { getState }) => {
      const { status, fetchedAt } = (getState() as RootState).recommendations;
      if (status === "loading") return false;
      const maxAge = options ? options.ifOlderThan : undefined;
      return !maxAge || Date.now() - fetchedAt >= maxAge;
    },
  },
);

export const recommendationSlice = createSlice({
  name: "recommendations",
  initialState,
  reducers: {
    markRecommendationSent: (state, action: { payload: string }) => {
      if (!state.sentIds.includes(action.payload)) {
        state.sentIds.push(action.payload);
      }
    },
    unmarkRecommendationSent: (state, action: { payload: string }) => {
      state.sentIds = state.sentIds.filter((id) => id !== action.payload);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchRecommendations.pending, (state) => {
      state.status = "loading";
    });
    builder.addCase(fetchRecommendations.fulfilled, (state, action) => {
      state.items = action.payload;
      state.loaded = true;
      state.stale = false;
      state.status = "idle";
      state.fetchedAt = Date.now();
    });
    builder.addCase(fetchRecommendations.rejected, (state) => {
      state.status = "error";
      state.loaded = true;
    });
    builder.addCase(addNotification, (state, action) => {
      if (action.payload.type === "FRIEND_REQUEST_ACCEPTED") state.stale = true;
    });
    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectRecommendations = (state: RootState) =>
  state.recommendations.items;
export const selectRecommendationsLoaded = (state: RootState) =>
  state.recommendations.loaded;
export const selectRecommendationsStale = (state: RootState) =>
  state.recommendations.stale;
export const selectRecommendationsStatus = (state: RootState) =>
  state.recommendations.status;
export const selectRecommendationSentIds = (state: RootState) =>
  state.recommendations.sentIds;

export const { markRecommendationSent, unmarkRecommendationSent } =
  recommendationSlice.actions;
export default recommendationSlice.reducer;
