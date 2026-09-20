import { api, type Page } from "@/utils/authorizeAxios";
import type { Notification } from "@/redux/slices/notificationSlice";
import type { NotificationPreferences } from "@/redux/slices/notificationPreferenceSlice";

export const getNotificationsAPI = (limit: number, cursor: string | null) =>
  api.get<Page<Notification>>(
    `/notification?limit=${limit}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`,
  );

export const getUnreadNotificationCountAPI = () =>
  api.get<number>("/notification/unread-count", { skipErrorToast: true });

export const markNotificationReadAPI = (notificationId: string) =>
  api.patch(`/notification/${notificationId}/read`);

export const markAllNotificationsReadAPI = () =>
  api.patch("/notification/read-all");

export const getNotificationTypesAPI = () =>
  api.get<string[]>("/notification/types");

export const getNotificationPreferencesAPI = () =>
  api.get<NotificationPreferences>("/notification/preferences");

export const updateNotificationPreferencesAPI = (
  change: Partial<NotificationPreferences>,
) => api.put<NotificationPreferences>("/notification/preferences", change);
