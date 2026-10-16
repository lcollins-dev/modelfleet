import { MigrationInterface, QueryRunner } from 'typeorm';

export class FleetEventLog1787406233694 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "event" (
        "id" serial NOT NULL,
        "type" varchar(64) NOT NULL,
        "severity" varchar(16) NOT NULL,
        "actorType" varchar(64) NULL,
        "actorId" varchar(128) NULL,
        "subjectType" varchar(64) NULL,
        "subjectId" varchar(128) NULL,
        "message" text NULL,
        "detail" jsonb NOT NULL,
        "createdDate" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_event_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_event_created_date" ON "event" ("createdDate" DESC);`);
    await queryRunner.query(`CREATE INDEX "IDX_event_type" ON "event" ("type");`);
    await queryRunner.query(`CREATE INDEX "IDX_event_severity" ON "event" ("severity");`);
    await queryRunner.query(`CREATE INDEX "IDX_event_actor" ON "event" ("actorType", "actorId");`);
    await queryRunner.query(`CREATE INDEX "IDX_event_subject" ON "event" ("subjectType", "subjectId");`);
  }

  public async down(): Promise<void> {
    // Not required
  }
}
