import { InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationSeverity, NotificationTypeId } from '@libs/dto';

import { NotificationType } from '@/core/notification/entities/notification-type.entity';
import { Notification } from '@/core/notification/entities/notification.entity';
import { User } from '@/core/user/entities/user.entity';

import { NotificationService } from '@/core/notification/notification.service';

import { NotificationController } from '@/api/v1/notification/notification.controller';

const EXAMPLE_TYPE_ID = 100 as NotificationTypeId;

const buildUser = (id: number): User => {
  const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
  user.id = id;

  return user;
};

const buildNotificationType = (overrides: Partial<NotificationType> = {}): NotificationType => {
  const notificationType = new NotificationType({
    id: EXAMPLE_TYPE_ID,
    name: 'Example',
    severity: NotificationSeverity.INFO,
    pageUrl: null,
  });

  Object.assign(notificationType, overrides);

  return notificationType;
};

const buildNotification = (overrides: Partial<Notification> = {}): Notification => {
  const notification = new Notification({ notificationTypeId: EXAMPLE_TYPE_ID, userId: 1, desc: 'Something happened' });

  notification.id = 10;
  notification.notificationType = buildNotificationType();
  notification.createdDate = new Date('2026-05-15T12:00:00Z');

  Object.assign(notification, overrides);

  return notification;
};

describe('NotificationController', () => {
  let controller: NotificationController;
  let findUnclearedMock: ReturnType<typeof vi.fn>;
  let clearMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    findUnclearedMock = vi.fn().mockResolvedValue([]);
    clearMock = vi.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: { findUncleared: findUnclearedMock, clear: clearMock },
        },
      ],
    }).compile();

    controller = moduleRef.get(NotificationController);
  });

  describe('getNotificationList', () => {
    it('asks for the list belonging to the authenticated user', async () => {
      const response = await controller.getNotificationList(buildUser(7));

      expect(findUnclearedMock).toHaveBeenCalledWith(7);
      expect(response).toEqual({ notificationList: [] });
    });

    it('maps the notification and its type onto the response', async () => {
      findUnclearedMock.mockResolvedValue([
        buildNotification({
          notificationType: buildNotificationType({
            name: 'Import finished',
            severity: NotificationSeverity.SUCCESS,
            pageUrl: '/users',
          }),
        }),
      ]);

      const response = await controller.getNotificationList(buildUser(1));

      expect(response).toEqual({
        notificationList: [
          {
            id: 10,
            notificationType: {
              id: EXAMPLE_TYPE_ID,
              name: 'Import finished',
              severity: NotificationSeverity.SUCCESS,
              pageUrl: '/users',
            },
            desc: 'Something happened',
            createdDate: new Date('2026-05-15T12:00:00Z'),
          },
        ],
      });
    });

    it('reports a null page url as undefined', async () => {
      findUnclearedMock.mockResolvedValue([buildNotification()]);

      const response = await controller.getNotificationList(buildUser(1));

      expect(response.notificationList[0].notificationType.pageUrl).toBeUndefined();
    });

    it('refuses a row whose type did not come back rather than answering half a notification', async () => {
      findUnclearedMock.mockResolvedValue([buildNotification({ notificationType: undefined })]);

      await expect(controller.getNotificationList(buildUser(1))).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('clearNotification', () => {
    it('scopes the clear to the authenticated user', async () => {
      await controller.clearNotification(10, buildUser(7));

      expect(clearMock).toHaveBeenCalledWith(10, 7);
    });
  });
});
