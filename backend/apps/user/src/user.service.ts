import { StorageR2Service } from '@app/storage-r2'
import { UtilService } from '@app/util/util.service'
import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { lookup } from 'mime-types'
import { LoggerService } from '@app/logger'
import {
  UserRepository,
  FriendRequestRepository,
  FriendShipRepository,
} from './repositories'
import { UserErrors } from './errors/user.errors'
import { UserEventsPublisher } from './rmq/publishers/user-events.publisher'
import {
  AuthSession,
  UserEntity,
  Friendship,
  FriendRequestDetail,
  UserProfile,
} from './domain/user.domain'
import { RedisService } from '@app/redis/redis.service'
import { Status } from '../src/generated'

// Type definitions for service methods
interface UserRegisterRequest {
  email: string
  username: string
  password: string
  location?: {
    lat: number
    lon: number
  }
}

interface UserLoginRequest {
  email: string
  password: string
}

interface VerifyOtpRequest {
  email: string
  otp: string
}

interface ResendOtpRequest {
  email: string
}

interface MakeFriendRequest {
  inviterId: string
  inviterName: string
  inviteeEmail: string
}

interface UpdateStatusRequest {
  inviteeId: string
  inviteeName: string
  status: Status
  inviterId: string
}

interface UpdateProfileRequest {
  userId: string
  fullName?: string
  bio?: string
  avatar?: Buffer
  avatarFilename?: string
}

interface CompleteInterestOnboardingRequest {
  userId: string
  slugs: string[]
}

@Injectable()
export class UserService {
  private readonly recommendationServiceUrl =
    process.env.RECOMMENDATION_SERVICE_URL ?? 'http://127.0.0.1:3005'
  private readonly embeddingServiceBaseUrl = (
    process.env.EMBEDDING_SERVICE_URL ?? 'http://127.0.0.1:8000'
  ).replace(/\/$/, '')

  constructor(
    private readonly userRepo: UserRepository,
    private readonly friendRequestRepo: FriendRequestRepository,
    private readonly friendShipRepo: FriendShipRepository,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(UtilService) private readonly utilService: UtilService,
    private readonly eventsPublisher: UserEventsPublisher,
    @Inject(StorageR2Service)
    private readonly storageR2Service: StorageR2Service,
    private readonly redisService: RedisService,
    private readonly logger: LoggerService,
  ) {}

  private generateOtp(length = 6): string {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('')
  }

