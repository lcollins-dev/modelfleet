import { MigrationInterface, QueryRunner } from 'typeorm';

export class Instances1788031832310 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "instance" (
        "id" serial NOT NULL,
        "instanceKey" uuid NOT NULL,
        "deploymentId" int4 NOT NULL,
        "nodeId" int4 NOT NULL,
        "revision" int4 NOT NULL,
        "configurationRevision" varchar(64) NOT NULL,
        "devices" jsonb NOT NULL,
        "instanceState" varchar(32) NOT NULL,
        "message" varchar(512) NULL,
        "exitCode" int4 NULL,
        "reportedDate" timestamp NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        "updatedDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_instance_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_instance_key" UNIQUE ("instanceKey"),
        CONSTRAINT "FK_instance_deployment_id" FOREIGN KEY ("deploymentId") REFERENCES "deployment" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_instance_node_id" FOREIGN KEY ("nodeId") REFERENCES "node" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_instance_deployment_id" ON "instance" ("deploymentId");`);

    await queryRunner.query(`CREATE INDEX "IDX_instance_node_id" ON "instance" ("nodeId");`);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
