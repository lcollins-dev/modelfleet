import { MigrationInterface, QueryRunner } from 'typeorm';

import { NotificationSeverity } from '@libs/dto';

/**
 * Ids sit outside NotificationTypeId, which ships empty - a real app declares its own members
 * there and seeds them from InitialDBEntries instead.
 */
const NOTIFICATION_TYPES = [
  {
    id: 9001,
    name: 'Batch job finished',
    severity: NotificationSeverity.SUCCESS,
    pageUrl: '/batch-jobs',
  },
  {
    id: 9002,
    name: 'Item one needs attention',
    severity: NotificationSeverity.WARNING,
    pageUrl: null,
  },
  {
    id: 9003,
    name: 'New user added',
    severity: NotificationSeverity.INFO,
    pageUrl: '/users',
  },
  {
    id: 9004,
    name: 'Batch job failed',
    severity: NotificationSeverity.ERROR,
    pageUrl: '/batch-jobs',
  },
];

const NOTIFICATIONS = [
  {
    notificationTypeId: 9001,
    desc: 'Nightly export completed in 42s.',
    minutesAgo: 2,
  },
  {
    notificationTypeId: 9002,
    desc: 'Re-check the configuration to keep it enabled.',
    minutesAgo: 120,
  },
  {
    notificationTypeId: 9003,
    desc: 'user-six@example.test joined this group.',
    minutesAgo: 1440,
  },
  {
    notificationTypeId: 9004,
    desc: 'Example job exited with status 1 on its last run.',
    minutesAgo: 4320,
  },
];

/** Must match `apps/agent/development.env.tpl`: the hash is of `mfn_dev-node-secret-not-a-real-secret` at 8 rounds. */
const DEV_NODE = {
  nodeKey: process.env.DEV_NODE_KEY ?? 'dc9f2a26-2f30-4a1e-9f2c-9c1f0b5c7a10',
  name: 'Development node',
  secretHash: '$2b$08$q295GxhC2wjWmg3Sw8vEMuD.69NTaf0i1u4M5JqqOPbpO.1gpIl/m',
};

export class TestData9000000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Runs after MustChangePassword, so the documented test user signs in without a forced change
    await queryRunner.query('UPDATE "user" SET "mustChangePassword" = false WHERE email = $1', [
      'admin@modelfleet.test',
    ]);

    await queryRunner.query('INSERT INTO node("nodeKey", "name", "secretHash", "enabled") VALUES ($1, $2, $3, true);', [
      DEV_NODE.nodeKey,
      DEV_NODE.name,
      DEV_NODE.secretHash,
    ]);

    for (const notificationType of NOTIFICATION_TYPES) {
      await queryRunner.query(
        'INSERT INTO notification_type(id, "name", "severity", "pageUrl") VALUES ($1, $2, $3, $4);',
        [notificationType.id, notificationType.name, notificationType.severity, notificationType.pageUrl]
      );
    }

    const userRows = (await queryRunner.query('SELECT id FROM "user" ORDER BY id ASC LIMIT 1')) as { id: number }[];

    if (userRows.length === 0) {
      return;
    }

    for (const notification of NOTIFICATIONS) {
      await queryRunner.query(
        `INSERT INTO notification ("notificationTypeId", "userId", "desc", "cleared", "createdDate")
         VALUES ($1, $2, $3, false, now() - ($4 || ' minutes')::interval);`,
        [notification.notificationTypeId, userRows[0].id, notification.desc, notification.minutesAgo]
      );
    }
  }

  public async down(): Promise<void> {
    // Not required
  }
}
