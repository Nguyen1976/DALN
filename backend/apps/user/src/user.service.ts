import { S3StorageService } from '@app/storage-s3'
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
import type { UserUpdatedPayload } from 'libs/constant/rmq/payload'
import { PrismaService } from 'apps/user/prisma/prisma.service'
import { enqueueOutbox } from '@app/saga'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'
import {
  buildTrigger,
  SAGA_ROUTING,
  SAGA_STEP,
  SAGA_TYPE,
  type FriendshipAcceptTriggerPayload,
} from 'libs/constant/rmq/saga'
import {
  AuthSession,
  FriendRequest,
  FriendRequestDetail,
  FriendRequestView,
  FriendView,
  PublicProfile,
  RequestPerson,
  SessionUser,
  toSessionUser,
  toUserSummary,
  UserProfile,
  UserSummary,
} from './domain/user.domain'
import { RedisService } from '@app/redis/redis.service'
import type { MemberProfile } from 'libs/constant/member-profile'
import { internalFetch, serviceUrl } from '@app/common/http/internal-fetch'
import {
  buildKeysetCursor,
  parseKeysetCursor,
  toGeoPoint,
  toPage,
  type Page,
} from '@app/util'
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
  /** Ô "Thêm bạn" gửi email; thẻ gợi ý gửi username. Có một là đủ. */
  inviteeEmail?: string
  inviteeUsername?: string
}

interface RespondToFriendRequest {
  requestId: string
  /** The caller, who must be the one the request was sent to. */
  inviteeId: string
  inviteeName: string
  status: 'ACCEPTED' | 'REJECTED'
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

/** Friends a search answers with at most. */
const SEARCH_LIMIT = 20

@Injectable()
export class UserService {
  private readonly recommendationServiceUrl = serviceUrl(
    'RECOMMENDATION_SERVICE_URL',
    'http://127.0.0.1:3005',
  )

  constructor(
    private readonly userRepo: UserRepository,
    private readonly friendRequestRepo: FriendRequestRepository,
    private readonly friendShipRepo: FriendShipRepository,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(UtilService) private readonly utilService: UtilService,
    private readonly eventsPublisher: UserEventsPublisher,
    @Inject(S3StorageService)
    private readonly s3StorageService: S3StorageService,
    private readonly redisService: RedisService,
    private readonly logger: LoggerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private generateOtp(length = 6): string {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('')
  }

  /**
   * Issue and mail a registration OTP.
   *
   * Callers that can be triggered repeatedly (resend, a login against a
   * pending account) claim `claimOtpResendSlot` first — otherwise the endpoint
   * is a mail cannon anyone can aim at a third party's inbox. Registration
   * itself needs no claim: the account is being created right then.
   */
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
      userId: user.id,
      email: user.email,
      username: user.username,
      ...(user.fullName != null && user.fullName !== ''
        ? { fullName: user.fullName }
        : {}),
      ...(user.avatar ? { avatar: user.avatar } : {}),
      ...(user.bio != null && String(user.bio).trim() !== ''
        ? { bio: user.bio }
        : {}),
      location: toGeoPoint(user.location) ?? undefined,
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
    // The cooldown is claimed before the lookup so the endpoint behaves
    // identically for addresses that exist and ones that do not — neither the
    // status code nor the response time may reveal which is which.
    const waitSeconds = await this.redisService.claimOtpResendSlot(data.email)
    if (waitSeconds > 0) {
      UserErrors.otpResendTooSoon(waitSeconds)
    }

    const user = await this.userRepo.findByEmail(data.email)

    // Unknown address, or one that is already activated: answer exactly as if
    // the mail had gone out. Telling the caller "no such user" hands an
    // attacker a free account-enumeration oracle.
    if (user && !user.isActive) {
      await this.sendRegistrationOtp(user.email, user.username)
    }

    return {
      email: data.email,
      requiresOtpVerification: true,
    }
  }

