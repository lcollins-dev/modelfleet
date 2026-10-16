import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationSeverity, NotificationTypeId } from '@libs/dto';

import { NotificationType } from '@/core/notification/entities/notification-type.entity';
import { Notification } from '@/core/notification/entities/notification.entity';

import { NotificationService } from '@/core/notification/notification.service';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const EXAMPLE_TYPE_ID = 100 as NotificationTypeId;

interface IRepositoryMock {
  find: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

const makeRepoMock = (): IRepositoryMock => ({
  find: vi.fn(),
  findOne: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
});

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

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let notificationRepository: IRepositoryMock;

  beforeEach(async () => {
    notificationRepository = makeRepoMock();

    const moduleRef = await Test.createTestingModule({
      providers: [NotificationService, { provide: getRepositoryToken(Notification), useValue: notificationRepository }],
    }).compile();

    notificationService = moduleRef.get(NotificationService);
  });

  describe('findUncleared', () => {
    it('only asks for the uncleared notifications belonging to the user, newest first', async () => {
      notificationRepository.find.mockResolvedValue([]);

      await notificationService.findUncleared(7);

      expect(notificationRepository.find).toHaveBeenCalledWith({
        where: { userId: 7, cleared: false },
        relations: { notificationType: true },
        order: { createdDate: 'DESC' },
      });
    });

    it('answers with the rows carrying their type', async () => {
      notificationRepository.find.mockResolvedValue([buildNotification()]);

      const notifications = await notificationService.findUncleared(1);

      expect(notifications).toHaveLength(1);
      expect(notifications[0].notificationType?.id).toBe(EXAMPLE_TYPE_ID);
    });

    it('returns an empty list when the user has no notifications', async () => {
      notificationRepository.find.mockResolvedValue([]);

      const notifications = await notificationService.findUncleared(1);

      expect(notifications).toEqual([]);
    });
  });

  describe('clear', () => {
    it('scopes the lookup to the user and to uncleared notifications', async () => {
      notificationRepository.findOne.mockResolvedValue(buildNotification());
      notificationRepository.update.mockResolvedValue(undefined);

      await notificationService.clear(10, 7);

      expect(notificationRepository.findOne).toHaveBeenCalledWith({
        where: { id: 10, userId: 7, cleared: false },
      });
    });

    it('throws when the notification belongs to another user or is already cleared', async () => {
      notificationRepository.findOne.mockResolvedValue(null);

      await expect(notificationService.clear(10, 7)).rejects.toThrow(BadRequestException);

      expect(notificationRepository.update).not.toHaveBeenCalled();
    });

    it('marks the notification as cleared', async () => {
      notificationRepository.findOne.mockResolvedValue(buildNotification({ id: 22 }));
      notificationRepository.update.mockResolvedValue(undefined);

      await notificationService.clear(22, 7);

      expect(notificationRepository.update).toHaveBeenCalledWith({ id: 22 }, { cleared: true });
    });
  });

  describe('add', () => {
    it('renders the handlebars description with the supplied values', async () => {
      notificationRepository.insert.mockResolvedValue(undefined);

      await notificationService.add(EXAMPLE_TYPE_ID, 'Imported {{count}} rows', 7, { count: '12' });

      expect(notificationRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationTypeId: EXAMPLE_TYPE_ID,
          userId: 7,
          desc: 'Imported 12 rows',
          cleared: false,
        })
      );
    });

    it('escapes user content substituted into the template', async () => {
      notificationRepository.insert.mockResolvedValue(undefined);

      await notificationService.add(EXAMPLE_TYPE_ID, 'Hello {{name}}', 7, {
        name: '<script>alert(1)</script>',
      });

      const notification = notificationRepository.insert.mock.calls[0][0] as Notification;

      expect(notification.desc).not.toContain('<script>');
    });

    it('renders a template with no values', async () => {
      notificationRepository.insert.mockResolvedValue(undefined);

      await notificationService.add(EXAMPLE_TYPE_ID, 'A fixed message', 7);

      expect(notificationRepository.insert).toHaveBeenCalledWith(expect.objectContaining({ desc: 'A fixed message' }));
    });
  });
});
