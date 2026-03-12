import authorizeAxiosInstance from "@/utils/authorizeAxios";
import { API_ROOT } from "@/utils/constant";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { logoutAPI } from "./userSlice";

export type ChannelToggles = {
  IN_APP: boolean;
  EMAIL: boolean;
  REALTIME: boolean;
};

export type NotificationPreferences = {
  global: {
    enabled: boolean;
    channels: ChannelToggles;
  };
  overrides: Record<string, ChannelToggles>;
  digest: {
    enabled: boolean;
    minUnread: number;
    cooldownMinutes: number;
    lastDigestAt: string | null;
  };
  version: number;
  updatedAt?: string;
};

type NotificationPreferenceState = {
  isLoading: boolean;
  isSaving: boolean;
  notificationTypes: string[];
  data: NotificationPreferences | null;
};

const initialState: NotificationPreferenceState = {
  isLoading: false,
  isSaving: false,
  notificationTypes: [],
  data: null,
};

export const getNotificationTypes = createAsyncThunk(
  "/notification/types",
  async () => {
    const response = await authorizeAxiosInstance.get(
      `${API_ROOT}/notification/types`,
    );
    return response.data.data.types as string[];
  },
);

export const getNotificationPreferences = createAsyncThunk(
  "/notification/preferences/get",
  async () => {
    const response = await authorizeAxiosInstance.get(
      `${API_ROOT}/notification/preferences`,
    );
    return response.data.data as NotificationPreferences;
  },
);

export const updateNotificationPreferences = createAsyncThunk(
  "/notification/preferences/update",
  async (payload: Partial<NotificationPreferences>) => {
    const response = await authorizeAxiosInstance.put(
      `${API_ROOT}/notification/preferences`,
      payload,
    );
    return response.data.data as NotificationPreferences;
  },
);

const notificationPreferenceSlice = createSlice({
  name: "notificationPreference",
  initialState,
  reducers: {
    setPreferenceDraft: (
      state,
      action: PayloadAction<Partial<NotificationPreferences>>,
    ) => {
      if (!state.data) return;

      state.data = {
        ...state.data,
        ...action.payload,
      };
    },
  },
  extraReducers: (builder) => {
    builder.addCase(getNotificationTypes.fulfilled, (state, action) => {
      state.notificationTypes = action.payload || [];
    });

    builder.addCase(getNotificationPreferences.pending, (state) => {
      state.isLoading = true;
    });

    builder.addCase(getNotificationPreferences.fulfilled, (state, action) => {
      state.isLoading = false;
      state.data = action.payload;
    });

    builder.addCase(getNotificationPreferences.rejected, (state) => {
      state.isLoading = false;
    });

    builder.addCase(updateNotificationPreferences.pending, (state) => {
      state.isSaving = true;
    });

    builder.addCase(
      updateNotificationPreferences.fulfilled,
      (state, action) => {
        state.isSaving = false;
        state.data = action.payload;
      },
    );

    builder.addCase(updateNotificationPreferences.rejected, (state) => {
      state.isSaving = false;
    });

    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectNotificationPreference = (state: {
  notificationPreference: NotificationPreferenceState;
}) => state.notificationPreference;

export const { setPreferenceDraft } = notificationPreferenceSlice.actions;
export default notificationPreferenceSlice.reducer;
