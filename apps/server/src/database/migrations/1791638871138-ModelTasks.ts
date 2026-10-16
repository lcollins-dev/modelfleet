import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModelTasks1791638871138 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" ADD COLUMN "task" character varying(32) NULL;
      ALTER TABLE "model" ADD COLUMN "licence" jsonb NULL;
      ALTER TABLE "model" ADD COLUMN "modalities" character varying(16) array NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" DROP COLUMN "modalities";
      ALTER TABLE "model" DROP COLUMN "licence";
      ALTER TABLE "model" DROP COLUMN "task";
    `);
  }
}
