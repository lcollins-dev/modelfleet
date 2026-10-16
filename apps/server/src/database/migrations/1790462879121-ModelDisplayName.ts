import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModelDisplayName1790462879121 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" ADD COLUMN "displayName" character varying(256) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "model" DROP COLUMN "displayName";
    `);
  }
}
