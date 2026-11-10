import { MigrationInterface, QueryRunner } from 'typeorm';

export class DownloadModelDirectory1794336628254 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "download_target" ADD "modelDirectory" varchar(1024) NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "download_target" DROP COLUMN "modelDirectory";`);
  }
}
