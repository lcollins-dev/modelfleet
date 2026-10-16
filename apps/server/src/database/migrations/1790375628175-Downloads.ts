import { MigrationInterface, QueryRunner } from 'typeorm';

export class Downloads1790375628175 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "download" (
        "id" serial NOT NULL,
        "downloadKey" uuid NOT NULL,
        "source" varchar(32) NOT NULL,
        "repository" varchar(193) NOT NULL,
        "directory" varchar(256) NOT NULL,
        "revision" varchar(40) NOT NULL,
        "createdById" int4 NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_download_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_download_download_key" UNIQUE ("downloadKey"),
        CONSTRAINT "FK_download_created_by_id" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "download_file" (
        "id" serial NOT NULL,
        "downloadId" int4 NOT NULL,
        "position" int4 NOT NULL,
        "path" varchar(512) NOT NULL,
        "sizeBytes" int8 NOT NULL,
        "digestAlgorithm" varchar(16) NOT NULL,
        "digest" varchar(64) NOT NULL,
        CONSTRAINT "PK_download_file_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_download_file_download_id_path" UNIQUE ("downloadId", "path"),
        CONSTRAINT "FK_download_file_download_id" FOREIGN KEY ("downloadId") REFERENCES "download" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "download_target" (
        "id" serial NOT NULL,
        "downloadId" int4 NOT NULL,
        "nodeId" int4 NOT NULL,
        "state" varchar(16) NOT NULL,
        "attempt" int4 NOT NULL,
        "message" varchar(512) NULL,
        "settledDate" timestamp NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_download_target_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_download_target_download_id_node_id" UNIQUE ("downloadId", "nodeId"),
        CONSTRAINT "FK_download_target_download_id" FOREIGN KEY ("downloadId") REFERENCES "download" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_download_target_node_id" FOREIGN KEY ("nodeId") REFERENCES "node" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      'CREATE INDEX "IDX_download_target_node_id_state" ON "download_target" ("nodeId", "state");'
    );
  }

  public async down(): Promise<void> {
    // Not required
  }
}
