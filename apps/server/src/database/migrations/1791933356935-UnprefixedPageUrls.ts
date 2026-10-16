import { MigrationInterface, QueryRunner } from 'typeorm';

export class UnprefixedPageUrls1791933356935 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE notification_type SET "pageUrl" = substring("pageUrl" FROM 7) WHERE "pageUrl" LIKE '/admin/%';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE notification_type SET "pageUrl" = '/admin' || "pageUrl"
      WHERE "pageUrl" ~ '^/(users|nodes|downloads|models|deployments|presets|api-keys|events|batch-jobs)(/|$)';
    `);
  }
}
