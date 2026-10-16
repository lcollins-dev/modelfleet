import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModelTaskSets1791811670642 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" ADD COLUMN "detectedTasks" character varying(32) array NOT NULL DEFAULT '{}';
      ALTER TABLE "model" ADD COLUMN "assignedTasks" character varying(32) array NULL;
      UPDATE "model" SET "detectedTasks" = ARRAY["task"] WHERE "task" IS NOT NULL;
      ALTER TABLE "model" DROP COLUMN "task";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" ADD COLUMN "task" character varying(32) NULL;
      UPDATE "model" SET "task" = (COALESCE("assignedTasks", "detectedTasks"))[1];
      ALTER TABLE "model" DROP COLUMN "assignedTasks";
      ALTER TABLE "model" DROP COLUMN "detectedTasks";
    `);
  }
}
