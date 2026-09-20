import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import type { Response } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { UserService } from '../user.service'
import {
  InternalOnly,
  RequireLogin,
  UserInfo,
  WithoutLogin,
} from '@app/common/common.decorator'
import { LoggerService } from '@app/logger'
import {
  LoginUserDto,
  MakeFriendDto,
  MakeFriendByUsernameDto,
  ResendOtpDto,
  RegisterUserDto,
  UpdateProfileDto,
  RespondFriendRequestDto,
  FriendRequestParamsDto,
  VerifyOtpDto,
  CompleteInterestOnboardingDto,
  FriendRequestsQueryDto,
  MemberProfilesDto,
  ProfileQueryDto,
} from './user-http.dto'
import { PageQueryDto } from '@app/common/http/page-query.dto'
import type { MultipartFile } from '@app/common/http/multipart-file'
import type { JwtPayload } from '@app/common/auth/resolve-tokens'
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_MAX_AGE_MS,
  isSecureCookie,
} from '@app/common/auth/auth.guard'

/**
 * Session cookie attributes, shared by login and logout.
 *
 * `secure: true` unconditionally used to be set here: browsers make an
 * exception for http://localhost so it appeared to work, but any other plain
 * HTTP origin (a LAN address used to test from a phone, a staging box) would
 * have silently dropped the cookie and left login looking broken.
 */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isSecureCookie(),
  sameSite: 'lax',
  path: '/',
} as const

@Controller('user')
export class UserHttpController {
  constructor(
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {}

  @Post('register')
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
  @WithoutLogin()
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    await this.userService.verifyRegistrationOtp(dto)
  }

  @Post('resend-otp')
  @WithoutLogin()
  async resendOtp(@Body() dto: ResendOtpDto) {
    await this.userService.resendRegistrationOtp(dto)
  }

  @Post('login')
  @WithoutLogin()
  async login(
    @Body() dto: LoginUserDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.userService.login(dto)

    // Same attributes the AuthGuard uses when it silently refreshes, so the
    // rotated cookie replaces this one instead of sitting beside it — and so
    // `clearCookie` on logout actually matches and removes them.
    response.cookie('accessToken', session.accessToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    })

    response.cookie('refreshToken', session.refreshToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    })

    // The tokens travel only as httpOnly cookies. Echoing them in the body
    // put the refresh token where page scripts (and localStorage) could reach
    // it; the body is the same user shape GET /user/me returns.
    return session.user
  }

  @Post('logout')
  @WithoutLogin()
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('accessToken', SESSION_COOKIE_OPTIONS)
    response.clearCookie('refreshToken', SESSION_COOKIE_OPTIONS)
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