  /** Fire-and-forget: embedding-service updates Mongo `profile_vector` + Qdrant `user_bios`. */
  private notifyEmbeddingServiceBio(userId: string, bio: string): void {
    const url = `${this.embeddingServiceBaseUrl}/embed-and-save`
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        users: [{ id: userId, bio: bio || '', age: 0 }],
      }),
    }).catch((err: unknown) => {
      this.logger.error('[user] embed-and-save notify failed', String(err))
    })
  }

  private async sendRegistrationOtp(
    email: string,
    username: string,
  ): Promise<void> {
    const otp = this.generateOtp()
    await this.redisService.saveOTP(email, otp)
    this.eventsPublisher.publishUserRegisterOtp({
      email,
      username,
      otp,
    })
  }

  async register(data: UserRegisterRequest): Promise<{
    email: string
    requiresOtpVerification: boolean
  }> {
    this.logger.info('[user.register] service entry', {
      email: data.email,
      username: data.username,
      hasLocation: Boolean(data.location),
      location: data.location ?? null,
    })

    const existingUser = await this.userRepo.findByEmail(data.email)
    this.logger.info('[user.register] existing user lookup', {
      email: data.email,
      found: Boolean(existingUser),
      isActive: existingUser?.isActive ?? null,
    })

    if (existingUser?.isActive) {
      UserErrors.emailAlreadyExists()
    }

    const existingUsername = await this.userRepo.findByUsername(data.username)
    this.logger.info('[user.register] existing username lookup', {
      username: data.username,
      found: Boolean(existingUsername),
      sameEmail: existingUsername?.email === data.email,
    })

    if (existingUsername && existingUsername.email !== data.email) {
      UserErrors.usernameAlreadyExists()
    }

    const hashedPassword = await this.utilService.hashPassword(data.password)
    this.logger.info('[user.register] password hashed', {
      email: data.email,
      hasLocation: Boolean(data.location),
    })

    const user = existingUser
      ? await this.userRepo.updateRegisterInfoByEmail({
          email: data.email,
          username: data.username,
          password: hashedPassword,
          location: data.location,
        })
      : await this.userRepo.create({
          email: data.email,
          username: data.username,
          password: hashedPassword,
          location: data.location,
        })

    this.logger.info('[user.register] persistence finished', {
      userId: user.id,
      email: user.email,
      username: user.username,
      location: user.location ?? null,
    })

    await this.sendRegistrationOtp(user.email, user.username)

    this.logger.info('[user.register] otp queued', {
      email: user.email,
      username: user.username,
    })

    return {
      email: user.email,
      requiresOtpVerification: true,
    }
  }

  async verifyRegistrationOtp(
    data: VerifyOtpRequest,
  ): Promise<{ success: true }> {
    const currentOtp = await this.redisService.getOTP(data.email)
    if (!currentOtp || currentOtp !== data.otp) {
      UserErrors.otpInvalidOrExpired()
    }

    const user = await this.userRepo.findByEmail(data.email)
    if (!user) {
      UserErrors.userNotFound()
    }

    await this.userRepo.activateByEmail(data.email)
    await this.redisService.deleteOTP(data.email)

    this.eventsPublisher.publishUserCreated({
      id: user.id,
      email: user.email,
      username: user.username,
      location: (() => {
        const location = user.location as
          | { lat?: number; lon?: number; coordinates?: [number, number] }
          | undefined

        if (!location) {
          return undefined
        }

        if (
          typeof location.lat === 'number' &&
          typeof location.lon === 'number'
        ) {
          return { lat: location.lat, lon: location.lon }
        }

        if (
          Array.isArray(location.coordinates) &&
          typeof location.coordinates[0] === 'number' &&
          typeof location.coordinates[1] === 'number'
        ) {
          return { lat: location.coordinates[1], lon: location.coordinates[0] }
        }

        return undefined
      })(),
    })

    this.logger.info('[user.verify-otp] user created event published', {
      userId: user.id,
      email: user.email,
      location: user.location ?? null,
    })

    return { success: true }
  }

  async resendRegistrationOtp(data: ResendOtpRequest): Promise<{
    email: string
    requiresOtpVerification: boolean
  }> {
    const user = await this.userRepo.findByEmail(data.email)

    if (!user) {
      UserErrors.userNotFound()
    }

    if (user.isActive) {
      UserErrors.emailAlreadyExists()
    }

    await this.sendRegistrationOtp(user.email, user.username)

    return {
      email: user.email,
      requiresOtpVerification: true,
    }
  }

  async login(data: UserLoginRequest): Promise<AuthSession> {
    const user = await this.userRepo.findByEmail(data.email)
    if (!user) {
      UserErrors.userNotFound()
    }

    if (!user.isActive) {
      await this.sendRegistrationOtp(user.email, user.username)
      UserErrors.accountNotActivated()
    }

    const isPasswordValid = await this.utilService.comparePassword(
      data.password,
      user.password,
    )

    if (!isPasswordValid) {
      UserErrors.invalidCredentials()
    }

    const payload = {
      userId: user.id,
      email: user.email,
      username: user.username,
    }

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    })

    // refresh token
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    })

    return {
      userId: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      avatar: user.avatar,
      bio: user.bio,
      interests: user.interests ?? [],
      hasCompletedInterestOnboarding:
        user.hasCompletedInterestOnboarding ?? true,
      accessToken,
      refreshToken,
    }
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findSessionFieldsById(userId)
    if (!user) {
      UserErrors.userNotFound()
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName ?? '',
      avatar: user.avatar ?? '',
      bio: user.bio ?? '',
      interests: user.interests ?? [],
      hasCompletedInterestOnboarding:
        user.hasCompletedInterestOnboarding ?? true,
    }
  }

  async getUserById(userId: string): Promise<UserEntity> {
    const user = await this.userRepo.findByIdWithSelect(userId)
    if (!user) {
      UserErrors.userNotFound()
    }
    return user as UserEntity
  }

  async makeFriend(data: MakeFriendRequest): Promise<Friendship> {
    const friend = await this.userRepo.findByEmail(data.inviteeEmail)
    if (!friend) {
      UserErrors.friendNotFound()
    }

    //check xem đã là bạn bè chưa
    const existingFriendship =
      await this.friendShipRepo.findFriendshipBetweenUsers(
        data.inviterId,
        friend.id,
      )

    if (existingFriendship) {
      UserErrors.alreadyFriends()
    }

    const friendRequest = await this.friendRequestRepo.create({
      fromUserId: data.inviterId,
      toUserId: friend.id,
    })

    this.eventsPublisher.publishUserMakeFriend({
      friendRequestId: friendRequest.id,
      inviterId: data.inviterId,
      inviterName: data.inviterName,
      inviteeEmail: data.inviteeEmail,
      inviteeName: friend.username,
      inviteeId: friend.id,
    })

    return friendRequest
  }

  async updateStatusMakeFriend(data: UpdateStatusRequest): Promise<Friendship> {
    const friendRequests = await this.friendRequestRepo.findByUsers(
      data.inviterId,
      data.inviteeId,
    )

    //sửa logic tìm tắt cả friendrequest sau đó check chỉ cần có 1 cái pending thì cho qua còn nếu không thì mới trả về lỗi

    if (friendRequests.length === 0) {
      UserErrors.friendRequestNotFound()
    }

    if (!friendRequests.some((r) => r.status === Status.PENDING)) {
      UserErrors.friendRequestAlreadyResponded()
    }

    await this.friendRequestRepo.updateStatus(
      data.inviterId,
      data.inviteeId,
      data.status as Status,
    )

    const updatedRequest = await this.friendRequestRepo.findByUsers(
      data.inviterId,
      data.inviteeId,
    )

    let inviterUpdate
    let inviteeUpdate

    if (data.status === Status.ACCEPTED) {
      await this.friendShipRepo.create({
        userId: data.inviterId,
        friendId: data.inviteeId,
      })
      await this.friendShipRepo.create({
        userId: data.inviteeId,
        friendId: data.inviterId,
      })
      inviterUpdate = await this.userRepo.findById(data.inviterId)
      inviteeUpdate = await this.userRepo.findById(data.inviteeId)
    }

    this.eventsPublisher.publishUserUpdateStatusMakeFriend({
      inviterId: data.inviterId,
      inviteeId: data.inviteeId,
      inviteeName: data.inviteeName,
      status: data.status,
      members: [
        {
          userId: data.inviterId,
          username: inviterUpdate?.username || '',
          avatar: inviterUpdate?.avatar || '',
          fullName: inviterUpdate?.fullName || '',
        },
        {
          userId: data.inviteeId,
          username: inviteeUpdate?.username || '',
          avatar: inviteeUpdate?.avatar || '',
          fullName: inviteeUpdate?.fullName || '',
        },
      ],
    })

    return updatedRequest as unknown as Friendship
  }

  async listFriends(
    userId: string,
    limit = 10,
    page = 1,
  ): Promise<(UserEntity & { status: boolean })[]> {
    const friendships = await this.friendShipRepo.findFriendsByUserId(
      userId,
      limit,
      page,
    )

    if (!friendships) {
      UserErrors.userNotFound()
    }

    const friends = await this.userRepo.findManyByIds(
      friendships.map((f) => f.friendId) || [],
    )

    const friendsWithStatus = await Promise.all(
      friends.map(async (f) => ({
        ...f,
        status: await this.redisService.isOnline(f.id),
      })),
    )

    return friendsWithStatus as (UserEntity & { status: boolean })[]
  }

  async searchFriends(
    userId: string,
    keyword: string,
  ): Promise<(UserEntity & { status: boolean })[]> {
    const safeKeyword = keyword?.trim()
    if (!safeKeyword) {
      return []
    }

    const friendships = await this.friendShipRepo.findAllFriendsByUserId(userId)
    if (!friendships.length) {
      return []
    }

    const friends = await this.userRepo.findManyByIdsAndUsername(
      friendships.map((f) => f.friendId),
      safeKeyword,
    )

    const friendsWithStatus = await Promise.all(
      friends.map(async (friend) => ({
        ...friend,
        status: await this.redisService.isOnline(friend.id),
      })),
    )

    return friendsWithStatus as (UserEntity & { status: boolean })[]
  }

  async listFriendRequests(
    userId: string,
    limit = 10,
    page = 1,
  ): Promise<any[]> {
    const requests = await this.friendRequestRepo.findPendingByToUserId(
      userId,
      limit,
      page,
    )

    if (!requests.length) {
      return []
    }

    const fromUserIds = [
      ...new Set(requests.map((request) => request.fromUserId)),
    ]
    const fromUsers = await this.userRepo.findManyByIds(fromUserIds)
    const userMap = new Map(
      fromUsers.map((fromUser) => [fromUser.id, fromUser]),
    )

    return requests
      .map((request) => {
        const fromUser = userMap.get(request.fromUserId)
        if (!fromUser) {
          return null
        }

        return {
          ...request,
          fromUser,
        }
      })
      .filter(Boolean)
  }

  async detailMakeFriend(
    friendRequestId: string,
  ): Promise<FriendRequestDetail> {
    const friendRequest = await this.friendRequestRepo.findById(friendRequestId)
    if (!friendRequest) {
      UserErrors.friendRequestNotFound()
    }

    const fromUser = await this.userRepo.findByIdWithSelect(
      friendRequest.fromUserId,
    )

    return {
      ...friendRequest,
      fromUser: fromUser as any,
    }
  }

  private async fetchAllowedInterestSlugs(): Promise<Set<string>> {
    const base = this.recommendationServiceUrl.replace(/\/$/, '')
    const url = `${base}/recommendation/interest-tags`
    let res: globalThis.Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    } catch {
      UserErrors.recommendationCatalogUnavailable()
    }
    if (!res.ok) {
      UserErrors.recommendationCatalogUnavailable()
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      UserErrors.recommendationCatalogUnavailable()
    }
    const rows = (body as { data?: unknown })?.data
    if (!Array.isArray(rows)) {
      UserErrors.recommendationCatalogUnavailable()
    }
    return new Set(
      rows
        .map((r) =>
          typeof (r as { slug?: string })?.slug === 'string'
            ? (r as { slug: string }).slug
            : '',
        )
        .filter(Boolean),
    )
  }

  async completeInterestOnboarding(
    data: CompleteInterestOnboardingRequest,
  ): Promise<{
    interests: string[]
    hasCompletedInterestOnboarding: boolean
  }> {
    const user = await this.userRepo.findById(data.userId)
    if (!user) {
      UserErrors.userNotFound()
    }

    if (user.hasCompletedInterestOnboarding === true) {
      UserErrors.interestOnboardingAlreadyCompleted()
    }

    const allowed = await this.fetchAllowedInterestSlugs()
    const unique = [...new Set(data.slugs.map((s) => s.trim()).filter(Boolean))]
    const filtered = unique.filter((slug) => allowed.has(slug))

    if (!filtered.length) {
      UserErrors.invalidInterestSelection()
    }

    const updated = await this.userRepo.completeInterestOnboarding(
      data.userId,
      filtered,
    )

    this.eventsPublisher.publishUserInterestsUpdated({
      userId: data.userId,
      interests: filtered,
    })

    return {
      interests: updated.interests ?? [],
      hasCompletedInterestOnboarding: Boolean(
        updated.hasCompletedInterestOnboarding,
      ),
    }
  }

  async updateProfile(data: UpdateProfileRequest): Promise<UserProfile> {
    let avatarUrl = ''
    if (data.avatar && data.avatarFilename) {
      const mime =
        lookup(data.avatarFilename || '') || 'application/octet-stream'

      avatarUrl = await this.storageR2Service.upload({
        buffer: data.avatar as Buffer,
        mime: mime,
        folder: 'avatars',
        ext: data.avatarFilename?.split('.').pop() || 'bin',
      })
    }

    const user = await this.userRepo.updateProfile(data.userId, {
      fullName: data.fullName,
      bio: data.bio,
      avatar: avatarUrl,
    })

    this.eventsPublisher.publishUserUpdated({
      userId: user.id,
      fullName: data.fullName || undefined,
      avatar: avatarUrl || undefined,
      bio: user.bio ?? undefined,
    })

    if (data.bio !== undefined) {
      this.notifyEmbeddingServiceBio(user.id, user.bio ?? '')
    }

    return {
      fullName: user.fullName,
      bio: user.bio,
      avatar: avatarUrl || user.avatar,
    }
  }

  async handleUserOnline(userId: string): Promise<void> {
    const friends = await this.friendShipRepo.findAllFriendsByUserId(userId)
    const friendIds = friends.map((f) => f.friendId)

    await this.userRepo.updateLastSeen(userId, null)
    this.eventsPublisher.publisherUserOnline({
      userIds: friendIds,
      userId,
    })
  }

  async handleUserOffline(userId: string, lastSeen: string): Promise<void> {
    const friends = await this.friendShipRepo.findAllFriendsByUserId(userId)
    const friendIds = friends.map((f) => f.friendId)

    await this.userRepo.updateLastSeen(userId, lastSeen)

    this.eventsPublisher.publisherUserOffline({
      userIds: friendIds,
      userId,
      lastSeen,
    })
  }
}
