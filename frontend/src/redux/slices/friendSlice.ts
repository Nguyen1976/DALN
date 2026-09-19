import authorizeAxiosInstance from "@/utils/authorizeAxios";
import {
  createAsyncThunk,
  createSelector,
  createSlice,
} from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { logoutAPI } from "./userSlice";

export interface Friend {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  fullName?: string;
  status: boolean;
  lastSeen?: string;
}

export interface FriendState {
  friends: Array<Friend>;
  /**
   * How many rows of the server's list have been read. Kept apart from
   * `friends.length`: friends who come online get prepended out of order.
   */
  serverOffset: number;
  /** False once a page came back shorter than asked. */
  hasMore: boolean;
}

/** Page size for scrolling through the friend list. */
export const FRIENDS_PAGE_SIZE = 20;

interface UserProfileByIdResponse {
  fullName: string;
  username: string;
  email: string;
  bio: string;
  avatar: string;
}

const initialState: FriendState = {
  friends: [],
  serverOffset: 0,
  hasMore: true,
};

type FriendPage = { friends: Friend[]; page: number; limit: number };

const fetchFriendPage = async (
  limit: number,
  page: number,
): Promise<FriendPage> => {
  const response = await authorizeAxiosInstance.get(
    `/user/list-friends?limit=${limit}&page=${page}`,
  );
  return { friends: response.data.data?.friends ?? [], page, limit };
};

/** A page of the list; page 1 replaces what is loaded. */
export const getFriends = createAsyncThunk(
  `/user/list-friends`,
  ({ limit, page }: { limit: number; page: number }) =>
    fetchFriendPage(limit, page),
);

/**
 * The next page while scrolling. Callers load page 1 with different sizes
 * (20, 50, 100), so the page is derived from how far the server list has been
 * read, rounded down: at worst a few rows come back twice and are dropped as
 * duplicates, never a gap.
 */
export const getMoreFriends = createAsyncThunk(
  `/user/list-friends/more`,
  (_: void, { getState }) => {
    const { serverOffset } = (getState() as RootState).friend;
    const page = Math.floor(serverOffset / FRIENDS_PAGE_SIZE) + 1;
    return fetchFriendPage(FRIENDS_PAGE_SIZE, page);
  },
);

const applyFriendPage = (
  state: FriendState,
  { friends, page, limit }: FriendPage,
) => {
  const skip = (page - 1) * limit;
  if (page === 1) {
    state.friends = friends;
  } else {
    const known = new Set(state.friends.map((friend) => friend.id));
    state.friends.push(...friends.filter((friend) => !known.has(friend.id)));
  }
  state.serverOffset = skip + friends.length;
  state.hasMore = friends.length >= limit;
};

export const upsertOnlineFriend = createAsyncThunk(
  `/friend/upsert-online`,
  async (friendId: string, { getState }) => {
    const state = getState() as RootState;
    const existingFriend = state.friend.friends.find(
      (friend) => friend.id === friendId,
    );

    if (existingFriend) {
      return { friendId, profile: null as UserProfileByIdResponse | null };
    }

    const response = await authorizeAxiosInstance.get(
      `/user?userId=${friendId}`,
    );

    return {
      friendId,
      profile: response.data.data as UserProfileByIdResponse,
    };
  },
);

export const friendSlice = createSlice({
  name: "friend",
  initialState,
  reducers: {
    updateStatusOffline: (
      state,
      action: PayloadAction<{ friendId: string; lastSeen: string }>,
    ) => {
      const { friendId, lastSeen } = action.payload;
      const friendIndex = state.friends.findIndex(
        (friend) => friend.id === friendId,
      );
      if (friendIndex !== -1) {
        state.friends[friendIndex].status = false;
        state.friends[friendIndex].lastSeen = lastSeen;
      }
      return state;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(getFriends.fulfilled, (state, action) => {
      applyFriendPage(state, action.payload);
    });
    builder.addCase(getMoreFriends.fulfilled, (state, action) => {
      applyFriendPage(state, action.payload);
    });

    builder.addCase(upsertOnlineFriend.fulfilled, (state, action) => {
      const { friendId, profile } = action.payload;

      const existingIndex = state.friends.findIndex(
        (friend) => friend.id === friendId,
      );

      if (existingIndex !== -1) {
        state.friends[existingIndex].status = true;
        return state;
      }

      if (!profile) return state;

      state.friends.unshift({
        id: friendId,
        email: profile.email,
        username: profile.username,
        fullName: profile.fullName,
        avatar: profile.avatar,
        status: true,
      });

      return state;
    });

    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectFriend = createSelector(
  (state: RootState) => state.friend,
  (friend) => friend.friends,
);

export const selectFriendHasMore = (state: RootState) => state.friend.hasMore;

export const { updateStatusOffline } = friendSlice.actions;
export default friendSlice.reducer;
