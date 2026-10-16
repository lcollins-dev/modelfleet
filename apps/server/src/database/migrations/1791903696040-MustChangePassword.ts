import { MigrationInterface, QueryRunner } from 'typeorm';

export class MustChangePassword1791903696040 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user" ADD COLUMN "mustChangePassword" bool NOT NULL DEFAULT false;
    `);

    await queryRunner.query('UPDATE "user" SET "mustChangePassword" = true WHERE email = $1', [
      'admin@modelfleet.test',
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user" DROP COLUMN "mustChangePassword";
    `);
  }
}
