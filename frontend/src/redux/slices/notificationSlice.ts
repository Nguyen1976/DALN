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

export interface NotificationState {
  items: Notification[];
  /**
   * Unread total as reported by the server.
   *
   * This used to be derived by counting unread entries in `items` — but only
   * one page (ten rows) is ever loaded, so anyone with more than ten unread
   * notifications saw a badge stuck at ten. The count now comes from the
   * server and is adjusted locally on read/arrival, then re-synced.
   */
  unreadCount: number;
}

const initialState: NotificationState = {
  items: [],
  unreadCount: 0,
};

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

export const fetchUnreadCount = createAsyncThunk(
  `/notification/unread-count`,
  async () => {
    const response = await authorizeAxiosInstance.get(
      "/notification/unread-count",
      { skipErrorToast: true },
    );
    const data = response.data?.data ?? response.data;
    return Number(data?.unreadCount ?? data?.count ?? 0) || 0;
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
      const existedIndex = state.items.findIndex((n) => n.id === incoming.id);
      if (existedIndex !== -1) {
        state.items[existedIndex] = incoming;
        return;
      }

      state.items.unshift(incoming);
      if (!incoming.isRead) state.unreadCount += 1;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(
      getNotifications.fulfilled,
      (
        state,
        action: PayloadAction<{
          notifications: Notification[];
          page: number;
          limit: number;
        }>,
      ) => {
        const incoming = action.payload.notifications || [];

        if (action.payload.page <= 1) {
          state.items = incoming;
          return;
        }

        for (const notification of incoming) {
          if (!state.items.some((n) => n.id === notification.id)) {
            state.items.push(notification);
          }
        }
      },
    );

    builder.addCase(fetchUnreadCount.fulfilled, (state, action) => {
      state.unreadCount = action.payload;
    });

    builder.addCase(
      markNotificationAsRead.fulfilled,
      (state, action: PayloadAction<{ notificationId: string }>) => {
        const target = state.items.find(
          (n) => n.id === action.payload.notificationId,
        );
        if (target && !target.isRead) {
          target.isRead = true;
          state.unreadCount = Math.max(0, state.unreadCount - 1);
        }
      },
    );

    builder.addCase(markAllNotificationsAsRead.fulfilled, (state) => {
      state.items.forEach((notification) => {
        notification.isRead = true;
      });
      state.unreadCount = 0;
    });

    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectNotification = (state: {
  notification: NotificationState;
}) => state.notification.items;

export const selectUnreadNotificationCount = (state: {
  notification: NotificationState;
}) => state.notification.unreadCount;

export const { addNotification } = notificationSlice.actions;
export default notificationSlice.reducer;
