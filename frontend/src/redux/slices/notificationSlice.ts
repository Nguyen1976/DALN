import authorizeAxiosInstance from "@/utils/authorizeAxios";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { logoutAPI } from "./userSlice";

export interface Notification {
  id: string;
  userId: string;
  message: string;
  isRead: boolean;
  type: string;
  friendRequestId?: string | undefined;
  createdAt: string;
}

export type NotificationState = Notification[];

const initialState: NotificationState = [];

export const getNotifications = createAsyncThunk(
  `/notification`,
  async ({ limit, page }: { limit: number; page: number }) => {
    const response = await authorizeAxiosInstance.get(
      `/notification?limit=${limit}&page=${page}`,
    );
    return {
      ...response.data.data,
      page,
      limit,
    };
  },
);

export const markNotificationAsRead = createAsyncThunk(
  `/notification/mark-read`,
  async ({ notificationId }: { notificationId: string }) => {
    await authorizeAxiosInstance.patch(
      `/notification/${notificationId}/read`,
    );
    return { notificationId };
  },
);

export const markAllNotificationsAsRead = createAsyncThunk(
  `/notification/mark-all-read`,
  async () => {
    await authorizeAxiosInstance.patch("/notification/read-all");
    return true;
  },
);

export const notificationSlice = createSlice({
  name: "notification",
  initialState,
  reducers: {
    addNotification: (state, action: PayloadAction<Notification>) => {
      const incoming = action.payload;
      const existedIndex = state.findIndex((n) => n.id === incoming.id);
      if (existedIndex !== -1) {
        state[existedIndex] = incoming;
        return;
      }

      state.unshift(incoming);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(
      getNotifications.fulfilled,
      (
        state,
        action: PayloadAction<{
          notifications: NotificationState;
          page: number;
          limit: number;
        }>,
      ) => {
        const incoming = action.payload.notifications || [];

        if (action.payload.page <= 1) {
          return incoming;
        }

        const merged = [...state];
        for (const notification of incoming) {
          if (!merged.some((n) => n.id === notification.id)) {
            merged.push(notification);
          }
        }

        return merged;
      },
    );

    builder.addCase(
      markNotificationAsRead.fulfilled,
      (state, action: PayloadAction<{ notificationId: string }>) => {
        const target = state.find(
          (n) => n.id === action.payload.notificationId,
        );
        if (target) {
          target.isRead = true;
        }
      },
    );

    builder.addCase(markAllNotificationsAsRead.fulfilled, (state) => {
      state.forEach((notification) => {
        notification.isRead = true;
      });
    });

    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectNotification = (state: {
  notification: NotificationState;
}) => {
  return state.notification;
};

export const { addNotification } = notificationSlice.actions;
export default notificationSlice.reducer;
