import { MigrationInterface, QueryRunner } from 'typeorm';

export class QuantisationFromTensorTypes1789901597404 implements MigrationInterface {
  /**
   * The stored quantisation came from `general.file_type`, which a mixed-precision file sets to a
   * value describing none of it. Only a scan states the new fields, and every node reports on connecting.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "model"
      SET "ggufMetadata" = "ggufMetadata" || jsonb_build_object(
        'quantisation', NULL,
        'quantisationMixed', false
      )
      WHERE "ggufMetadata" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "model"
      SET "ggufMetadata" = "ggufMetadata" - 'quantisationMixed'
      WHERE "ggufMetadata" IS NOT NULL;
    `);
  }
}
