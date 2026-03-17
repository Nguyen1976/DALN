import { Body, Controller, Get, Param, Patch, Put, Query } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { RequireLogin, UserInfo } from '@app/common/common.decorator'

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}
  //thằng @golevelup/nestjs-rabbitmq sẽ k quét rabbitsub trong controller lên mọi thứ được chuyển thẳng vào trong service

  @Get('')
  @RequireLogin()
  getNotifications(
    @UserInfo() user: any,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.notificationService.getNotifications({
      userId: user.userId,
      limit: limit || '5',
      page: page || '1',
    })
  }

  @Patch(':notificationId/read')
  @RequireLogin()
  markNotificationAsRead(
    @UserInfo() user: any,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationService.markNotificationAsRead({
      userId: user.userId,
      notificationId,
    })
  }

  @Patch('read-all')
  @RequireLogin()
  markAllNotificationsAsRead(@UserInfo() user: any) {
    return this.notificationService.markAllNotificationsAsRead({
      userId: user.userId,
    })
  }

  @Get('unread-count')
  @RequireLogin()
  getUnreadCount(@UserInfo() user: any) {
    return this.notificationService.getUnreadCount(user.userId)
  }

  @Get('types')
  @RequireLogin()
  getNotificationTypes() {
    return this.notificationService.getNotificationTypes()
  }

  @Get('preferences')
  @RequireLogin()
  getNotificationPreferences(@UserInfo() user: any) {
    return this.notificationService.getNotificationPreferences(user.userId)
  }

  @Put('preferences')
  @RequireLogin()
  updateNotificationPreferences(@UserInfo() user: any, @Body() payload: any) {
    return this.notificationService.updateNotificationPreferences(
      user.userId,
      payload,
    )
  }
}
