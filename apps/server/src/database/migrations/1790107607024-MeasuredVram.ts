import { MigrationInterface, QueryRunner } from 'typeorm';

export class MeasuredVram1790107607024 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "measured_vram" (
        "configurationRevision" varchar(64) NOT NULL,
        "gpuCount" int4 NOT NULL,
        "bytes" int8 NOT NULL,
        "measuredDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_measured_vram_configuration_revision_gpu_count" PRIMARY KEY ("configurationRevision", "gpuCount")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "measured_vram";`);
  }
}
