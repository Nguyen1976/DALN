import { createHash, randomBytes, randomInt } from 'node:crypto'
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
  RefreshResult,
  SessionListItem,
  RequestPerson,
  SessionUser,
  toSessionUser,
  toUserSummary,
  UserProfile,
  UserSummary,
} from './domain/user.domain'
import { RedisService } from '@app/redis/redis.service'
import { maskEmail } from './domain/mask-email'
import type { MemberProfile } from 'libs/constant/member-profile'
import { internalFetch, serviceUrl } from '@app/common/http/internal-fetch'
import {
  ACCESS_TOKEN_TTL,
  ACCESS_TOKEN_TYPE,
  SessionStore,
  type SessionMeta,
} from '@app/common'
import {
  buildKeysetCursor,
  parseKeysetCursor,
  toGeoPoint,
  toPage,
  type Page,
} from '@app/util'
import { Status } from '../src/generated'

/**
 * Khoá tài khoản: 10 lần sai trong 15 phút.
 *
 * Đếm theo TÀI KHOẢN chứ không theo IP, vì tấn công thật là nhiều IP dội vào
 * một tài khoản. Đánh đổi đã biết: nó mở ra khả năng làm khó một tài khoản cụ
 * thể, nhưng đổi lại là chặn được dò mật khẩu phân tán — và OWASP chọn chiều
 * này. Đăng nhập đúng sẽ xoá bộ đếm nên người dùng thật gần như không gặp.
 */
const LOGIN_LOCKOUT_THRESHOLD = 10
const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60

/**
 * Hash bcrypt của một chuỗi cố định, chỉ dùng để nhánh "email không tồn tại"
 * tốn đúng lượng CPU như nhánh có thật. Không phải bí mật.
 */
const TIMING_EQUALIZER_HASH =
  '$2b$10$DTB0fFg1DxGu3WT4mxauuOLWB0Xd7LbWwTW0aD5HohFytr3JFbvMS'

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

interface ForgotPasswordRequest {
  email: string
  /** IP người gọi, nếu xác định được. Xem `forgotPassword`. */
  ip?: string
}

