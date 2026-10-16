import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationType } from './entities/notification-type.entity';
import { Notification } from './entities/notification.entity';

import { NotificationService } from './notification.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationType, Notification])],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
