import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMap, isScalar, parseDocument } from 'yaml';

const SPLIT_MODE_KEY = 'splitMode';
const ROW_SPLIT = 'row';
const LAYER_SPLIT = 'layer';

interface IStoredConfigurationRow {
  id: number;
  document: string;
}

/** llama.cpp's CUDA build refuses a row split at load, so a stored one takes the layer split it is closest to. */
export class LlamaCppRowSplit1793713187976 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.replaceRowSplit(queryRunner, 'preset', `"backend" = 'llama.cpp'`);
    await this.replaceRowSplit(
      queryRunner,
      'deployment',
      `("backend" = 'llama.cpp' OR "presetId" IN (SELECT "id" FROM "preset" WHERE "backend" = 'llama.cpp'))`
    );
  }

  public async down(): Promise<void> {}

  public withLayerSplit(document: string): string {
    const parsed = parseDocument(document);
    const node: unknown = isMap(parsed.contents) ? parsed.contents.get(SPLIT_MODE_KEY, true) : undefined;

    if (!isScalar(node) || node.value !== ROW_SPLIT) {
      return document;
    }

    node.value = LAYER_SPLIT;

    return String(parsed);
  }

  /** Keeps the configuration column equal to the document it is parsed from. */
  private async replaceRowSplit(queryRunner: QueryRunner, table: string, scope: string): Promise<void> {
    const result: unknown = await queryRunner.query(
      `SELECT "id", "document" FROM "${table}" WHERE ${scope} AND "configuration" ->> '${SPLIT_MODE_KEY}' = '${ROW_SPLIT}';`
    );
    const rows = Array.isArray(result) ? result.filter(row => this.isStoredRow(row)) : [];

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE "${table}" SET "document" = $1, "configuration" = jsonb_set("configuration", '{${SPLIT_MODE_KEY}}', '"${LAYER_SPLIT}"') WHERE "id" = $2;`,
        [this.withLayerSplit(row.document), row.id]
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