  async login(data: UserLoginRequest): Promise<AuthSession> {
    const user = await this.userRepo.findByEmail(data.email)

    // An unknown address and a wrong password must be indistinguishable, so a
    // missing user falls through to the same "invalid credentials" answer
    // rather than a 404 that confirms the address is unregistered.
    const isPasswordValid = user
      ? await this.utilService.comparePassword(data.password, user.password)
      : false

    if (!user || !isPasswordValid) {
      UserErrors.invalidCredentials()
    }

    // Only now — once the caller has proven the password — is it safe to say
    // the account is pending, and to spend an email on a fresh code. The
    // cooldown keeps a login-retry loop from turning into a mail flood.
    if (!user.isActive) {
      const waitSeconds = await this.redisService.claimOtpResendSlot(user.email)
      if (waitSeconds === 0) {
        await this.sendRegistrationOtp(user.email, user.username)
      }
      UserErrors.accountNotActivated()
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

    return { user: toSessionUser(user), accessToken, refreshToken }
  }

  async getMemberProfiles(userIds: string[]): Promise<MemberProfile[]> {
    const users = await this.userRepo.findProfilesByIds(userIds)
    return users.map((user) => ({
      userId: user.id,
      username: user.username,
      fullName: user.fullName ?? null,
      avatar: user.avatar ?? null,
    }))
  }

  async getMe(userId: string): Promise<SessionUser> {
    const user = await this.userRepo.findSessionFieldsById(userId)
    if (!user) {
      UserErrors.userNotFound()
    }
    return toSessionUser(user)
  }

  /**
   * `userId`'s profile as `viewerId` sees it. The email goes only to the
   * account itself or to an accepted friend: handing it to any signed-in
   * caller for any id turns browsing into an address harvest.
   */
  async getProfile(viewerId: string, userId: string): Promise<PublicProfile> {
    const user = await this.userRepo.findSummaryById(userId)
    if (!user) {
      UserErrors.userNotFound()
    }
    const { email, username, fullName, avatar, bio } = toUserSummary(user)
    const canSeeContact =
      viewerId === userId ||
      Boolean(
        await this.friendShipRepo.findFriendshipBetweenUsers(viewerId, userId),
      )
    return {
      ...(canSeeContact ? { email } : {}),
      username,
      fullName,
      avatar,
      bio,
    }
  }

  async makeFriend(data: MakeFriendRequest): Promise<FriendRequest> {
    // Thẻ gợi ý gửi username (dữ liệu gợi ý không mang email), ô "Thêm bạn" gửi email.
    const friend = data.inviteeUsername
      ? await this.userRepo.findByUsername(data.inviteeUsername)
      : await this.userRepo.findByEmail(data.inviteeEmail ?? '')
    if (!friend) {
      UserErrors.friendNotFound()
    }

    // Inviting yourself used to succeed: it created a real pending request that
    // then showed up in your own inbox, from you, waiting for you.
    if (friend.id === data.inviterId) {
      UserErrors.cannotFriendSelf()
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

    // Pressing send twice used to stack up duplicate pending requests. A
    // request already open the other way round gets its own message: the user
    // should accept it, not send a competing one.
    const pending = await this.friendRequestRepo.findPendingBetweenUsers(
      data.inviterId,
      friend.id,
    )
    if (pending.some((r) => r.fromUserId === data.inviterId)) {
      UserErrors.friendRequestAlreadyPending()
    }
    if (pending.length) {
      UserErrors.friendRequestAwaitingYourResponse()
    }

    const friendRequest = await this.friendRequestRepo.create({
      fromUserId: data.inviterId,
      toUserId: friend.id,
    })

    this.eventsPublisher.publishUserMakeFriend({
      friendRequestId: friendRequest.id,
      inviterId: data.inviterId,
      inviterName: data.inviterName,
      // Email thật của người nhận: gửi theo username thì request không có email.
      inviteeEmail: friend.email,
      inviteeName: friend.username,
      inviteeId: friend.id,
    })

    return friendRequest
  }

  /** The recipient accepts or declines a pending request. */
  async respondToFriendRequest(data: RespondToFriendRequest): Promise<void> {
    const request = await this.friendRequestRepo.findById(data.requestId)
    // Only the recipient may answer; anyone else gets "not found", as for an
    // id that does not exist.
    if (!request || request.toUserId !== data.inviteeId) {
      UserErrors.friendRequestNotFound()
    }
    if (request.status !== Status.PENDING) {
      UserErrors.friendRequestAlreadyResponded()
    }
    const inviterId = request.fromUserId
    const { inviteeId, inviteeName } = data

    if (data.status === Status.ACCEPTED) {
      // Both people, for the saga's direct conversation.
      const members = await this.getMemberProfiles([inviterId, inviteeId])

      // Atomic: cập nhật trạng thái + tạo friendship 2 chiều + ghi trigger saga
      // vào outbox trong CÙNG 1 transaction. Relay sẽ publish trigger sau đó.
      //
      // The PENDING check above is only advisory: two accepts arriving together
      // both read PENDING and both used to run this block, creating four
      // friendship rows and firing the saga twice. The conditional updateMany
      // below is the real gate — exactly one caller can flip a PENDING request
      // to ACCEPTED, and everyone else sees count 0 and backs out.
      let alreadyHandled = false
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.friendRequest.updateMany({
          where: { id: request.id, status: Status.PENDING },
          data: { status: Status.ACCEPTED },
        })

        if (claimed.count === 0) {
          alreadyHandled = true
          return
        }

        // Re-check inside the transaction: a retried request that already made
        // it this far must not leave a second copy of the relationship behind.
        const existing = await tx.friendship.findMany({
          where: {
            OR: [
              { userId: inviterId, friendId: inviteeId },
              { userId: inviteeId, friendId: inviterId },
            ],
          },
        })
        const has = (userId: string, friendId: string) =>
          existing.some((f) => f.userId === userId && f.friendId === friendId)

        if (!has(inviterId, inviteeId)) {
          await tx.friendship.create({
            data: { userId: inviterId, friendId: inviteeId },
          })
        }
        if (!has(inviteeId, inviterId)) {
          await tx.friendship.create({
            data: { userId: inviteeId, friendId: inviterId },
          })
        }

        const sagaId = `${SAGA_TYPE.FRIENDSHIP_ACCEPT}:${request.id}`
        const trigger = buildTrigger<FriendshipAcceptTriggerPayload>(
          sagaId,
          SAGA_TYPE.FRIENDSHIP_ACCEPT,
          SAGA_STEP.CREATE_CONVERSATION,
          {
            inviterId,
            inviteeId,
            inviteeName,
            friendRequestId: request.id,
            members,
          },
        )
        await enqueueOutbox(tx, {
          messageId: trigger.messageId,
          exchange: EXCHANGE_RMQ.SAGA_EVENTS,
          routingKey: SAGA_ROUTING.FRIENDSHIP_ACCEPT_REQUESTED,
          payload: trigger,
        })
      })

      if (alreadyHandled) {
        UserErrors.friendRequestAlreadyResponded()
      }
    } else {
      await this.friendRequestRepo.decline(request.id)
    }

    // Giữ event choreography cho recommendation (friend-graph) + notify REJECTED.
    // Việc tạo conversation và notify ACCEPTED đã do saga đảm nhiệm.
    this.eventsPublisher.publishUserUpdateStatusMakeFriend({
      inviterId,
      inviteeId,
      inviteeName,
      status: data.status,
    })
  }

