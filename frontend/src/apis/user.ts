import { api, type Page } from "@/utils/authorizeAxios";
import { normalizeEmail } from "@/utils/email";
import type { UserState } from "@/redux/slices/userSlice";

/** A friend as the list, search and presence updates carry them. */
export interface Friend {
  id: string;
  email: string;
  username: string;
  fullName: string;
  avatar: string;
  bio: string;
  /** Connected right now. */
  status: boolean;
  lastSeen?: string | null;
}

/** Someone's profile; the email only comes back for friends and yourself. */
export interface UserProfile {
  email?: string;
  username: string;
  fullName: string;
  avatar: string;
  bio: string;
}

/** The other person on a friend request (the recipient, on the sent tab). */
export interface RequestPerson {
  id: string;
  email: string;
  username: string;
  fullName: string;
  avatar: string;
}

export interface FriendRequestListItem {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  counterpart: RequestPerson;
}

export interface FriendRequestDetail extends FriendRequestListItem {
  toUserId: string;
}

export type FriendRequestDirection = "received" | "sent";

export const registerAPI = (data: {
  email: string;
  username: string;
  password: string;
  location?: { lat: number; lon: number };
}) =>
  api.post<{ email: string; requiresOtpVerification: boolean }>(
    "/user/register",
    { ...data, email: normalizeEmail(data.email) },
    { skipErrorToast: true },
  );

export const verifyOtpAPI = (data: { email: string; otp: string }) =>
  api.post("/user/verify-otp", { ...data, email: normalizeEmail(data.email) });

export const resendOtpAPI = (data: { email: string }) =>
  api.post("/user/resend-otp", { email: normalizeEmail(data.email) });

/**
 * Luôn nhận 204 — kể cả email không tồn tại hay đang trong cooldown. Đừng suy
 * ra bất cứ điều gì về tài khoản từ phản hồi này; đó là chủ đích của server.
 * `skipErrorToast` để lỗi mạng không bật toast đè lên màn "đã gửi".
 */
export const forgotPasswordAPI = (data: { email: string }) =>
  api.post(
    "/user/forgot-password",
    { email: normalizeEmail(data.email) },
    { skipErrorToast: true },
  );

export const validateResetTokenAPI = (token: string) =>
  api.get<{ valid: boolean; maskedEmail?: string }>(
    `/user/reset-password/validate?token=${encodeURIComponent(token)}`,
    { skipErrorToast: true },
  );

export const resetPasswordAPI = (data: { token: string; password: string }) =>
  api.post("/user/reset-password", data, { skipErrorToast: true });

export const signInAPI = (data: { email: string; password: string }) =>
  api.post<UserState>("/user/login", {
    ...data,
    email: normalizeEmail(data.email),
  });

export const signOutAPI = () => api.post("/user/logout");

export const getSessionUserAPI = () => api.get<UserState>("/user/me");

export const saveInterestsAPI = (slugs: string[]) =>
  api.post<{ interests: string[]; hasCompletedInterestOnboarding: boolean }>(
    "/user/interest-onboarding",
    { slugs },
  );

export const saveProfileAPI = (formData: FormData) =>
  api.post<{ fullName: string; bio: string; avatar: string }>(
    "/user/update-profile",
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );

export const getUserProfileByIdAPI = (userId: string) =>
  api.get<UserProfile>(`/user?userId=${userId}`);

const cursorParam = (cursor: string | null) =>
  cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";

export const getFriendsAPI = (limit: number, cursor: string | null) =>
  api.get<Page<Friend>>(
    `/user/list-friends?limit=${limit}${cursorParam(cursor)}`,
  );

export const searchUsersAPI = (keyword: string) =>
  api.get<Friend[]>(`/user/search?keyword=${encodeURIComponent(keyword)}`);

export const makeFriendRequest = (email: string) =>
  api.post(
    "/user/make-friend",
    { email: normalizeEmail(email) },
    { skipErrorToast: true },
  );

/**
 * Gửi lời mời theo username — dùng ở thẻ gợi ý kết bạn, nơi client chỉ có
 * username chứ không có (và không nên có) email của người khác.
 */
export const makeFriendRequestByUsername = (username: string) =>
  api.post(
    "/user/make-friend-by-username",
    { username: username.trim() },
    { skipErrorToast: true },
  );

export const getFriendRequestsAPI = ({
  limit,
  cursor,
  direction,
}: {
  limit: number;
  cursor: string | null;
  direction: FriendRequestDirection;
}) =>
  api.get<Page<FriendRequestListItem>>(
    `/user/list-friend-requests?limit=${limit}&direction=${direction}${cursorParam(cursor)}`,
  );

export const getFriendRequestDetail = (friendRequestId: string) =>
  api.get<FriendRequestDetail>(
    `/user/detail-friend-request?friendRequestId=${friendRequestId}`,
  );

/** The recipient accepts or declines a request, by its id. */
export const respondToFriendRequestAPI = (
  requestId: string,
  status: "ACCEPTED" | "REJECTED",
) => api.post(`/user/friend-requests/${requestId}/respond`, { status });
