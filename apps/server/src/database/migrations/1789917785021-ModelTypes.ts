import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModelTypes1789917785021 implements MigrationInterface {
  /**
   * The default backfills every existing row as a model, which is what they all were. It is dropped
   * afterwards, since a scan states the type of everything it reports from here on.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" ADD COLUMN "type" character varying(32) NOT NULL DEFAULT 'model';
    `);

    await queryRunner.query(`
      ALTER TABLE "model" ALTER COLUMN "type" DROP DEFAULT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" DROP COLUMN "type";
    `);
  }
}
