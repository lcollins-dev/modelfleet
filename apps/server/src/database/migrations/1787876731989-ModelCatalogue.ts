import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModelCatalogue1787876731989 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "model" (
        "id" serial NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "format" varchar(32) NOT NULL,
        "sizeBytes" int8 NOT NULL,
        "shardCount" int4 NOT NULL,
        "name" varchar(256) NOT NULL,
        "ggufMetadata" jsonb NULL,
        "safetensorsMetadata" jsonb NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_model_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_model_fingerprint" UNIQUE ("fingerprint")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "availability" (
        "id" serial NOT NULL,
        "modelId" int4 NOT NULL,
        "nodeId" int4 NOT NULL,
        "path" varchar(1024) NOT NULL,
        "lastConfirmedDate" timestamp NOT NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_availability_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_availability_model_id" FOREIGN KEY ("modelId") REFERENCES "model" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_availability_node_id" FOREIGN KEY ("nodeId") REFERENCES "node" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_availability_node_model" ON "availability" ("nodeId", "modelId");`
    );

    await queryRunner.query(`CREATE INDEX "IDX_availability_model_id" ON "availability" ("modelId");`);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
