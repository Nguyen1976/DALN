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
