import authorizeAxiosInstance from "@/utils/authorizeAxios";
import { API_ROOT } from "@/utils/constant";
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
}

const initialState: UserState = {
  id: "",
  email: "",
  username: "",
  fullName: "",
  bio: "",
  avatar: "",
};

export const loginAPI = createAsyncThunk(
  `/user/login`,
  async (data: { email: string; password: string }, { rejectWithValue }) => {
    try {
      const response = await authorizeAxiosInstance.post(
        `${API_ROOT}/user/login`,
        data,
      );
      return response.data.data;
    } catch (error: any) {
      const backendMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error?.message ||
        error?.message ||
        "Đã xảy ra lỗi";

      return rejectWithValue(backendMessage);
    }
  },
);

export const logoutAPI = createAsyncThunk(`/user/logout`, async () => {
  //clear cookies
  await authorizeAxiosInstance.post(`${API_ROOT}/user/logout`);
  //clear data
  return {};
});

export const updateProfileAPI = createAsyncThunk(
  `/user/update-profile`,
  async (formData: FormData) => {
    const response = await authorizeAxiosInstance.post(
      `${API_ROOT}/user/update-profile`,
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
      `${API_ROOT}/user?userId=${userId}`,
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
      (state, action: PayloadAction<UserState>) => {
        const { token, ...user } = action.payload;
        Object.assign(state, initialState, user);
        if (token) {
          localStorage.setItem("token", token);
        } else {
          localStorage.removeItem("token");
        }
      },
    );
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
      (state, action: PayloadAction<UserState>) => {
        Object.assign(state, action.payload);
      },
    );
    builder.addCase(
      fetchUserByIdAPI.fulfilled,
      (state, action: PayloadAction<UserState>) => {
        Object.assign(state, action.payload);
      },
    );
  },
});

export const selectUser = (state: { user: UserState }) => {
  return state.user;
};

// export const {} = userSlice.actions
export default userSlice.reducer;
