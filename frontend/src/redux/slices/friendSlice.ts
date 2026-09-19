import authorizeAxiosInstance from "@/utils/authorizeAxios";
import {
  createAsyncThunk,
  createSelector,
  createSlice,
} from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { logoutAPI } from "./userSlice";
import {
  getUserProfileByIdAPI,
  type UserProfileByIdResponse as FriendProfile,
} from "@/apis";

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
  /** True after the first page arrived, even if it was empty. */
  loaded: boolean;
  /**
   * The friend open in the Friends screen's detail panel. Kept here so it is
   * still open after a trip to another tab; nothing is selected by default.
   */
  selectedFriendId: string | null;
  /** Detail profiles fetched this session, by user id. */
  profiles: Record<string, FriendProfile>;
  profileStatus: Record<string, "loading" | "error">;
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
  loaded: false,
  selectedFriendId: null,
  profiles: {},
  profileStatus: {},
};

/**
 * A friend's detail profile, fetched when they are first selected and then
 * served from the store: going back to someone does not call the API again.
 */
export const fetchFriendProfile = createAsyncThunk(
  `/friend/profile`,
  (friendId: string) => getUserProfileByIdAPI(friendId),
  {
    condition: (friendId, { getState }) => {
      const { profiles, profileStatus } = (getState() as RootState).friend;
      return !profiles[friendId] && profileStatus[friendId] !== "loading";
    },
  },
);

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
  state.loaded = true;
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
    setSelectedFriend: (state, action: PayloadAction<string | null>) => {
      state.selectedFriendId = action.payload;
    },
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
    builder.addCase(fetchFriendProfile.pending, (state, action) => {
      state.profileStatus[action.meta.arg] = "loading";
    });
    builder.addCase(fetchFriendProfile.fulfilled, (state, action) => {
      state.profiles[action.meta.arg] = action.payload;
      delete state.profileStatus[action.meta.arg];
    });
    builder.addCase(fetchFriendProfile.rejected, (state, action) => {
      state.profileStatus[action.meta.arg] = "error";
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
export const selectFriendsLoaded = (state: RootState) => state.friend.loaded;
export const selectSelectedFriendId = (state: RootState) =>
  state.friend.selectedFriendId;
export const selectFriendProfile = (
  state: RootState,
  friendId: string | null,
) => (friendId ? state.friend.profiles[friendId] : undefined);
export const selectFriendProfileStatus = (
  state: RootState,
  friendId: string | null,
) => (friendId ? state.friend.profileStatus[friendId] : undefined);

export const { updateStatusOffline, setSelectedFriend } = friendSlice.actions;
export default friendSlice.reducer;
