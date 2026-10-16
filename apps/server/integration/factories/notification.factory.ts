import { NestExpressApplication } from '@nestjs/platform-express';

import { dbQuery } from '../utils/db';

// Seeded by apps/server/src/database/migrations/test/9000000000000-TestData.ts.
export const TEST_NOTIFICATION_TYPE = {
  success: 9001,
  warning: 9002,
  info: 9003,
  error: 9004,
};

export interface ICreateTestNotificationOptions {
  notificationTypeId?: number;
  desc?: string;
  cleared?: boolean;
  minutesAgo?: number;
}

export const createTestNotification = async (
  app: NestExpressApplication,
  userId: number,
  options: ICreateTestNotificationOptions = {}
): Promise<number> => {
  const {
    notificationTypeId = TEST_NOTIFICATION_TYPE.info,
    desc = 'An integration notification',
    cleared = false,
    minutesAgo = 0,
  } = options;

  const rows = await dbQuery<{ id: number }>(
    app,
    `INSERT INTO notification ("notificationTypeId", "userId", "desc", "cleared", "createdDate")
     VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)
     RETURNING id`,
    [notificationTypeId, userId, desc, cleared, minutesAgo]
  );

  return rows[0].id;
};
