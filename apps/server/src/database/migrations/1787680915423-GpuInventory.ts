import { MigrationInterface, QueryRunner } from 'typeorm';

export class GpuInventory1787680915423 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "gpu" (
        "id" serial NOT NULL,
        "nodeId" int4 NOT NULL,
        "deviceKey" varchar(128) NOT NULL,
        "vendor" varchar(32) NOT NULL,
        "name" varchar(128) NULL,
        "pciBusId" varchar(64) NULL,
        "memoryTotalBytes" int8 NULL,
        "lastReportedDate" timestamp NOT NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gpu_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gpu_node_id" FOREIGN KEY ("nodeId") REFERENCES "node" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_gpu_node_device_key" ON "gpu" ("nodeId", "deviceKey");`);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
