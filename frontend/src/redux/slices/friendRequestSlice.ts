import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  getFriendRequestsAPI,
  type FriendRequestDirection,
  type FriendRequestListItem,
} from "@/apis";
import type { RootState } from "../store";
import { addNotification } from "./notificationSlice";
import { logoutAPI } from "./userSlice";

export const FRIEND_REQUESTS_PAGE_SIZE = 20;

interface RequestList {
  items: FriendRequestListItem[];
  page: number;
  hasMore: boolean;
  /** The first page has arrived this session. */
  loaded: boolean;
  /** Something changed on the server; refetch the next time it is shown. */
  stale: boolean;
  /** State of the first-page fetch (later pages report through the hook). */
  status: "idle" | "loading" | "error";
}

const emptyList: RequestList = {
  items: [],
  page: 0,
  hasMore: true,
  loaded: false,
  stale: false,
  status: "idle",
};

/**
 * Friend requests, received and sent, kept across visits to the tab. Each
 * list is fetched once and then only when marked stale: a friend-request
 * notification arriving, or the person acting on a request.
 */
interface FriendRequestState {
  /** The sub-tab last open ("Đã nhận" / "Đã gửi"). */
  direction: FriendRequestDirection;
  received: RequestList;
  sent: RequestList;
}

const initialState: FriendRequestState = {
  direction: "received",
  received: emptyList,
  sent: emptyList,
};

export const fetchFriendRequests = createAsyncThunk(
  `/friend-requests`,
  async ({
    direction,
    page,
  }: {
    direction: FriendRequestDirection;
    page: number;
  }) => ({
    direction,
    page,
    items: await getFriendRequestsAPI({
      limit: FRIEND_REQUESTS_PAGE_SIZE,
      page,
      direction,
    }),
  }),
);

export const friendRequestSlice = createSlice({
  name: "friendRequests",
  initialState,
  reducers: {
    setRequestDirection: (
      state,
      action: { payload: FriendRequestDirection },
    ) => {
      state.direction = action.payload;
    },
    markRequestsStale: (state, action: { payload: FriendRequestDirection }) => {
      state[action.payload].stale = true;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchFriendRequests.pending, (state, action) => {
      if (action.meta.arg.page === 1) {
        state[action.meta.arg.direction].status = "loading";
      }
    });
    builder.addCase(fetchFriendRequests.fulfilled, (state, action) => {
      const list = state[action.payload.direction];
      const { items, page } = action.payload;
      if (page === 1) {
        list.items = items;
      } else {
        // A request arriving mid-paging shifts the pages: drop repeats.
        const known = new Set(list.items.map((item) => item.id));
        list.items.push(...items.filter((item) => !known.has(item.id)));
      }
      list.page = page;
      list.hasMore = items.length >= FRIEND_REQUESTS_PAGE_SIZE;
      list.loaded = true;
      list.stale = false;
      list.status = "idle";
    });
    builder.addCase(fetchFriendRequests.rejected, (state, action) => {
      if (action.meta.arg.page === 1) {
        state[action.meta.arg.direction].status = "error";
      }
    });
    // A new request lands in "received"; an answer to one of ours changes
    // "sent". Either list is refetched the next time it is looked at.
    builder.addCase(addNotification, (state, action) => {
      const type = action.payload.type;
      if (type === "FRIEND_REQUEST") state.received.stale = true;
      if (
        type === "FRIEND_REQUEST_ACCEPTED" ||
        type === "FRIEND_REQUEST_REJECTED"
      ) {
        state.sent.stale = true;
      }
    });
    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectRequestDirection = (state: RootState) =>
  state.friendRequests.direction;
export const selectRequestList = (
  state: RootState,
  direction: FriendRequestDirection,
) => state.friendRequests[direction];

export const { setRequestDirection, markRequestsStale } =
  friendRequestSlice.actions;
export default friendRequestSlice.reducer;
