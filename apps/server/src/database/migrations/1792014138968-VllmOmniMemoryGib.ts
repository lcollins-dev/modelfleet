import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMap, parseDocument } from 'yaml';

const SHARE_KEY = 'gpuMemoryUtilization';

interface IStoredConfigurationRow {
  id: number;
  document: string;
}

export class VllmOmniMemoryGib1792014138968 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropShare(queryRunner, 'preset', `"backend" = 'vllm-omni'`);
    await this.dropShare(
      queryRunner,
      'deployment',
      `("backend" = 'vllm-omni' OR "presetId" IN (SELECT "id" FROM "preset" WHERE "backend" = 'vllm-omni'))`
    );
  }

  public async down(): Promise<void> {}

  public withoutShare(document: string): string {
    const parsed = parseDocument(document);

    if (!isMap(parsed.contents) || !parsed.has(SHARE_KEY)) {
      return document;
    }

    parsed.delete(SHARE_KEY);

    return parsed.contents.items.length === 0 ? '' : String(parsed);
  }

  /** The key leaves both columns, since the configuration is rebuilt from the document on every write. */
  private async dropShare(queryRunner: QueryRunner, table: string, scope: string): Promise<void> {
    const result: unknown = await queryRunner.query(
      `SELECT "id", "document" FROM "${table}" WHERE ${scope} AND "configuration" ? '${SHARE_KEY}';`
    );
    const rows = Array.isArray(result) ? result.filter(row => this.isStoredRow(row)) : [];

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE "${table}" SET "document" = $1, "configuration" = "configuration" - '${SHARE_KEY}' WHERE "id" = $2;`,
        [this.withoutShare(row.document), row.id]
      );
    }
  }

  private isStoredRow(row: unknown): row is IStoredConfigurationRow {
    if (typeof row !== 'object' || row === null) {
      return false;
    }

    return 'id' in row && typeof row.id === 'number' && 'document' in row && typeof row.document === 'string';
  }
}
