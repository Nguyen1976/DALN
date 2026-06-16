import authorizeAxiosInstance from "@/utils/authorizeAxios";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

export interface UserState {
  id: string;
  email: string;
  username: string;
  fullName: string;
  avatar?: string;
  bio?: string;
  token?: string;
  interests: string[];
  hasCompletedInterestOnboarding: boolean;
}

type AuthUserPayload = Partial<UserState> & {
  token?: string;
  accessToken?: string;
};

type InterestOnboardingResult = {
  interests?: string[];
  hasCompletedInterestOnboarding?: boolean;
};

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
      const response = await authorizeAxiosInstance.post("/user/login", data);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(getErrorMessage(error));
    }
  },
);

export const logoutAPI = createAsyncThunk(`/user/logout`, async () => {
  await authorizeAxiosInstance.post("/user/logout");
  return {};
});

export const fetchCurrentUserAPI = createAsyncThunk(
  `user/me`,
  async (_, { rejectWithValue }) => {
    try {
      const response = await authorizeAxiosInstance.get("/user/me");
      return response.data.data;
    } catch (error) {
      return rejectWithValue(getErrorMessage(error));
    }
  },
);

export const completeInterestOnboardingAPI = createAsyncThunk(
  `user/interest-onboarding`,
  async (slugs: string[], { rejectWithValue }) => {
    try {
      const response = await authorizeAxiosInstance.post(
        "/user/interest-onboarding",
        { slugs },
      );
      return response.data.data;
    } catch (error) {
      return rejectWithValue(getErrorMessage(error));
    }
  },
);

export const updateProfileAPI = createAsyncThunk(
  `/user/update-profile`,
  async (formData: FormData) => {
    const response = await authorizeAxiosInstance.post(
      "/user/update-profile",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return response.data.data;
  },
);

export const fetchUserByIdAPI = createAsyncThunk(
  `/user/get-by-id`,
  async (userId: string) => {
    const response = await authorizeAxiosInstance.get(
      `/user?userId=${userId}`,
    );
    return response.data.data;
  },
);

export const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(loginAPI.pending, (state) => {
      Object.assign(state, initialState);
    });

    builder.addCase(
      loginAPI.fulfilled,
      (state, action: PayloadAction<AuthUserPayload>) => {
        const { token, accessToken, ...user } = action.payload;
      Object.assign(state, initialState, user);
      const bearer = accessToken || token;
      if (bearer) {
        localStorage.setItem("token", bearer);
      } else {
        localStorage.removeItem("token");
      }
      state.interests = action.payload.interests ?? [];
      state.hasCompletedInterestOnboarding =
        action.payload.hasCompletedInterestOnboarding ?? true;
    });
    builder.addCase(loginAPI.rejected, (state) => {
      Object.assign(state, initialState);
      localStorage.removeItem("token");
    });

    builder.addCase(logoutAPI.pending, (state) => {
      Object.assign(state, initialState);
      localStorage.removeItem("token");
    });

    builder.addCase(logoutAPI.fulfilled, (state) => {
      Object.assign(state, initialState);
      localStorage.removeItem("token");
    });

    builder.addCase(logoutAPI.rejected, (state) => {
      Object.assign(state, initialState);
      localStorage.removeItem("token");
    });
    builder.addCase(
      updateProfileAPI.fulfilled,
      (state, action: PayloadAction<Partial<UserState>>) => {
        Object.assign(state, action.payload);
      },
    );
    builder.addCase(
      fetchUserByIdAPI.fulfilled,
      (state, action: PayloadAction<Partial<UserState>>) => {
        Object.assign(state, action.payload);
      },
    );
    builder.addCase(
      fetchCurrentUserAPI.fulfilled,
      (state, action: PayloadAction<AuthUserPayload>) => {
        const d = action.payload;
        if (!d?.id) return;
        state.id = d.id;
        state.email = d.email ?? "";
        state.username = d.username ?? "";
        state.fullName = d.fullName ?? "";
        state.avatar = d.avatar ?? "";
        state.bio = d.bio ?? "";
        state.interests = d.interests ?? [];
        state.hasCompletedInterestOnboarding =
          d.hasCompletedInterestOnboarding ?? true;
      },
    );
    builder.addCase(
      completeInterestOnboardingAPI.fulfilled,
      (state, action: PayloadAction<InterestOnboardingResult>) => {
        if (Array.isArray(action.payload?.interests)) {
          state.interests = action.payload.interests;
        }
        state.hasCompletedInterestOnboarding =
          action.payload?.hasCompletedInterestOnboarding ?? true;
      },
    );
  },
});

export const selectUser = (state: { user: UserState }) => {
  return state.user;
};

export default userSlice.reducer;
