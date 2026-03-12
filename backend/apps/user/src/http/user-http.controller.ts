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
import { UserMapper } from '../domain/user.mapper'
import {
  RequireLogin,
  UserInfo,
  WithoutLogin,
} from '@app/common/common.decorator'
import {
  LoginUserDto,
  MakeFriendDto,
  RegisterUserDto,
  UpdateProfileDto,
  UpdateStatusMakeFriendDto,
} from './user-http.dto'

@Controller('user')
export class UserHttpController {
  constructor(private readonly userService: UserService) {}

  @Post('register')
  @WithoutLogin()
  async register(@Body() dto: RegisterUserDto) {
    const user = await this.userService.register(dto)
    return UserMapper.toRegisterResponse(user as any)
  }

  @Post('login')
  @WithoutLogin()
  async login(
    @Body() dto: LoginUserDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.userService.login(dto)

    response.cookie('accessToken', session.accessToken, {
      httpOnly: true,
      secure: true,
    })

    response.cookie('refreshToken', session.refreshToken, {
      httpOnly: true,
      secure: true,
    })

    return UserMapper.toLoginResponse(session as any)
  }

  @Post('logout')
  @WithoutLogin()
  async logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('accessToken')
    response.clearCookie('refreshToken')
    return { message: 'Logout successful' }
  }

  @Get('')
  @RequireLogin()
  async getUserById(@Query('userId') userId: string) {
    const user = await this.userService.getUserById(userId)
    return UserMapper.toGetUserByIdResponse(user as any)
  }

  @Post('make-friend')
  @RequireLogin()
  async makeFriend(@Body() body: MakeFriendDto, @UserInfo() user: any) {
    const friendship = await this.userService.makeFriend({
      inviterId: user.userId,
      inviterName: user.username,
      inviteeEmail: body.email,
    })

    return UserMapper.toMakeFriendResponse(friendship as any)
  }

  @Post('update-status-make-friend')
  @RequireLogin()
  async updateStatusMakeFriend(
    @Body() body: UpdateStatusMakeFriendDto,
    @UserInfo() user: any,
  ) {
    const friendship = await this.userService.updateStatusMakeFriend({
      ...body,
      inviteeId: user.userId,
      inviteeName: user.username,
    })

    return UserMapper.toUpdateStatusResponse(friendship as any)
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
    return UserMapper.toListFriendsResponse(friends as any)
  }

  @Get('search')
  @RequireLogin()
  async searchUsers(@UserInfo() user: any, @Query('keyword') keyword: string) {
    const friends = await this.userService.searchFriends(user.userId, keyword)
    return UserMapper.toListFriendsResponse(friends as any)
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
    return UserMapper.toListFriendRequestsResponse(requests)
  }

  @Get('detail-friend-request')
  @RequireLogin()
  async detailMakeFriend(@Query('friendRequestId') friendRequestId: string) {
    const request = await this.userService.detailMakeFriend(friendRequestId)
    return UserMapper.toDetailMakeFriendResponse(request as any)
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

    return UserMapper.toUpdateProfileResponse(profile as any)
  }
}