  /** Friends in the order the friendships were made; the cursor is the last friendship's id. */
  async listFriends(
    userId: string,
    page: { limit: number; cursor?: string },
  ): Promise<Page<FriendView>> {
    const { items: friendships, nextCursor } = toPage(
      await this.friendShipRepo.findFriendsByUserId(
        userId,
        page.limit + 1,
        page.cursor,
      ),
      page.limit,
      (friendship) => friendship.id,
    )
    return {
      items: await this.withOnlineStatus(
        friendships.map((f) => toUserSummary(f.friend)),
      ),
      nextCursor,
    }
  }

  async searchFriends(userId: string, keyword: string): Promise<FriendView[]> {
    const safeKeyword = keyword?.trim()
    if (!safeKeyword) {
      return []
    }

    const friends = await this.friendShipRepo.searchFriends(
      userId,
      safeKeyword,
      SEARCH_LIMIT,
    )
    return this.withOnlineStatus(friends.map(toUserSummary))
  }

  private async withOnlineStatus(users: UserSummary[]): Promise<FriendView[]> {
    const online = await this.redisService.isOnlineBatch(
      users.map((user) => user.id),
    )
    return users.map((user) => ({ ...user, status: online.get(user.id)! }))
  }

  async listFriendRequests(
    userId: string,
    direction: 'received' | 'sent',
    page: { limit: number; cursor?: string },
  ): Promise<Page<FriendRequestView>> {
    const { items: requests, nextCursor } = toPage(
      await this.friendRequestRepo.findPending(
        direction,
        userId,
        page.limit + 1,
        parseKeysetCursor(page.cursor),
      ),
      page.limit,
      (request) => buildKeysetCursor(request.createdAt, request.id),
    )
    // The interesting person differs by direction: for a received request it is
    // whoever sent it, for a sent one it is whoever is being waited on.
    const items = requests.map((request) => ({
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      counterpart: toRequestPerson(
        direction === 'sent' ? request.toUser : request.fromUser,
      ),
    }))
    return { items, nextCursor }
  }

