import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Handlebars from 'handlebars';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { NotificationTypeId } from '@libs/dto';

import { Notification } from './entities/notification.entity';

const NOTIFICATION_MISSING_MESSAGE = 'This notification does not exist or has already been cleared';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>
  ) {}

  /** The user's uncleared notifications newest first, each carrying its type. */
  findUncleared(userId: number): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { userId, cleared: false },
      relations: { notificationType: true },
      order: { createdDate: 'DESC' },
    });
  }

  /** Scoped to the user, so one user cannot clear another's. */
  async clear(notificationId: number, userId: number): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId, cleared: false },
    });

    if (!notification) {
      throw new BadRequestException(NOTIFICATION_MISSING_MESSAGE);
    }

    await this.notificationRepository.update({ id: notification.id }, { cleared: true });
  }

  /** Every piece of user content belongs in `descValues`, so the template itself stays trusted. */
  @Transactional()
  async add(
    notificationTypeId: NotificationTypeId,
    descHandlebars: string,
    userId: number,
    descValues?: { [key: string]: string }
  ): Promise<void> {
    const desc = Handlebars.compile(descHandlebars)(descValues);

    const notification = new Notification({ notificationTypeId, userId, desc });

    await this.notificationRepository.insert(notification);
  }
}
