import { Module } from '@nestjs/common';

import { NotificationController } from './notification.controller';

import { NotificationModule } from '@/core/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [NotificationController],
})
export class NotificationApiModule {}
