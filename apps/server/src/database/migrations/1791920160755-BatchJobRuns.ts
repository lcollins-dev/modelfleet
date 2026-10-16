import { MigrationInterface, QueryRunner } from 'typeorm';

export class BatchJobRuns1791920160755 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "batch_job_run" (
        "id" serial NOT NULL,
        "batchJobId" int4 NOT NULL,
        "startDate" timestamp NOT NULL,
        "endDate" timestamp NULL,
        "result" varchar(16) NOT NULL,
        "error" text NULL,
        CONSTRAINT "PK_batch_job_run_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_batch_job_run_batch_job" FOREIGN KEY ("batchJobId") REFERENCES batch_job(id) ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      'CREATE INDEX "IDX_batch_job_run_batch_job_id_start_date" ON "batch_job_run" ("batchJobId", "startDate")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "batch_job_run";
    `);
  }
}
