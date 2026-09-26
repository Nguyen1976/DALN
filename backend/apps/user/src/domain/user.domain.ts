/** Domain objects the user service works with. */

/**
 * The signed-in user as the client keeps it. Login and GET /user/me both
 * answer with exactly this, so the client has one shape to store.
 */
export interface SessionUser {
  id: string
  email: string
  username: string
  fullName: string
  avatar: string
  bio: string
  interests: string[]
  hasCompletedInterestOnboarding: boolean
}

export function toSessionUser(user: {
  id: string
  email: string
  username: string
  fullName: string | null
  avatar: string | null
  bio: string | null
  interests?: string[] | null
  hasCompletedInterestOnboarding?: boolean | null
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName ?? '',
    avatar: user.avatar ?? '',
    bio: user.bio ?? '',
    interests: user.interests ?? [],
    // Accounts from before the onboarding step have no value: treat as done.
    hasCompletedInterestOnboarding: user.hasCompletedInterestOnboarding ?? true,
  }
}

/**
 * A successful login. The tokens are for the controller to set as httpOnly
 * cookies; only `user` goes into the response body.
 */
export interface AuthSession {
  user: SessionUser
  accessToken: string
  refreshToken: string
}

/**
 * Kết cục của một lần làm mới phiên.
 *
 * `grace` cố ý KHÔNG mang refreshToken: nó là request đến sau trong một cặp
 * song song, bản refresh mới đã nằm ở trình duyệt từ request thắng cuộc rotate.
 * `terminated` gộp cả "cookie sai" và "token bị dùng lại" — controller xử lý
 * giống nhau (xoá cookie + 401), còn việc giết phiên đã làm ở service.
 */
/**
 * Vị trí ước tính từ IP (GeoLite2). Chỉ là ước tính: `accuracyRadiusKm` là
 * bán kính bất định, và giao diện vẽ đúng vùng đó chứ không cắm một điểm.
 */
export interface GeoLocation {
  /** null khi dữ liệu chỉ biết tới quốc gia. */
  city: string | null
  country: string | null
  latitude: number
  longitude: number
  accuracyRadiusKm: number
}

/** Một thiết bị đang đăng nhập, như trang "Phiên đăng nhập" cần hiển thị. */
export interface SessionListItem {
  /** Định danh phiên — không phải bí mật, nó chỉ là phần tra key của cookie. */
  sid: string
  /** Lúc đăng nhập (ms). */
  createdAt: number
  /** Lần refresh gần nhất (ms) — lệch tối đa 15 phút so với request thật. */
  lastSeenAt: number
  userAgent: string | null
  /** IP lúc đăng nhập — không bao giờ bị ghi lại. */
  ip: string | null
  /** IP của lần refresh gần nhất. */
  lastIp: string | null
  /** Vị trí ước tính của `ip`; null khi không tra được. */
  location: GeoLocation | null
  /** Vị trí ước tính của `lastIp` — thiết bị đang ở đâu. */
  lastLocation: GeoLocation | null
  /** Đúng thiết bị đang xem trang này. */
  current: boolean
}

export type RefreshResult =
  | { status: 'rotated'; accessToken: string; refreshToken: string }
  | { status: 'grace'; accessToken: string }
  | { status: 'terminated' }

/** Another user as a row in a list: the friend list, search, requests. */
export interface UserSummary {
  id: string
  email: string
  username: string
  fullName: string
  avatar: string
  bio: string
  lastSeen: Date | null
}

export function toUserSummary(user: {
  id: string
  email: string
  username: string
  fullName: string | null
  avatar: string | null
  bio: string | null
  lastSeen: Date | null
}): UserSummary {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName ?? '',
    avatar: user.avatar ?? '',
    bio: user.bio ?? '',
    lastSeen: user.lastSeen,
  }
}

/** A friend, and whether they are connected right now. */
export interface FriendView extends UserSummary {
  status: boolean
}

/** The person on the other side of a friend request. */
export type RequestPerson = Pick<
  UserSummary,
  'id' | 'email' | 'username' | 'fullName' | 'avatar'
>

export interface FriendRequest {
  id: string
  fromUserId: string
  toUserId: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  createdAt: Date
  updatedAt: Date
}

/**
 * A pending request in a list. `counterpart` is the other person: the sender
 * on the received tab, the recipient on the sent tab.
 */
export interface FriendRequestView {
  id: string
  status: FriendRequest['status']
  createdAt: Date
  updatedAt: Date
  counterpart: RequestPerson
}

export interface FriendRequestDetail extends FriendRequestView {
  toUserId: string
}

/**
 * Someone's profile as a viewer sees it. The email is contact detail and is
 * only there for the account itself or an accepted friend.
 */
export interface PublicProfile {
  email?: string
  username: string
  fullName: string
  avatar: string
  bio: string
}

export interface UserProfile {
  fullName: string
  bio: string
  avatar: string
}
