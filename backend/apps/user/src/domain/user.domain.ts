/**
 * Domain Objects / Aggregates
 * Service layer chỉ làm việc với những đối tượng này
 * Controller/Transport layer sẽ map sang gRPC types
 */

export interface UserEntity {
  id: string
  email: string
  username: string
  fullName: string | null
  bio: string | null
  avatar: string | null
  createdAt: Date
  updatedAt: Date
  lastSeen: Date | null
}

export interface AuthSession {
  userId: string
  email: string
  username: string
  fullName: string | null
  avatar: string | null
  bio: string | null
  accessToken: string
  refreshToken: string
}

export interface Friendship {
  id: string
  fromUserId: string
  toUserId: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  createdAt: Date
  updatedAt: Date
}

export interface FriendRequestDetail extends Friendship {
  fromUser: Omit<UserEntity, 'password' | 'friends'>
}

export interface UserProfile {
  fullName: string | null
  bio: string | null
  avatar: string | null
}
