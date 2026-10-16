import { MigrationInterface, QueryRunner } from 'typeorm';

export class NodeRegistry1787429237390 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "node" (
        "id" serial NOT NULL,
        "nodeKey" uuid NOT NULL,
        "name" varchar(128) NOT NULL,
        "description" varchar(512) NULL,
        "secretHash" varchar(256) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "lastSeenDate" timestamp NULL,
        "agentVersion" varchar(64) NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_node_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_node_node_key" UNIQUE ("nodeKey")
      );
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_node_name" ON "node" (LOWER("name"));`);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
