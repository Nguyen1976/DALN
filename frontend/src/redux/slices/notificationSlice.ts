import {
  getNotificationsAPI,
  getUnreadNotificationCountAPI,
  markAllNotificationsReadAPI,
  markNotificationReadAPI,
} from "@/apis/notification";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { logoutAPI } from "./userSlice";

/** The kinds of notification the server sends (same names as in settings). */
export type NotificationType =
  | "FRIEND_REQUEST_SENT"
  | "FRIEND_REQUEST_ACCEPTED"
  | "FRIEND_REQUEST_REJECTED"
  | "MENTIONED_IN_CONVERSATION"
  | "SYSTEM_NOTIFICATION";

export interface Notification {
  id: string;
  userId: string;
  message: string;
  isRead: boolean;
  type: NotificationType;
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
  /** Set once the badge count has been fetched this session. */
  unreadCountLoaded: boolean;
  /**
   * Paging of the bell's list, kept here rather than in the dropdown: the
   * dropdown lives in the chat sidebar, which unmounts on every trip to
   * another tab, and used to forget which pages it had.
   */
  loaded: boolean;
  /** Where the next page starts; null once everything is loaded. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Notifications per page in the bell's list. */
export const NOTIFICATIONS_PAGE_SIZE = 10;

const initialState: NotificationState = {
  items: [],
  unreadCount: 0,
  unreadCountLoaded: false,
  loaded: false,
  nextCursor: null,
  hasMore: true,
};

/** A page of the bell's list; `cursor: null` (re)loads the first. */
export const getNotifications = createAsyncThunk(
  `/notification`,
  ({ cursor }: { cursor: string | null }) =>
    getNotificationsAPI(NOTIFICATIONS_PAGE_SIZE, cursor),
);

export const fetchUnreadCount = createAsyncThunk(
  `/notification/unread-count`,
  () => getUnreadNotificationCountAPI(),
);

export const markNotificationAsRead = createAsyncThunk(
  `/notification/mark-read`,
  async ({ notificationId }: { notificationId: string }) => {
    await markNotificationReadAPI(notificationId);
    return { notificationId };
  },
);

export const markAllNotificationsAsRead = createAsyncThunk(
  `/notification/mark-all-read`,
  async () => {
    await markAllNotificationsReadAPI();
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
    builder.addCase(getNotifications.fulfilled, (state, action) => {
      const { items: incoming, nextCursor } = action.payload;
      state.loaded = true;
      state.nextCursor = nextCursor;
      state.hasMore = nextCursor !== null;

      if (action.meta.arg.cursor === null) {
        state.items = incoming;
        return;
      }

      for (const notification of incoming) {
        if (!state.items.some((n) => n.id === notification.id)) {
          state.items.push(notification);
        }
      }
    });

    builder.addCase(fetchUnreadCount.fulfilled, (state, action) => {
      state.unreadCount = action.payload;
      state.unreadCountLoaded = true;
    });

    builder.addCase(markNotificationAsRead.fulfilled, (state, action) => {
      const target = state.items.find(
        (n) => n.id === action.payload.notificationId,
      );
      if (target && !target.isRead) {
        target.isRead = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
    });

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

type WithNotifications = { notification: NotificationState };
export const selectUnreadCountLoaded = (state: WithNotifications) =>
  state.notification.unreadCountLoaded;
export const selectNotificationsLoaded = (state: WithNotifications) =>
  state.notification.loaded;
export const selectNotificationsNextCursor = (state: WithNotifications) =>
  state.notification.nextCursor;
export const selectNotificationsHasMore = (state: WithNotifications) =>
  state.notification.hasMore;

export const { addNotification } = notificationSlice.actions;
export default notificationSlice.reducer;
