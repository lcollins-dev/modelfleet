import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestartOnOlderSettings1794249911178 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_deployment_out_of_date";`);

    await queryRunner.query(`ALTER TABLE "deployment" DROP COLUMN "appliedRevision";`);

    await queryRunner.query(`ALTER TABLE "instance" ADD COLUMN "restartRequestedDate" timestamp NULL;`);
  }

  public async down(): Promise<void> {}
}
