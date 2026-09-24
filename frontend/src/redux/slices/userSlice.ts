import {
  getSessionUserAPI,
  saveInterestsAPI,
  saveProfileAPI,
  signInAPI,
  signOutAPI,
} from "@/apis/user";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { socket } from "@/lib/socket";
import { resetSocketAuthRetries } from "@/lib/socketAuth";

export interface UserState {
  id: string;
  email: string;
  username: string;
  fullName: string;
  avatar: string;
  bio: string;
  interests: string[];
  hasCompletedInterestOnboarding: boolean;
}

/**
 * Remove the JWT copy earlier builds wrote to localStorage.
 *
 * Anyone who signed in before this change still has it sitting in their
 * browser; clearing it on the next auth transition retires it for good.
 */
function clearLegacySessionStorage() {
  try {
    localStorage.removeItem("token");
  } catch {
    /* private mode */
  }
}

const initialState: UserState = {
  id: "",
  email: "",
  username: "",
  fullName: "",
  bio: "",
  avatar: "",
  interests: [],
  hasCompletedInterestOnboarding: true,
};

export const loginAPI = createAsyncThunk(
  `/user/login`,
  async (data: { email: string; password: string }, { rejectWithValue }) => {
    try {
      return await signInAPI(data);
    } catch (error) {
      return rejectWithValue(getErrorMessage(error));
    }
  },
);

export const logoutAPI = createAsyncThunk(`/user/logout`, async () => {
  try {
    await signOutAPI();
  } finally {
    // Guard chỉ chặn được HTTP: socket đã bắt tay xong vẫn nhận tin nhắn cho
    // tới khi có ai đó ngắt nó. Server cũng đẩy lệnh ngắt qua RMQ, nhưng cắt
    // ngay tại client thì người vừa bấm đăng xuất không phải chờ vòng qua
    // broker — và `finally` để việc đó xảy ra cả khi lời gọi logout thất bại.
    socket.disconnect();
    resetSocketAuthRetries();
  }
});

export const fetchCurrentUserAPI = createAsyncThunk(
  `user/me`,
  async (_, { rejectWithValue }) => {
    try {
      return await getSessionUserAPI();
    } catch (error) {
      return rejectWithValue(getErrorMessage(error));
    }
  },
);

export const completeInterestOnboardingAPI = createAsyncThunk(
  `user/interest-onboarding`,
  async (slugs: string[], { rejectWithValue }) => {
    try {
      return await saveInterestsAPI(slugs);
    } catch (error) {
      return rejectWithValue(getErrorMessage(error));
    }
  },
);

export const updateProfileAPI = createAsyncThunk(
  `/user/update-profile`,
  (formData: FormData) => saveProfileAPI(formData),
);

/**
 * The session user built from a server answer (login, /me): exactly the known
 * fields, nothing else. Reducers return a fresh object rather than merging
 * into the old one, so a stray key — like the refresh token older builds let
 * into this persisted slice — cannot survive.
 */
function toUserState(user: UserState): UserState {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    avatar: user.avatar,
    bio: user.bio,
    interests: user.interests,
    hasCompletedInterestOnboarding: user.hasCompletedInterestOnboarding,
  };
}

export const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    const signedOut = () => {
      clearLegacySessionStorage();
      return initialState;
    };
    builder.addCase(loginAPI.pending, signedOut);
    builder.addCase(loginAPI.rejected, signedOut);
    builder.addCase(logoutAPI.pending, signedOut);
    builder.addCase(logoutAPI.fulfilled, signedOut);
    builder.addCase(logoutAPI.rejected, signedOut);

    builder.addCase(loginAPI.fulfilled, (_state, action) => {
      clearLegacySessionStorage();
      return toUserState(action.payload);
    });
    builder.addCase(fetchCurrentUserAPI.fulfilled, (_state, action) =>
      toUserState(action.payload),
    );
    builder.addCase(updateProfileAPI.fulfilled, (state, action) => {
      state.fullName = action.payload.fullName;
      state.bio = action.payload.bio;
      state.avatar = action.payload.avatar;
    });
    builder.addCase(completeInterestOnboardingAPI.fulfilled, (state, action) => {
      state.interests = action.payload.interests;
      state.hasCompletedInterestOnboarding =
        action.payload.hasCompletedInterestOnboarding;
    });
  },
});

export const selectUser = (state: { user: UserState }) => {
  return state.user;
};

export default userSlice.reducer;
