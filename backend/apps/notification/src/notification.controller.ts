import { Body, Controller, Get, Param, Patch, Put, Query } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { RequireLogin, UserInfo } from '@app/common/common.decorator'
import { PageQueryDto } from '@app/common/http/page-query.dto'
import { UpdateNotificationPreferencesDto } from './notification.dto'

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}
  //thằng @golevelup/nestjs-rabbitmq sẽ k quét rabbitsub trong controller lên mọi thứ được chuyển thẳng vào trong service

  @Get('')
  @RequireLogin()
  getNotifications(
    @UserInfo('userId') userId: string,
    @Query() page: PageQueryDto,
  ) {
    return this.notificationService.getNotifications(userId, page)
  }

  @Patch(':notificationId/read')
  @RequireLogin()
  markNotificationAsRead(
    @UserInfo('userId') userId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationService.markNotificationAsRead(
      userId,
      notificationId,
    )
  }

  @Patch('read-all')
  @RequireLogin()
  markAllNotificationsAsRead(@UserInfo('userId') userId: string) {
    return this.notificationService.markAllNotificationsAsRead(userId)
  }

  @Get('unread-count')
  @RequireLogin()
  getUnreadCount(@UserInfo('userId') userId: string) {
    return this.notificationService.getUnreadCount(userId)
  }

  @Get('types')
  @RequireLogin()
  getNotificationTypes() {
    return this.notificationService.getNotificationTypes()
  }

  @Get('preferences')
  @RequireLogin()
  getNotificationPreferences(@UserInfo('userId') userId: string) {
    return this.notificationService.getNotificationPreferences(userId)
  }

  @Put('preferences')
  @RequireLogin()
  updateNotificationPreferences(
    @UserInfo('userId') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationService.updateNotificationPreferences(userId, dto)
  }
}
