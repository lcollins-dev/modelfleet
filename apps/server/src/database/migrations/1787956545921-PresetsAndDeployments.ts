import { MigrationInterface, QueryRunner } from 'typeorm';

export class PresetsAndDeployments1787956545921 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "preset" (
        "id" serial NOT NULL,
        "name" varchar(128) NOT NULL,
        "description" varchar(512) NULL,
        "backend" varchar(32) NOT NULL,
        "schemaVersion" int4 NOT NULL,
        "document" text NOT NULL,
        "configuration" jsonb NOT NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        "updatedDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_preset_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_preset_name" ON "preset" (LOWER("name"));`);

    await queryRunner.query(`
      CREATE TABLE "deployment" (
        "id" serial NOT NULL,
        "name" varchar(128) NOT NULL,
        "modelId" int4 NOT NULL,
        "presetId" int4 NULL,
        "backend" varchar(32) NULL,
        "activationPolicy" varchar(32) NOT NULL,
        "description" varchar(512) NULL,
        "schemaVersion" int4 NOT NULL,
        "document" text NOT NULL,
        "configuration" jsonb NOT NULL,
        "configurationRevision" varchar(64) NOT NULL,
        "appliedRevision" varchar(64) NOT NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        "updatedDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deployment_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_deployment_model_id" FOREIGN KEY ("modelId") REFERENCES "model" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_deployment_preset_id" FOREIGN KEY ("presetId") REFERENCES "preset" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_deployment_backend" CHECK (("presetId" IS NULL) <> ("backend" IS NULL))
      );
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_deployment_name" ON "deployment" (LOWER("name"));`);

    await queryRunner.query(`CREATE INDEX "IDX_deployment_model_id" ON "deployment" ("modelId");`);

    await queryRunner.query(`CREATE INDEX "IDX_deployment_preset_id" ON "deployment" ("presetId");`);

    await queryRunner.query(`
      CREATE INDEX "IDX_deployment_out_of_date" ON "deployment" ("id")
      WHERE "appliedRevision" <> "configurationRevision";
    `);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