interface ResetPasswordRequest {
  token: string
  password: string
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

/** Liên kết đặt lại mật khẩu sống bao lâu. Khớp TTL của key trong Redis. */
const PASSWORD_RESET_TTL_MINUTES = 15

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
    private readonly sessions: SessionStore,
  ) {}

  /**
   * Mã OTP từ nguồn ngẫu nhiên MẬT MÃ.
   *
   * `Math.random()` không phải CSPRNG: trạng thái của nó suy ra được từ vài
   * giá trị đã phát, nên mã tiếp theo là đoán được thay vì phải dò. Token đặt
   * lại mật khẩu trong cùng file này đã dùng `randomBytes` và có comment giải
   * thích đúng điều đó — mã kích hoạt tài khoản không có lý do gì yếu hơn.
   */
  private generateOtp(length = 6): string {
    return Array.from({ length }, () => randomInt(0, 10)).join('')
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
    const matches = await this.redisService.verifyOTP(data.email, data.otp)
    if (!matches) {
      // Sai thì TỐN một lượt. Không có bước này thì cả không gian 10^6 mở
      // trong 5 phút và mỗi lần đoán sai không mất gì cả.
      const burned = await this.redisService.claimOtpAttempt(data.email)
      if (burned) {
        this.logger.warn('[user.verify-otp] vượt số lần thử, đã huỷ mã', {
          email: maskEmail(data.email),
        })
      }
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

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /**
   * Sinh token đặt lại mật khẩu.
   *
   * `randomBytes` chứ không phải `Math.random`: cái sau không phải bộ sinh số
   * ngẫu nhiên mật mã — trạng thái nội bộ của nó khôi phục được từ vài giá trị
   * đầu ra, và đoán được trạng thái là đoán được mọi token sinh sau đó.
   *
   * `base64url` chứ không phải `hex` hay `base64`: bảng chữ cái của nó không có
   * ký tự nào `encodeURIComponent` phải mã hoá, nên token vào URL nguyên vẹn;
   * và 32 byte chỉ tốn 43 ký tự thay vì 64 như hex.
   */
  private generateResetToken(): string {
    return randomBytes(32).toString('base64url')
  }

  /**
   * Gửi liên kết đặt lại mật khẩu.
   *
   * KHÔNG BAO GIỜ ném lỗi và không bao giờ trả về gì khác nhau. Mọi nhánh —
   * email lạ, tài khoản chưa kích hoạt, đang cooldown, vượt hạn mức — đều kết
   * thúc bằng `return` im lặng, để người gọi không phân biệt được địa chỉ nào
   * có tài khoản.
   *
   * Thứ tự các bước là một phần của bảo đảm đó: claim trước, tra sau. Tra cơ
   * sở dữ liệu rồi mới claim thì hai nhánh tiêu tốn số thao tác khác nhau và
   * thời gian phản hồi tố cáo sự khác biệt.
   */
  async forgotPassword(data: ForgotPasswordRequest): Promise<void> {
    try {
      // Không dựng được IP nào thì bỏ qua lớp này thay vì chặn: cooldown theo
      // email mới là lớp bảo vệ chính và nó không phụ thuộc IP.
      //
      // Lưu ý: nhánh này KHÔNG cứu được trường hợp `trust proxy` cấu hình sai —
      // lúc đó mọi request đều mang cùng một IP nội bộ của Kong, `data.ip` vẫn
      // có giá trị, và hạn mức biến thành trần toàn cục 10 lần/giờ cho cả hệ
      // thống. Chỉ kiểm tra key `pwdreset:ip:*` sau khi triển khai mới phát hiện
      // được, nên đừng bỏ bước đó.
      if (
        data.ip &&
        !(await this.redisService.claimPasswordResetIpSlot(data.ip))
      ) {
        this.logger.warn('[user.forgot-password] ip rate limit hit', {
          ip: data.ip,
        })
        return
      }

      // Cooldown 60s theo địa chỉ: chặn dội bom một hộp thư.
      if (!(await this.redisService.claimPasswordResetSlot(data.email))) return

      // Trần tổng số theo địa chỉ: cooldown ở trên chỉ chặn được TẦN SUẤT,
      // không chặn TỔNG SỐ (rải đều một mail/phút suốt cả giờ vẫn lọt).
      //
      // Đặt SAU cooldown chứ không trước — cố ý, đây từng là lỗi. Đặt trước
      // thì một request bị cooldown chặn (không gửi mail nào) vẫn tiêu một
      // slot của trần này, biến "trần mail mỗi giờ" thành "trần request mỗi
      // giờ": chỉ vài cú bấm "Gửi lại" liên tiếp trong lúc cooldown còn hiệu
      // lực — thứ UI hiện tại cho phép, vì nút "Dùng email khác" quay lại form
      // mà không kiểm tra cooldown — đủ để khoá tài khoản khỏi đường khôi
      // phục cả tiếng, dù chỉ đúng một mail thật sự được gửi.
      if (!(await this.redisService.claimPasswordResetHourlySlot(data.email))) {
        this.logger.warn('[user.forgot-password] hourly rate limit hit', {
          // Không log email thô: đây là dữ liệu cá nhân, khác IP ở nhánh trên.
          email: maskEmail(data.email),
        })
        return
      }

      const user = await this.userRepo.findByEmail(data.email)

      // Tài khoản chưa kích hoạt thuộc về luồng verify-otp: gửi liên kết đặt lại
      // mật khẩu cho một tài khoản chưa bao giờ mở là vô nghĩa.
      if (!user || !user.isActive) return

      const token = this.generateResetToken()
      await this.redisService.savePasswordResetToken(
        user.email,
        user.id,
        this.hashResetToken(token),
      )

      this.eventsPublisher.publishUserPasswordReset({
        email: user.email,
        username: user.username,
        token,
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
      })
    } catch (error) {
      // Hạ tầng lỗi cũng phải im lặng như mọi nhánh khác. savePasswordResetToken
      // chỉ chạy cho tài khoản có thật và đã kích hoạt, nên để exception thoát ra
      // là biến một sự cố Redis thành tín hiệu "địa chỉ này có tài khoản".
      this.logger.error(
        '[user.forgot-password] failed',
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  /**
   * Kiểm tra liên kết còn sống không, KHÔNG tiêu thụ nó.
   *
   * Tồn tại để trang đặt lại mật khẩu phân biệt được liên kết hỏng trước khi
   * bắt người dùng gõ xong mật khẩu rồi mới báo lỗi.
   *
   * Trả về email đã che: ai cầm token thì đằng nào cũng sắp đổi được mật khẩu,
   * nên che một phần là đủ — mà vẫn cho họ biết đang đặt lại cho tài khoản nào.
   */
  async validatePasswordResetToken(
    token: string,
  ): Promise<{ valid: boolean; maskedEmail?: string }> {
    const userId = await this.redisService.peekPasswordResetToken(
      this.hashResetToken(token),
    )
    if (!userId) return { valid: false }

    const user = await this.userRepo.findById(userId)
    if (!user) return { valid: false }

    return { valid: true, maskedEmail: maskEmail(user.email) }
  }

  /**
   * Đặt mật khẩu mới.
   *
   * Token được tiêu thụ TRƯỚC khi ghi. `consumePasswordResetToken` dùng GETDEL
   * nên đúng một caller nhận được `userId`; ghi trước rồi mới tiêu thụ là mở
   * lại khe hở cho hai request cùng token cùng đổi được mật khẩu.
   *
   * Cố ý KHÔNG chặn đặt lại trùng mật khẩu cũ: người quên mật khẩu rồi chợt
   * nhớ ra không có lý do gì bị chặn.
   */
  async resetPassword(data: ResetPasswordRequest): Promise<void> {
    const userId = await this.redisService.consumePasswordResetToken(
      this.hashResetToken(data.token),
    )
    if (!userId) UserErrors.passwordResetTokenInvalid()

    const user = await this.userRepo.findById(userId)
    if (!user) UserErrors.passwordResetTokenInvalid()

    const hashedPassword = await this.utilService.hashPassword(data.password)
    await this.userRepo.updatePasswordById(user.id, hashedPassword)

    // Chỉ mục ngược chỉ là chỉ mục: xoá hụt cũng vô hại, nó tự hết hạn.
    await this.redisService.clearPasswordResetIndex(user.email)

    this.logger.info('[user.reset-password] password changed', {
      userId: user.id,
    })

    // Đặt lại mật khẩu mà không thu hồi phiên thì tính năng này không giành
    // lại được tài khoản: kẻ đang chiếm vẫn còn nguyên phiên của nó.
    //
    // Nhưng KHÔNG để nó làm sập cả request: mật khẩu đã ghi xong và token đặt
    // lại đã tiêu, nên ném lỗi ở đây sẽ để lại trạng thái nửa vời — người dùng
    // tưởng thất bại trong khi mật khẩu đã đổi, và cái link thì không dùng lại
    // được. Thu hồi hụt thì log to, phiên cũ sẽ chết khi hết hạn idle, và email
    // cảnh báo vẫn đi.
    try {
      await this.revokeEverySession(user.id, 'password-changed')
    } catch (error) {
      this.logger.error(
        '[user.reset-password] không thu hồi được phiên sau khi đổi mật khẩu',
        error instanceof Error ? error.message : String(error),
      )
    }

    this.eventsPublisher.publishUserPasswordChanged({
      email: user.email,
      username: user.username,
      changedAt: new Date().toISOString(),
    })
  }

  async login(
    data: UserLoginRequest,
    meta: SessionMeta = {},
  ): Promise<AuthSession> {
    // Tài khoản đang bị khoá thì trả về ĐÚNG thông điệp của mật khẩu sai.
    // OWASP yêu cầu mọi nhánh nói giống nhau: nói "đang bị khoá" là xác nhận
    // địa chỉ này có tồn tại, và biến trang đăng nhập thành máy dò tài khoản.
    if (await this.isLoginLocked(data.email)) {
      UserErrors.invalidCredentials()
    }

    const user = await this.userRepo.findByEmail(data.email)

    // An unknown address and a wrong password must be indistinguishable, so a
    // missing user falls through to the same "invalid credentials" answer
    // rather than a 404 that confirms the address is unregistered.
    //
    // Nhánh "không có user" vẫn phải chạy bcrypt: bỏ qua nó làm email chưa
    // đăng ký trả lời nhanh hơn email đã đăng ký một cách đo được, và chênh
    // lệch đó chính là câu trả lời mà thông điệp giống nhau đang cố che.
    const isPasswordValid = await this.utilService.comparePassword(
      data.password,
      user?.password ?? TIMING_EQUALIZER_HASH,
    )

    if (!user || !isPasswordValid) {
      await this.recordLoginFailure(data.email)
      UserErrors.invalidCredentials()
    }

    // Mật khẩu đã đúng: người dùng thật không được tích luỹ bộ đếm khoá.
    await this.clearLoginFailures(data.email)

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

    // Phiên có danh tính riêng (`sid`) và state ở Redis, nên thu hồi được. Đây
    // là thứ thiết kế cũ không có: hai JWT cùng secret, cùng payload, không có
    // gì để xoá nên logout chỉ xoá được cookie ở máy người tử tế.
    const { sid, refreshToken } = await this.sessions.create(user.id, meta)

    return {
      user: toSessionUser(user),
      accessToken: this.signAccessToken({
        userId: user.id,
        email: user.email,
        username: user.username,
        sid,
      }),
      refreshToken,
    }
  }

  /**
   * Khoá tài khoản sau quá nhiều lần sai, và fail-OPEN nếu Redis lỗi.
   *
   * Fail-open có chủ ý: bản thân đăng nhập đã cần Redis để tạo phiên, nên chặn
   * thêm ở đây không bảo vệ được gì mà chỉ làm lỗi khó đọc hơn.
   */
  private async isLoginLocked(email: string): Promise<boolean> {
    try {
      return (
        (await this.redisService.loginFailureCount(email)) >=
        LOGIN_LOCKOUT_THRESHOLD
      )
    } catch (error) {
      this.logger.error(
        '[user.login] không đọc được bộ đếm khoá — cho qua',
        error instanceof Error ? error.message : String(error),
      )
      return false
    }
  }

  private async recordLoginFailure(email: string): Promise<void> {
    try {
      const failures = await this.redisService.countLoginFailure(
        email,
        LOGIN_LOCKOUT_WINDOW_SECONDS,
      )
      if (failures === LOGIN_LOCKOUT_THRESHOLD) {
        this.logger.warn('[user.login] tài khoản bị khoá tạm thời', {
          email: maskEmail(email),
          failures,
          windowSeconds: LOGIN_LOCKOUT_WINDOW_SECONDS,
        })
      }
    } catch {
      /* bộ đếm lỗi không được che mất lỗi đăng nhập thật */
    }
  }

  private async clearLoginFailures(email: string): Promise<void> {
    try {
      await this.redisService.clearLoginFailures(email)
    } catch {
      /* bộ đếm tự hết hạn, xoá hụt là vô hại */
    }
  }

  /**
   * Access token luôn được ký ở đúng một chỗ.
   *
   * Trước đây TTL '15m' bị viết tay ở đây trong khi hằng số cùng tên nằm trong
   * guard, và chỉ có một dòng comment giữ cho hai chỗ khớp nhau.
   */
  private signAccessToken(claims: {
    userId: string
    email: string
    username: string
    sid: string
  }): string {
    return this.jwtService.sign(
      { ...claims, typ: ACCESS_TOKEN_TYPE },
      { expiresIn: ACCESS_TOKEN_TTL },
    )
  }

  /**
   * Làm mới phiên. Đây là chỗ DUY NHẤT cấp lại cookie — trước đây guard tự làm
   * việc này trên request bất kỳ, và chính vì thế refresh token không thể rotate.
   */
  async refreshSession(refreshCookie?: string | null): Promise<RefreshResult> {
    const outcome = await this.sessions.consume(refreshCookie)

    if (outcome.status === 'invalid') {
      return { status: 'terminated' }
    }

    // Token đã tiêu mà còn được trình lại sau cửa sổ ân hạn: có hai bên cùng
    // giữ nó. Không biết bên nào là chủ thật, nên giết cả phiên của user.
    if (outcome.status === 'replayed') {
      this.logger.warn('[user.refresh] refresh token bị dùng lại', {
        userId: outcome.userId,
        sid: outcome.sid,
      })
      // Lấy người nhận TRƯỚC khi thu hồi: cảnh báo này là thứ duy nhất cho
      // chủ tài khoản biết vì sao mình vừa bị đăng xuất, và biết rằng nên đổi
      // mật khẩu. Không tra được thì vẫn thu hồi, chỉ là không gửi mail.
      const owner = await this.userRepo
        .findSessionFieldsById(outcome.userId)
        .catch(() => null)

      // Thu hồi hụt cũng vẫn từ chối request này — hướng an toàn.
      try {
        await this.revokeEverySession(
          outcome.userId,
          'token-reuse',
          owner ? { email: owner.email, username: owner.username } : undefined,
        )
      } catch (error) {
        this.logger.error(
          '[user.refresh] không thu hồi được phiên sau khi phát hiện replay',
          error instanceof Error ? error.message : String(error),
        )
      }
      return { status: 'terminated' }
    }

    const user = await this.userRepo.findSessionFieldsById(outcome.userId)
    if (!user) {
      // Tài khoản không còn: phiên cũng không có lý do tồn tại.
      await this.sessions.revokeSession(outcome.userId, outcome.sid)
      return { status: 'terminated' }
    }

    const accessToken = this.signAccessToken({
      userId: user.id,
      email: user.email,
      username: user.username,
      sid: outcome.sid,
    })

    // Nhánh ân hạn KHÔNG trả cookie refresh mới: bản mới đã nằm ở trình duyệt
    // từ request thắng cuộc rotate, và server chỉ giữ hash nên cũng không thể
    // phát lại bản đó.
    return outcome.status === 'rotated'
      ? { status: 'rotated', accessToken, refreshToken: outcome.refreshToken }
      : { status: 'grace', accessToken }
  }

  /**
   * Đăng xuất thiết bị hiện tại.
   *
   * Idempotent theo thiết kế: cookie hỏng hay phiên đã chết thì vẫn coi như
   * xong, vì việc người dùng cần là cookie bị xoá — và controller làm việc đó
   * bất kể ở đây trả gì.
   */
  async logout(refreshCookie?: string | null): Promise<void> {
    const outcome = await this.sessions.consume(refreshCookie)
    if (outcome.status === 'invalid') return

    await this.sessions.revokeSession(outcome.userId, outcome.sid)
    this.eventsPublisher.publishSessionRevoked({
      userId: outcome.userId,
      sids: [outcome.sid],
      reason: 'logout',
    })
  }

  /**
   * Các thiết bị đang đăng nhập của chính người dùng.
   *
   * Mới nhất lên trước, và đánh dấu thiết bị đang xem — không có dấu đó thì
   * người dùng không biết dòng nào là mình và rất dễ tự đăng xuất chính mình.
   */
  async listOwnSessions(
    userId: string,
    currentSid: string,
  ): Promise<SessionListItem[]> {
    const sessions = await this.sessions.listSessions(userId)
    return sessions
      .map((session) => ({ ...session, current: session.sid === currentSid }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  /**
   * Đăng xuất một thiết bị cụ thể.
   *
   * Trả `false` khi sid không thuộc người gọi — `SessionStore` kiểm quyền sở
   * hữu bằng chính `SREM` trên chỉ mục của user, nên không có đường nào đổi
   * tham số để thu hồi phiên của người khác.
   */
  async revokeOwnSession(userId: string, sid: string): Promise<boolean> {
    const revoked = await this.sessions.revokeSession(userId, sid)
    if (!revoked) return false

    this.eventsPublisher.publishSessionRevoked({
      userId,
      sids: [sid],
      reason: 'logout',
    })
    return true
  }

  /** Đăng xuất mọi thiết bị của chính mình. */
  async logoutAll(userId: string): Promise<void> {
    await this.revokeEverySession(userId, 'logout-all')
  }

  /**
   * Xoá mọi phiên của một user rồi báo cho gateway ngắt socket.
   *
   * Không có bước publish thì thu hồi chỉ có hiệu lực với HTTP: socket đã bắt
   * tay xong vẫn nhận tin nhắn, vì nó chỉ được xác thực một lần lúc handshake.
   */
  private async revokeEverySession(
    userId: string,
    reason: 'logout-all' | 'password-changed' | 'token-reuse',
    recipient?: { email: string; username: string },
  ): Promise<void> {
    const sids = await this.sessions.revokeAllForUser(userId)
    if (!sids.length) return

    this.eventsPublisher.publishSessionRevoked({
      userId,
      sids,
      reason,
      revokedAt: new Date().toISOString(),
      ...(recipient ? { recipient } : {}),
    })
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
