import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  NotFoundException,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { UserService } from '../user.service'
import {
  InternalOnly,
  RequireLogin,
  UserInfo,
  WithoutLogin,
} from '@app/common/common.decorator'
import { RateLimit } from '@app/common/http/rate-limit'
import { LoggerService } from '@app/logger'
import {
  ForgotPasswordDto,
  LoginUserDto,
  MakeFriendDto,
  MakeFriendByUsernameDto,
  ResendOtpDto,
  ResetPasswordDto,
  ChangePasswordDto,
  RevokeSessionDto,
  RegisterUserDto,
  UpdateProfileDto,
  RespondFriendRequestDto,
  FriendRequestParamsDto,
  ValidateResetTokenQueryDto,
  VerifyOtpDto,
  CompleteInterestOnboardingDto,
  FriendRequestsQueryDto,
  MemberProfilesDto,
  ProfileQueryDto,
} from './user-http.dto'
import { PageQueryDto } from '@app/common/http/page-query.dto'
import type { MultipartFile } from '@app/common/http/multipart-file'
import { readCookie, type JwtPayload } from '@app/common/auth/resolve-tokens'
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  refreshCookiePath,
  REFRESH_TOKEN_MAX_AGE_MS,
  isSecureCookie,
} from '@app/common/auth/session.constants'
import { SessionStoreUnavailableError } from '@app/common/auth/session.store'
import type { RefreshResult } from '../domain/user.domain'

/**
 * Session cookie attributes, shared by login, refresh and logout.
 *
 * `secure: true` unconditionally used to be set here: browsers make an
 * exception for http://localhost so it appeared to work, but any other plain
 * HTTP origin (a LAN address used to test from a phone, a staging box) would
 * have silently dropped the cookie and left login looking broken.
 *
 * Hai cookie giờ có `path` KHÁC nhau, nên `clearCookie` phải dùng đúng bộ
 * thuộc tính của từng cái — sai path là xoá không trúng, và cookie cũ nằm lại
 * bên cạnh cookie mới.
 */
const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isSecureCookie(),
  sameSite: 'lax',
} as const

/** Access token phải đi cùng mọi request, tới mọi service. */
const ACCESS_COOKIE_OPTIONS = { ...BASE_COOKIE_OPTIONS, path: '/' } as const

/** Refresh token chỉ cần tới user-service — xem `refreshCookiePath`. */
const REFRESH_COOKIE_OPTIONS = {
  ...BASE_COOKIE_OPTIONS,
  path: refreshCookiePath(),
} as const

@Controller('user')
export class UserHttpController {
  constructor(
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {}

  @Post('register')
  /** Đăng ký là đường gửi mail: không có trần thì nó là một máy phát thư rác. */
  @RateLimit({ bucket: 'register', limit: 20, windowSeconds: 3600, by: ['ip'] })
  @WithoutLogin()
  async register(@Body() dto: RegisterUserDto) {
    this.logger.info('[user.register] controller received dto', {
      email: dto.email,
      username: dto.username,
      hasLocation: Boolean(dto.location),
      location: dto.location ?? null,
    })

    const registration = await this.userService.register(dto)

    this.logger.info('[user.register] controller completed', {
      email: registration.email,
      requiresOtpVerification: registration.requiresOtpVerification,
    })

    return {
      email: registration.email,
      requiresOtpVerification: registration.requiresOtpVerification,
    }
  }

  @Post('verify-otp')
  /** Chặn dò mã: cùng với bộ đếm 5 lần thử, không gian 10^6 không còn mở. */
  @RateLimit({
    bucket: 'verify-otp',
    limit: 20,
    windowSeconds: 600,
    by: ['ip', 'email'],
  })
  @WithoutLogin()
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    await this.userService.verifyRegistrationOtp(dto)
  }

  @Post('resend-otp')
  /** Cooldown 30s theo email đã có; trần này chặn một IP quay nhiều địa chỉ. */
  @RateLimit({
    bucket: 'resend-otp',
    limit: 10,
    windowSeconds: 3600,
    by: ['ip'],
  })
  @WithoutLogin()
  async resendOtp(@Body() dto: ResendOtpDto) {
    await this.userService.resendRegistrationOtp(dto)
  }

