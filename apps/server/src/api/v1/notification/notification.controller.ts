import { Controller, Get, InternalServerErrorException, Logger, Param, Patch } from '@nestjs/common';

import { NotificationDto, NotificationListDto, IdParamDto } from '@libs/dto';

import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { Notification } from '@/core/notification/entities/notification.entity';
import { User } from '@/core/user/entities/user.entity';

import { NotificationService } from '@/core/notification/notification.service';

@Controller('api/v1/notification')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  @Get('list')
  async getNotificationList(@GetUser() user: User): Promise<NotificationListDto> {
    const notificationList = await this.notificationService.findUncleared(user.id);

    return {
      notificationList: notificationList.map(notification => this.getINotification(notification)),
    };
  }

  @Patch(':notificationId/clear')
  clearNotification(
    @Param('notificationId', new ZodPipe(IdParamDto)) notificationId: number,
    @GetUser() user: User
  ): Promise<void> {
    return this.notificationService.clear(notificationId, user.id);
  }

  private getINotification(notification: Notification): NotificationDto {
    const { notificationType } = notification;

    if (!notificationType) {
      this.logger.error(
        { notificationId: notification.id, notificationTypeId: notification.notificationTypeId },
        'getINotification(): Notification has no notification type'
      );
      throw new InternalServerErrorException();
    }

    return {
      id: notification.id,
      notificationType: {
        id: notificationType.id,
        name: notificationType.name,
        severity: notificationType.severity,
        pageUrl: notificationType.pageUrl ?? undefined,
      },
      desc: notification.desc,
      createdDate: notification.createdDate,
    };
  }
}
