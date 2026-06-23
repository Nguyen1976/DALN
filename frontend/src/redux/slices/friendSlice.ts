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
  page: number;
  friends: Array<Friend>;
}

interface UserProfileByIdResponse {
  fullName: string;
  username: string;
  email: string;
  bio: string;
  avatar: string;
}

const initialState: FriendState = {
  page: 1,
  friends: [],
};

export const getFriends = createAsyncThunk(
  `/user/list-friends`,
  async ({ limit, page }: { limit: number; page: number }) => {
    const response = await authorizeAxiosInstance.get(
      `/user/list-friends?limit=${limit}&page=${page}`,
    );
    return { ...response.data.data, page: page };
  },
);

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
    builder.addCase(
      getFriends.fulfilled,
      (state, action: PayloadAction<FriendState>) => {
        if (action.payload.page === 1) {
          state.friends = action.payload.friends;
        } else {
          state.friends = [...state.friends, ...action.payload.friends];
        }
        state.page = action.payload.page;
      },
    );

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

export const selectFriendPage = createSelector(
  (state: RootState) => state.friend,
  (friend) => friend.page,
);

export const { updateStatusOffline } = friendSlice.actions;
export default friendSlice.reducer;