  /**
   * Luôn trả 204, không ngoại lệ nào.
   *
   * Kể cả khi đang trong cooldown — khác `resend-otp` vốn trả 429 kèm số giây
   * còn lại. Ở luồng đăng ký, người dùng vừa tự tay xin mã và đang chờ nên con
   * số đó có ích cho chính họ; ở đây nó nói cho người gọi biết "địa chỉ này vừa
   * có người xin đặt lại mật khẩu". Countdown chuyển hẳn sang client.
   */
  @Post('forgot-password')
  /** Service đã có trần theo email và theo IP; đây là lớp chặn sớm, trước cả DB. */
  @RateLimit({
    bucket: 'forgot-password',
    limit: 20,
    windowSeconds: 3600,
    by: ['ip'],
  })
  @WithoutLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    await this.userService.forgotPassword({ email: dto.email, ip })
  }

  @Get('reset-password/validate')
  /** Endpoint này KHÔNG tiêu token nên nó là chỗ dò token thoải mái nhất. */
  @RateLimit({
    bucket: 'validate-reset',
    limit: 60,
    windowSeconds: 3600,
    by: ['ip'],
  })
  @WithoutLogin()
  validateResetToken(@Query() query: ValidateResetTokenQueryDto) {
    return this.userService.validatePasswordResetToken(query.token)
  }

  @Post('reset-password')
  /** Mỗi request là một lần đoán token 256 bit — vẫn nên có trần. */
  @RateLimit({
    bucket: 'reset-password',
    limit: 20,
    windowSeconds: 3600,
    by: ['ip'],
  })
  @WithoutLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.userService.resetPassword(dto)
  }

  @Post('login')
  /** Chặn flood từ một máy. Nhắm vào MỘT tài khoản thì bộ đếm khoá lo, vì nó
   * đếm theo tài khoản nên nhiều IP cũng không thoát. */
  @RateLimit({ bucket: 'login', limit: 30, windowSeconds: 300, by: ['ip'] })
  @WithoutLogin()
  async login(
    @Body() dto: LoginUserDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Ip() ip: string,
  ) {
    // Thiết bị và IP đi vào bản ghi phiên để sau này liệt kê được "đang đăng
    // nhập ở đâu" mà không phải suy từ log.
    // Không tạo được phiên vì tầng phiên lỗi thì đây là sự cố của chúng ta,
    // không phải sai thông tin đăng nhập — nói đúng mã để người dùng không đi
    // gõ lại mật khẩu vô ích.
    const session = await this.withStoreErrors(() =>
      this.userService.login(dto, {
        userAgent: request.headers['user-agent'] ?? null,
        ip,
      }),
    )

    this.setSessionCookies(response, session)

    // The tokens travel only as httpOnly cookies. Echoing them in the body
    // put the refresh token where page scripts (and localStorage) could reach
    // it; the body is the same user shape GET /user/me returns.
    return session.user
  }

  /**
   * Chỗ DUY NHẤT cấp lại cookie phiên.
   *
   * `@WithoutLogin()` vì nó tự xác thực bằng chính cookie refresh: tới lúc gọi
   * được đây thì access token đã hết hạn, nên bắt buộc phải đăng nhập mới vào
   * được sẽ là một vòng lặp không có cửa ra.
   */
  @Post('refresh')
  /** Client thật làm mới mỗi 15 phút và đã single-flight; 60/5 phút là rất rộng. */
  @RateLimit({ bucket: 'refresh', limit: 60, windowSeconds: 300, by: ['ip'] })
  @WithoutLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result: RefreshResult = await this.withStoreErrors(() =>
      this.userService.refreshSession(this.readRefreshCookie(request)),
    )

    if (result.status === 'terminated') {
      this.clearSessionCookies(response)
      throw new UnauthorizedException({
        message: 'UNAUTHORIZED',
        code: 'SESSION_REVOKED',
      })
    }

    response.cookie('accessToken', result.accessToken, {
      ...ACCESS_COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    })

    // Nhánh ân hạn không có cookie refresh mới: bản mới đã ở trình duyệt từ
    // request thắng cuộc rotate. Ghi đè bằng bản cũ ở đây là tự huỷ phiên.
    if (result.status === 'rotated') {
      response.cookie('refreshToken', result.refreshToken, {
        ...REFRESH_COOKIE_OPTIONS,
        maxAge: REFRESH_TOKEN_MAX_AGE_MS,
      })
    }
  }

  /**
   * Đăng xuất thiết bị hiện tại.
   *
   * Vẫn `@WithoutLogin()` và vẫn luôn xoá cookie: token hỏng hay phiên đã chết
   * thì người dùng càng cần được thoát ra, không phải nhận 401. Khác với trước
   * là giờ nó ĐỌC cookie để biết phiên nào cần xoá ở phía server.
   */
  @Post('logout')
  /** Endpoint không cần đăng nhập thì vẫn cần trần. */
  @RateLimit({ bucket: 'logout', limit: 60, windowSeconds: 300, by: ['ip'] })
  @WithoutLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Best-effort ở phía server: người đã bấm đăng xuất phải được thoát ra kể
    // cả khi tầng phiên đang lỗi. Phiên còn sót sẽ chết khi hết hạn idle, và
    // lỗi được log lại để không biến mất im lặng.
    try {
      await this.userService.logout(this.readRefreshCookie(request))
    } catch (error) {
      this.logger.error(
        '[user.logout] không thu hồi được phiên ở server',
        error instanceof Error ? error.message : String(error),
      )
    }
    this.clearSessionCookies(response)
  }

  /** Đăng xuất mọi thiết bị của chính mình. */
  @Post('logout-all')
  @RequireLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @UserInfo('userId') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Khác logout một thiết bị: ở đây im lặng bỏ qua là nói dối, vì người dùng
    // vừa được cho biết "đã đăng xuất mọi nơi".
    await this.withStoreErrors(() => this.userService.logoutAll(userId))
    this.clearSessionCookies(response)
  }

  /**
   * Tầng phiên không trả lời -> 503, KHÔNG phải 401.
   *
   * Frontend coi mọi 401 là phiên chấm dứt và đăng xuất ngay, nên gộp "không
   * kiểm tra được" vào 401 sẽ khiến một cú nấc của Redis đá hết người dùng ra.
   */
  private async withStoreErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError) {
        throw new ServiceUnavailableException({
          message: 'SESSION_CHECK_UNAVAILABLE',
          code: 'SESSION_CHECK_UNAVAILABLE',
        })
      }
      throw error
    }
  }

  /**
   * Xin mã đổi mật khẩu. Không nhận email từ body — xem `sendChangePasswordOtp`.
   */
  @Post('change-password/otp')
  /** Khe 60s theo user đã chặn chính người dùng; trần này chặn một máy dội
   * bằng nhiều tài khoản. */
  @RateLimit({
    bucket: 'change-password-otp',
    limit: 20,
    windowSeconds: 300,
    by: ['ip'],
  })
  @RequireLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestChangePasswordOtp(@UserInfo() user: JwtPayload) {
    await this.userService.sendChangePasswordOtp(user.userId)
  }

  /**
   * Đổi mật khẩu bằng mật khẩu hiện tại HOẶC mã OTP — `ChangePasswordDto` bảo
   * đảm đúng một trong hai.
   *
   * `sid` lấy từ access token chứ không phải body: nó quyết định phiên nào
   * được giữ lại, và để client tự khai thì người dùng có thể bị lừa giữ lại
   * đúng phiên của kẻ đang chiếm tài khoản.
   */
  @Post('change-password')
  @RateLimit({
    bucket: 'change-password',
    limit: 20,
    windowSeconds: 300,
    by: ['ip'],
  })
  @RequireLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @UserInfo() user: JwtPayload,
  ) {
    await this.withStoreErrors(() =>
      this.userService.changePassword(user.userId, user.sid, dto),
    )
  }

  /** Các thiết bị đang đăng nhập của chính mình. */
  @Get('sessions')
  @RequireLogin()
  listSessions(@UserInfo() user: JwtPayload) {
    return this.withStoreErrors(() =>
      this.userService.listOwnSessions(user.userId, user.sid),
    )
  }

  /**
   * Đăng xuất một thiết bị cụ thể.
   *
   * 404 cho cả "không tồn tại" và "không phải của bạn": phân biệt hai trường
   * hợp đó sẽ cho người gọi biết một sid có tồn tại hay không.
   */
  @Post('sessions/revoke')
  @RequireLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Body() dto: RevokeSessionDto,
    @UserInfo() user: JwtPayload,
  ) {
    const revoked = await this.withStoreErrors(() =>
      this.userService.revokeOwnSession(user.userId, dto.sid),
    )
    if (!revoked) {
      throw new NotFoundException({
        message: 'SESSION_NOT_FOUND',
        code: 'SESSION_NOT_FOUND',
      })
    }
  }

  private setSessionCookies(
    response: Response,
    session: { accessToken: string; refreshToken: string },
  ) {
    response.cookie('accessToken', session.accessToken, {
      ...ACCESS_COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    })
    response.cookie('refreshToken', session.refreshToken, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    })
  }

  private clearSessionCookies(response: Response) {
    response.clearCookie('accessToken', ACCESS_COOKIE_OPTIONS)
    response.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS)
  }

  /** cookie-parser được mount ở app này; header thô là đường dự phòng. */
  private readRefreshCookie(request: Request): string | null {
    const cookies = (request.cookies ?? {}) as Partial<Record<string, string>>
    return (
      cookies.refreshToken ??
      readCookie(request.headers?.cookie, 'refreshToken')
    )
  }

  /**
   * For other services (chat, when a group is created or grows): the name
   * and avatar of these users, straight from the owner of that data rather
   * than from whatever a client sends along.
   */
  @Post('internal/profiles')
  @InternalOnly()
  getMemberProfiles(@Body() dto: MemberProfilesDto) {
    return this.userService.getMemberProfiles(dto.ids)
  }

  @Get('me')
  @RequireLogin()
  getMe(@UserInfo('userId') userId: string) {
    return this.userService.getMe(userId)
  }

  @Post('interest-onboarding')
  @RequireLogin()
  completeInterestOnboarding(
    @Body() dto: CompleteInterestOnboardingDto,
    @UserInfo('userId') userId: string,
  ) {
    return this.userService.completeInterestOnboarding({
      userId,
      slugs: dto.slugs,
    })
  }

  @Get('')
  @RequireLogin()
  getProfile(
    @UserInfo('userId') viewerId: string,
    @Query() query: ProfileQueryDto,
  ) {
    return this.userService.getProfile(viewerId, query.userId)
  }

  @Post('make-friend')
  @RequireLogin()
  async makeFriend(@Body() body: MakeFriendDto, @UserInfo() user: JwtPayload) {
    await this.userService.makeFriend({
      inviterId: user.userId,
      inviterName: user.username,
      inviteeEmail: body.email,
    })
  }

  /**
   * Gửi lời mời theo username — dùng ở thẻ gợi ý kết bạn, nơi client chỉ có
   * username chứ không có (và không nên có) email của người lạ.
   */
  @Post('make-friend-by-username')
  @RequireLogin()
  async makeFriendByUsername(
    @Body() body: MakeFriendByUsernameDto,
    @UserInfo() user: JwtPayload,
  ) {
    await this.userService.makeFriend({
      inviterId: user.userId,
      inviterName: user.username,
      inviteeUsername: body.username,
    })
  }

  /** The recipient accepts or declines; the name on the event is their own. */
  @Post('friend-requests/:id/respond')
  @RequireLogin()
  respondToFriendRequest(
    @Param() params: FriendRequestParamsDto,
    @Body() body: RespondFriendRequestDto,
    @UserInfo() user: JwtPayload,
  ) {
    return this.userService.respondToFriendRequest({
      requestId: params.id,
      status: body.status,
      inviteeId: user.userId,
      inviteeName: user.username,
    })
  }

  @Get('list-friends')
  @RequireLogin()
  listFriends(@UserInfo('userId') userId: string, @Query() page: PageQueryDto) {
    return this.userService.listFriends(userId, page)
  }

  @Get('search')
  @RequireLogin()
  searchUsers(
    @UserInfo('userId') userId: string,
    @Query('keyword') keyword: string,
  ) {
    return this.userService.searchFriends(userId, keyword)
  }

  @Get('list-friend-requests')
  @RequireLogin()
  listFriendRequests(
    @UserInfo('userId') userId: string,
    @Query() query: FriendRequestsQueryDto,
  ) {
    return this.userService.listFriendRequests(userId, query.direction, query)
  }

  @Get('detail-friend-request')
  @RequireLogin()
  detailMakeFriend(
    @UserInfo('userId') userId: string,
    @Query('friendRequestId') friendRequestId: string,
  ) {
    return this.userService.detailMakeFriend(friendRequestId, userId)
  }

  @Post('update-profile')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: {
        fileSize: 2 * 1024 * 1024,
      },
    }),
  )
  @RequireLogin()
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @UserInfo('userId') userId: string,
    @UploadedFile() avatar?: MultipartFile,
  ) {
    return this.userService.updateProfile({
      ...dto,
      userId,
      avatar: avatar?.buffer,
      avatarFilename: avatar?.originalname,
    })
  }
}
