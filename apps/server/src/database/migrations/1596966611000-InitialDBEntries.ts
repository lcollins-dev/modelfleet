import { MigrationInterface, QueryRunner } from 'typeorm';

import { UserRoleId } from '@libs/dto';

const USER_ROLES = [
  {
    id: UserRoleId.USER_ADMIN,
    name: 'User Admin',
  },
  {
    id: UserRoleId.SYSTEM_ADMIN,
    name: 'System Admin',
  },
];

export class InitialDBEntries1596966611000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // User roles
    for (const userRole of USER_ROLES) {
      await queryRunner.query('INSERT INTO user_role(id, name) VALUES ($1, $2);', [userRole.id, userRole.name]);
    }

    // Create admin user (password changeme)
    const adminUserId: number = (
      (await queryRunner.query(
        `INSERT INTO "user" (
          "email",
          "passwordHash",
          "name",
          "enabled",
          "lastAccess",
          "createdDate"
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
        [
          'admin@modelfleet.test',
          '$2b$08$Lp2Tgws5IDagVnS6QlyGyumwXQNdnhz08y7IO12xu5ZU6LCSfC0XW',
          'Admin',
          true,
          '2023-01-22 13:46:00.000',
          '2023-01-22 13:46:00.000',
        ]
      )) as [{ id: number }]
    )[0].id;

    for (const userRoleId of [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN]) {
      await queryRunner.query('INSERT INTO user_user_role ("userId", "userRoleId") VALUES ($1, $2);', [
        adminUserId,
        userRoleId,
      ]);
    }
  }

  public async down(): Promise<void> {
    // Not required
  }
}
