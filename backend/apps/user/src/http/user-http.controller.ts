import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import type { Multer } from 'multer'
import type { Response } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { UserService } from '../user.service'
import {
  RequireLogin,
  UserInfo,
  WithoutLogin,
} from '@app/common/common.decorator'
import { LoggerService } from '@app/logger'
import {
  LoginUserDto,
  MakeFriendDto,
  ResendOtpDto,
  RegisterUserDto,
  UpdateProfileDto,
  UpdateStatusMakeFriendDto,
  VerifyOtpDto,
  CompleteInterestOnboardingDto,
} from './user-http.dto'
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_MAX_AGE_MS,
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
  secure: process.env.NODE_ENV === 'production',
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

    return {
      success: true,
      message: 'Xác thực OTP thành công',
    }
  }

  @Post('resend-otp')
  @WithoutLogin()
  async resendOtp(@Body() dto: ResendOtpDto) {
    const registration = await this.userService.resendRegistrationOtp(dto)
    return {
      email: registration.email,
      requiresOtpVerification: registration.requiresOtpVerification,
      message: 'Đã gửi lại mã OTP',
    }
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

    return {
      id: session.userId,
      email: session.email,
      username: session.username,
      fullName: session.fullName || '',
      avatar: session.avatar || '',
      bio: session.bio || '',
      interests: session.interests ?? [],
      hasCompletedInterestOnboarding:
        session.hasCompletedInterestOnboarding ?? true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    }
  }

  @Post('logout')
  @WithoutLogin()
  async logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('accessToken', SESSION_COOKIE_OPTIONS)
    response.clearCookie('refreshToken', SESSION_COOKIE_OPTIONS)
    return { message: 'Logout successful' }
  }

  @Get('me')
  @RequireLogin()
  async getMe(@UserInfo() user: any) {
    return this.userService.getMe(user.userId)
  }

  @Post('interest-onboarding')
  @RequireLogin()
  async completeInterestOnboarding(
    @Body() dto: CompleteInterestOnboardingDto,
    @UserInfo() user: any,
  ) {
    return this.userService.completeInterestOnboarding({
      userId: user.userId,
      slugs: dto.slugs,
    })
  }

  @Get('')
  @RequireLogin()
  async getUserById(@UserInfo() viewer: any, @Query('userId') userId: string) {
    const user = await this.userService.getUserById(userId)
    const canSeeContact = await this.userService.canSeeContactDetails(
      viewer?.userId,
      userId,
    )

    return {
      // Email is contact detail, not public profile: it goes out only to the
      // account itself or to an accepted friend.
      ...(canSeeContact ? { email: user.email } : {}),
      username: user.username,
      fullName: user.fullName || '',
      avatar: user.avatar || '',
      bio: user.bio || '',
    }
  }

  @Post('make-friend')
  @RequireLogin()
  async makeFriend(@Body() body: MakeFriendDto, @UserInfo() user: any) {
    await this.userService.makeFriend({
      inviterId: user.userId,
      inviterName: user.username,
      inviteeEmail: body.email,
    })

    return {
      status: 'SUCCESS',
    }
  }

  @Post('update-status-make-friend')
  @RequireLogin()
  async updateStatusMakeFriend(
    @Body() body: UpdateStatusMakeFriendDto,
    @UserInfo() user: any,
  ) {
    await this.userService.updateStatusMakeFriend({
      ...body,
      inviteeId: user.userId,
      inviteeName: user.username,
    })

    return {
      status: 'SUCCESS',
    }
  }

  @Get('list-friends')
  @RequireLogin()
  async listFriends(
    @UserInfo() user: any,
    @Query('limit') limit: string,
    @Query('page') page: string,
  ) {
    const friends = await this.userService.listFriends(
      user.userId,
      Number(limit),
      Number(page),
    )
    return {
      friends: friends.map((friend) => ({
        ...friend,
        fullName: friend.fullName || '',
        avatar: friend.avatar || '',
        bio: friend.bio || '',
        status: (friend as any).status || false,
        lastSeen: friend.lastSeen
          ? new Date(friend.lastSeen).toISOString()
          : null,
      })),
    }
  }

  @Get('search')
  @RequireLogin()
  async searchUsers(@UserInfo() user: any, @Query('keyword') keyword: string) {
    const friends = await this.userService.searchFriends(user.userId, keyword)
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

  @Get('list-friend-requests')
  @RequireLogin()
  async listFriendRequests(
    @UserInfo() user: any,
    @Query('limit') limit: string,
    @Query('page') page: string,
  ) {
    const requests = await this.userService.listFriendRequests(
      user.userId,
      Number(limit),
      Number(page),
    )
    return {
      friendRequests: requests.map((request) => ({
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

  @Get('detail-friend-request')
  @RequireLogin()
  async detailMakeFriend(@Query('friendRequestId') friendRequestId: string) {
    const request = await this.userService.detailMakeFriend(friendRequestId)
    return {
      id: request.id,
      toUserId: request.toUserId,
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
    }
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
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @UserInfo() user: any,
    @UploadedFile() avatar?: Multer.File,
  ) {
    const profile = await this.userService.updateProfile({
      ...dto,
      userId: user.userId,
      avatar: avatar?.buffer,
      avatarFilename: avatar?.originalname,
    })

    return {
      fullName: profile.fullName || '',
      bio: profile.bio || '',
      avatar: profile.avatar || '',
    }
  }
}
