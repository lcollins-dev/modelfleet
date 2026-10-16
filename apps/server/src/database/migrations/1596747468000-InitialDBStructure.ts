import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialDBStructure1596747468000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // user
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" serial NOT NULL,
        "name" varchar(256) NOT NULL,
        "email" varchar(512) UNIQUE NOT NULL,
        "passwordHash" varchar(256) NOT NULL,
        "sessionUuid" varchar(512) UNIQUE NULL,
        "enabled" bool NOT NULL,
        "lastLoginSuccess" timestamp NULL,
        "lastLoginFail" timestamp NULL,
        "lastAccess" timestamp NOT NULL DEFAULT now(),
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "user_role" (
        "id" int4 NOT NULL,
        "name" varchar(64) NOT NULL,
        CONSTRAINT "PK_user_role_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "user_user_role" (
        "id" serial NOT NULL,
        "userId" int4 NOT NULL,
        "userRoleId" int4 NOT NULL,
        CONSTRAINT "PK_user_user_role_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_user_role_user" FOREIGN KEY ("userId") REFERENCES "user"(id),
        CONSTRAINT "FK_user_user_role_user_role" FOREIGN KEY ("userRoleId") REFERENCES user_role(id)
      );
    `);

    // batch-job
    await queryRunner.query(`
      CREATE TABLE "batch_job" (
        "id" int4 NOT NULL,
        "name" varchar(64) NOT NULL,
        "desc" varchar(256) NOT NULL,
        "cronExpression" varchar(128) NULL,
        "enabled" bool NOT NULL,
        "lastStartDate" timestamp NULL,
        "lastSuccessDate" timestamp NULL,
        "lastFailDate" timestamp NULL,
        CONSTRAINT "PK_batch_job_id" PRIMARY KEY ("id")
      );
    `);

    // notification
    await queryRunner.query(`
      CREATE TABLE "notification_type" (
        "id" int4 NOT NULL,
        "name" varchar(64) NOT NULL,
        "severity" varchar(16) NOT NULL,
        "pageUrl" varchar(256) NULL,
        CONSTRAINT "PK_notification_type_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "notification" (
        "id" serial NOT NULL,
        "notificationTypeId" int4 NOT NULL,
        "userId" int4 NOT NULL,
        "desc" text NOT NULL,
        "cleared" bool NOT NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_type" FOREIGN KEY ("notificationTypeId") REFERENCES notification_type(id),
        CONSTRAINT "FK_notification_user" FOREIGN KEY ("userId") REFERENCES "user"(id)
      );
    `);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
