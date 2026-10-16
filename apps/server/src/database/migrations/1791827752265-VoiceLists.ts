import { MigrationInterface, QueryRunner } from 'typeorm';

export class VoiceLists1791827752265 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "voice_list" (
        "deploymentId" int4 NOT NULL,
        "configurationRevision" varchar(64) NOT NULL,
        "voices" jsonb NOT NULL,
        CONSTRAINT "PK_voice_list_deployment_id" PRIMARY KEY ("deploymentId"),
        CONSTRAINT "FK_voice_list_deployment_id" FOREIGN KEY ("deploymentId") REFERENCES "deployment" ("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "voice_list";`);
  }
}
