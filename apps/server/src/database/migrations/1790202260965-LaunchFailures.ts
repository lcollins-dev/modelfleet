import { MigrationInterface, QueryRunner } from 'typeorm';

export class LaunchFailures1790202260965 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deployment"
        ADD COLUMN "launchFailures" int4 NOT NULL DEFAULT 0,
        ADD COLUMN "lastLaunchFailureDate" timestamp NULL,
        ADD COLUMN "lastLaunchFailure" varchar(512) NULL;
    `);

    await queryRunner.query('ALTER TABLE "instance" ADD COLUMN "readyDate" timestamp NULL');
  }

  public async down(): Promise<void> {
    // Not required
  }
}