  async detailMakeFriend(
    friendRequestId: string,
    userId: string,
  ): Promise<FriendRequestDetail> {
    const friendRequest =
      await this.friendRequestRepo.findWithSender(friendRequestId)
    // Chỉ người nhận xem được: link "Xem lời mời" trong email mang sẵn id, và
    // phản hồi có email người gửi. Người khác nhận "không tìm thấy" như id sai.
    if (!friendRequest || friendRequest.toUserId !== userId) {
      UserErrors.friendRequestNotFound()
    }

    return {
      id: friendRequest.id,
      toUserId: friendRequest.toUserId,
      status: friendRequest.status,
      createdAt: friendRequest.createdAt,
      updatedAt: friendRequest.updatedAt,
      counterpart: toRequestPerson(friendRequest.fromUser),
    }
  }

  private async fetchAllowedInterestSlugs(): Promise<Set<string>> {
    let tags: { slug: string }[]
    try {
      tags = await internalFetch<{ slug: string }[]>(
        `${this.recommendationServiceUrl}/recommendation/interest-tags`,
        { timeoutMs: 8_000 },
      )
    } catch {
      UserErrors.recommendationCatalogUnavailable()
    }
    return new Set(tags.map((tag) => tag.slug).filter(Boolean))
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

    const unique = [...new Set(data.slugs.map((s) => s.trim()).filter(Boolean))]

    // Skipping is a legitimate outcome: the step exists to improve friend
    // suggestions, not to gate the app. An empty selection marks the step done
    // with no interests, and the user can set them later from their profile.
    let filtered: string[] = []
    if (unique.length) {
      const allowed = await this.fetchAllowedInterestSlugs()
      filtered = unique.filter((slug) => allowed.has(slug))

      // Slugs were sent but none of them are real — that is a bad request, not
      // a skip, so it still fails loudly.
      if (!filtered.length) {
        UserErrors.invalidInterestSelection()
      }
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

      avatarUrl = await this.s3StorageService.upload({
        buffer: data.avatar,
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

    const updatedPayload: UserUpdatedPayload = { userId: user.id }
    if (data.fullName !== undefined) {
      updatedPayload.fullName = data.fullName
    }
    if (data.bio !== undefined) {
      updatedPayload.bio = user.bio ?? ''
    }
    if (avatarUrl) {
      updatedPayload.avatar = avatarUrl
    }
    // The recommendation service re-embeds the bio when this event lands;
    // the request no longer waits on (or duplicates) that work.
    this.eventsPublisher.publishUserUpdated(updatedPayload)

    return {
      fullName: user.fullName ?? '',
      bio: user.bio ?? '',
      avatar: user.avatar ?? '',
    }
  }

  async handleUserOnline(userId: string): Promise<void> {
    const friends = await this.friendShipRepo.findAllFriendsByUserId(userId)
    await this.userRepo.updateLastSeen(userId, null)

    const user = await this.userRepo.findSummaryById(userId)
    if (!user || !friends.length) return
    this.eventsPublisher.publisherUserOnline({
      userIds: friends.map((f) => f.friendId),
      friend: { ...toUserSummary(user), status: true },
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

function toRequestPerson(
  user: Parameters<typeof toUserSummary>[0],
): RequestPerson {
  const { id, email, username, fullName, avatar } = toUserSummary(user)
  return { id, email, username, fullName, avatar }
}
