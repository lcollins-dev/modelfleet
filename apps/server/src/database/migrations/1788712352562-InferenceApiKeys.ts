import { MigrationInterface, QueryRunner } from 'typeorm';

export class InferenceApiKeys1788712352562 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_key" (
        "id" serial NOT NULL,
        "keyId" varchar(32) NOT NULL,
        "name" varchar(128) NOT NULL,
        "secretHash" varchar(64) NOT NULL,
        "userId" int4 NOT NULL,
        "lastUsedDate" timestamp NULL,
        "revokedDate" timestamp NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_api_key_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_api_key_key_id" UNIQUE ("keyId"),
        CONSTRAINT "FK_api_key_user_id" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_api_key_user_id" ON "api_key" ("userId");`);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
