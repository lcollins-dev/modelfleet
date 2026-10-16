import { MigrationInterface, QueryRunner } from 'typeorm';

export class GpuIndex1791047309795 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "gpu" ADD COLUMN "index" int4 NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "gpu" DROP COLUMN "index";
    `);
  }
}
