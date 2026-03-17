
import {
  AuthSession,
  UserEntity,
  Friendship,
  FriendRequestDetail,
  UserProfile,
} from './user.domain'

export class UserMapper {
  static toRegisterResponse(user: UserEntity) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
    }
  }

  static toLoginResponse(session: AuthSession) {
    return {
      id: session.userId,
      email: session.email,
      username: session.username,
      fullName: session.fullName || '',
      avatar: session.avatar || '',
      bio: session.bio || '',
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    }
  }

  static toGetUserByIdResponse(user: UserEntity) {
    return {
      email: user.email,
      username: user.username,
      fullName: user.fullName || '',
      avatar: user.avatar || '',
      bio: user.bio || '',
    }
  }

  static toMakeFriendResponse(_friendship: Friendship) {
    return {
      status: 'SUCCESS',
    }
  }

  static toUpdateStatusResponse(_friendship: Friendship)   {
    return {
      status: 'SUCCESS',
    }
  }

  static toListFriendsResponse(friends: UserEntity[]) {
    return {
      friends: friends.map((friend) => ({
        id: friend.id,
        email: friend.email,
        username: friend.username,
        fullName: friend.fullName || '',
        avatar: friend.avatar || '',
        bio: friend.bio || '',
        status: (friend as any).status || false,
      })),
    }
  }

  static toDetailMakeFriendResponse(
    friendRequest: FriendRequestDetail,
  ) {
    return {
      id: friendRequest.id,
      toUserId: friendRequest.toUserId,
      status: friendRequest.status,
      createdAt: friendRequest.createdAt.toString(),
      updatedAt: friendRequest.updatedAt.toString(),
      fromUser: {
        id: friendRequest.fromUser.id,
        email: friendRequest.fromUser.email,
        username: friendRequest.fromUser.username,
        fullName: friendRequest.fromUser.fullName || '',
        avatar: friendRequest.fromUser.avatar || '',
      },
    }
  }

  static toListFriendRequestsResponse(
    friendRequests: any[],
  ) {
    return {
      friendRequests: friendRequests.map((request) => ({
        id: request.id,
        status: request.status,
        createdAt: request.createdAt.toString(),
        updatedAt: request.updatedAt.toString(),
        fromUser: {
          id: request.fromUser.id,
          email: request.fromUser.email,
          username: request.fromUser.username,
          fullName: request.fromUser.fullName || '',
          avatar: request.fromUser.avatar || '',
        },
      })),
    }
  }

  static toUpdateProfileResponse(profile: UserProfile) {
    return {
      fullName: profile.fullName || '',
      bio: profile.bio || '',
      avatar: profile.avatar || '',
    }
  }
}
