import { MigrationInterface, QueryRunner } from 'typeorm';

import { BatchJobId } from '@libs/dto';

export class DeploymentResidency1789901620070 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "deployment"
        ADD COLUMN "enabled" bool NOT NULL DEFAULT true,
        ADD COLUMN "lastUsedDate" timestamp NULL;
    `);

    // Clears the example job the framework shipped with, which held this id until a real one earned it.
    await queryRunner.query('DELETE FROM batch_job WHERE id = $1', [BatchJobId.RESIDENCY]);

    await queryRunner.query('INSERT INTO batch_job(id, "name", "desc", enabled) VALUES ($1, $2, $3, $4)', [
      BatchJobId.RESIDENCY,
      'Residency',
      'Keeps every always deployment resident, stops an onDemand one that has idled out, and stops a disabled one',
      true,
    ]);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
