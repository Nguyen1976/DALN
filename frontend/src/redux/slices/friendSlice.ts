import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { logoutAPI } from "./userSlice";
import { getFriendsAPI, type Friend } from "@/apis/user";

export interface FriendState {
  friends: Array<Friend>;
  /** Where the next page starts; null once the list is complete. */
  nextCursor: string | null;
  /** True until a page said there is nothing after it. */
  hasMore: boolean;
  /** True after the first page arrived, even if it was empty. */
  loaded: boolean;
  /**
   * The friend open in the Friends screen's detail panel, kept here so it is
   * still open after a trip to another tab; nothing is selected by default.
   * A copy rather than an id: the pick may come from search results that are
   * not in the loaded list.
   */
  selectedFriend: Friend | null;
}

/**
 * Friends per page, everywhere the list is loaded. Large enough that the
 * chat sidebar's presence dots cover most people from the first page.
 */
export const FRIENDS_PAGE_SIZE = 50;

const initialState: FriendState = {
  friends: [],
  nextCursor: null,
  hasMore: true,
  loaded: false,
  selectedFriend: null,
};

/** The first page again, replacing what is loaded. */
export const getFriends = createAsyncThunk(`/user/list-friends`, () =>
  getFriendsAPI(FRIENDS_PAGE_SIZE, null),
);

/** The page after those loaded, while scrolling. */
export const getMoreFriends = createAsyncThunk(
  `/user/list-friends/more`,
  (_: void, { getState }) =>
    getFriendsAPI(FRIENDS_PAGE_SIZE, (getState() as RootState).friend.nextCursor),
);

export const friendSlice = createSlice({
  name: "friend",
  initialState,
  reducers: {
    setSelectedFriend: (state, action: PayloadAction<Friend | null>) => {
      state.selectedFriend = action.payload;
    },
    /**
     * A friend came online. The event carries their row, so someone not
     * loaded yet goes on top straight away, presence and all.
     */
    friendCameOnline: (state, action: PayloadAction<Friend>) => {
      const friend = state.friends.find((item) => item.id === action.payload.id);
      if (friend) {
        friend.status = true;
        friend.lastSeen = null;
      } else {
        state.friends.unshift(action.payload);
      }
    },
    updateStatusOffline: (
      state,
      action: PayloadAction<{ friendId: string; lastSeen: string }>,
    ) => {
      const { friendId, lastSeen } = action.payload;
      const friend = state.friends.find((item) => item.id === friendId);
      if (friend) {
        friend.status = false;
        friend.lastSeen = lastSeen;
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(getFriends.fulfilled, (state, { payload }) => {
      state.friends = payload.items;
      state.nextCursor = payload.nextCursor;
      state.hasMore = payload.nextCursor !== null;
      state.loaded = true;
    });
    builder.addCase(getMoreFriends.fulfilled, (state, { payload }) => {
      // Friends who came online are put on top out of order, so a page can
      // repeat someone already shown.
      const known = new Set(state.friends.map((friend) => friend.id));
      state.friends.push(
        ...payload.items.filter((friend) => !known.has(friend.id)),
      );
      state.nextCursor = payload.nextCursor;
      state.hasMore = payload.nextCursor !== null;
      state.loaded = true;
    });

    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectFriend = (state: RootState) => state.friend.friends;
export const selectFriendHasMore = (state: RootState) => state.friend.hasMore;
export const selectFriendsLoaded = (state: RootState) => state.friend.loaded;
export const selectSelectedFriend = (state: RootState) =>
  state.friend.selectedFriend;

export const { updateStatusOffline, setSelectedFriend, friendCameOnline } =
  friendSlice.actions;
export default friendSlice.reducer;
