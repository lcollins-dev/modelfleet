import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { NotificationDto, NotificationSeverity } from '@libs/dto';

import { clearNotification, getNotificationList } from '../../clients/notification.client';
import { login } from '../../clients/user.client';
import { createTestNotification, TEST_NOTIFICATION_TYPE } from '../../factories/notification.factory';
import { createTestUser, ITestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const NOTIFICATION_LIST_ROUTE = '/api/v1/notification/list';

describe('Notifications (integration)', () => {
  let app: NestExpressApplication;

  const signedInUser = async (): Promise<{ user: ITestUser; token: string }> => {
    const user = await createTestUser(app);
    const token = await login(app, user.email);

    return { user, token };
  };

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get(NOTIFICATION_LIST_ROUTE).expect(401);
  });

  it('returns an empty list for a user with no notifications', async () => {
    const { token } = await signedInUser();

    const response = await getNotificationList(app, token).expect(200);

    expect(response.body.notificationList).toEqual([]);
  });

  it('returns only the notifications belonging to the signed-in user', async () => {
    const { user, token } = await signedInUser();
    const other = await createTestUser(app);

    const own = await createTestNotification(app, user.id, { desc: 'Mine' });
    await createTestNotification(app, other.id, { desc: 'Theirs' });

    const response = await getNotificationList(app, token).expect(200);

    expect(response.body.notificationList.map((notification: NotificationDto) => notification.id)).toEqual([own]);
  });

  it('leaves cleared notifications out of the list', async () => {
    const { user, token } = await signedInUser();

    await createTestNotification(app, user.id, { desc: 'Already read', cleared: true });
    const open = await createTestNotification(app, user.id, { desc: 'Still open' });

    const response = await getNotificationList(app, token).expect(200);

    expect(response.body.notificationList.map((notification: NotificationDto) => notification.id)).toEqual([open]);
  });

  it('orders the list newest first', async () => {
    const { user, token } = await signedInUser();

    const oldest = await createTestNotification(app, user.id, { minutesAgo: 180 });
    const middle = await createTestNotification(app, user.id, { minutesAgo: 60 });
    const newest = await createTestNotification(app, user.id, { minutesAgo: 1 });

    const response = await getNotificationList(app, token).expect(200);

    expect(response.body.notificationList.map((notification: NotificationDto) => notification.id)).toEqual([
      newest,
      middle,
      oldest,
    ]);
  });

  it('carries the notification type through with its severity and page url', async () => {
    const { user, token } = await signedInUser();

    await createTestNotification(app, user.id, { notificationTypeId: TEST_NOTIFICATION_TYPE.error });

    const response = await getNotificationList(app, token).expect(200);

    expect(response.body.notificationList[0].notificationType).toEqual({
      id: TEST_NOTIFICATION_TYPE.error,
      name: 'Batch job failed',
      severity: NotificationSeverity.ERROR,
      pageUrl: '/batch-jobs',
    });
  });

  it('omits the page url of a type that has none', async () => {
    const { user, token } = await signedInUser();

    await createTestNotification(app, user.id, { notificationTypeId: TEST_NOTIFICATION_TYPE.warning });

    const response = await getNotificationList(app, token).expect(200);

    expect(response.body.notificationList[0].notificationType.pageUrl).toBeUndefined();
  });

  it('drops a notification from the list once it is cleared', async () => {
    const { user, token } = await signedInUser();

    const notificationId = await createTestNotification(app, user.id);

    await clearNotification(app, token, notificationId).expect(200);

    const response = await getNotificationList(app, token).expect(200);

    expect(response.body.notificationList).toEqual([]);
  });

  it('marks the row as cleared rather than deleting it', async () => {
    const { user, token } = await signedInUser();

    const notificationId = await createTestNotification(app, user.id);

    await clearNotification(app, token, notificationId).expect(200);

    const rows = await dbQuery<{ cleared: boolean }>(app, 'SELECT cleared FROM notification WHERE id = $1', [
      notificationId,
    ]);

    expect(rows[0].cleared).toBe(true);
  });

  it('refuses to clear a notification belonging to another user', async () => {
    const { token } = await signedInUser();
    const other = await createTestUser(app);

    const notificationId = await createTestNotification(app, other.id);

    await clearNotification(app, token, notificationId).expect(400);

    const rows = await dbQuery<{ cleared: boolean }>(app, 'SELECT cleared FROM notification WHERE id = $1', [
      notificationId,
    ]);

    expect(rows[0].cleared).toBe(false);
  });

  it('refuses to clear the same notification twice', async () => {
    const { user, token } = await signedInUser();

    const notificationId = await createTestNotification(app, user.id);

    await clearNotification(app, token, notificationId).expect(200);
    await clearNotification(app, token, notificationId).expect(400);
  });

  it('refuses to clear a notification that does not exist', async () => {
    const { token } = await signedInUser();

    await clearNotification(app, token, 2147483647).expect(400);
  });

  it('rejects a notification id that is not an integer', async () => {
    const { token } = await signedInUser();

    await clearNotification(app, token, 'abc').expect(400);
  });

  it('rejects an unauthenticated clear', async () => {
    const other = await createTestUser(app);
    const notificationId = await createTestNotification(app, other.id);

    await request(app.getHttpServer()).patch(`/api/v1/notification/${notificationId}/clear`).expect(401);
  });
});
