import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMap, parseDocument } from 'yaml';

const GPU_LAYERS_KEY = 'gpuLayers';

interface IStoredConfigurationRow {
  id: number;
  document: string;
}

export class InstancePins1789925018337 implements MigrationInterface {
  /**
   * `gpuLayers` has to leave both columns together: an unmodelled key survives the parse, and `derive()` rebuilds
   * the configuration column from the authored YAML on every write, so stripping one alone puts the key back on
   * the next save.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.reshapePins(queryRunner);

    const presets = await this.dropGpuLayers(queryRunner, 'preset');
    const deployments = await this.dropGpuLayers(queryRunner, 'deployment');

    await this.markOutOfDate(queryRunner, presets, deployments);
  }

  /** The authored key cannot be recovered, so only the column shape goes back. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "instance" SET "pins" = "pins" -> 'gpus';
    `);

    await queryRunner.query(`
      ALTER TABLE "instance" RENAME COLUMN "pins" TO "devices";
    `);
  }

  /**
   * Rewrites the authored YAML through the parser, so comments and key order around the removed key survive. These
   * are `ConfigurationService.withoutKeys()`'s three steps, copied rather than imported: a migration keeps doing
   * what it did on the day it ran, and a service is free to change.
   */
  public withoutGpuLayers(document: string): string {
    const parsed = parseDocument(document);
    const contents = parsed.contents;

    if (!isMap(contents) || !parsed.has(GPU_LAYERS_KEY)) {
      return document;
    }

    parsed.delete(GPU_LAYERS_KEY);

    // A map left with nothing in it stringifies as `{}`, which would read back as a document holding a flow map.
    return contents.items.length === 0 ? '' : String(parsed);
  }

  /**
   * An empty device list was a CPU instance and a full one took no CPU, since a node carrying both was refused
   * before this, so the old array says which of the two each row was.
   */
  private async reshapePins(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "instance" RENAME COLUMN "devices" TO "pins";
    `);

    await queryRunner.query(`
      UPDATE "instance"
      SET "pins" = jsonb_build_object('cpu', jsonb_array_length("pins") = 0, 'gpus', "pins");
    `);
  }

  /**
   * Blanking the applied side reads as out of date, which relaunches each deployment the key reached once. A
   * deployment inheriting it from a preset is included, since the preset write that would normally recompute its
   * revision is not what changed the preset here.
   */
  private async markOutOfDate(queryRunner: QueryRunner, presets: number[], deployments: number[]): Promise<void> {
    if (presets.length === 0 && deployments.length === 0) {
      return;
    }

    await queryRunner.query(
      `UPDATE "deployment" SET "appliedRevision" = '' WHERE "id" = ANY($1) OR "presetId" = ANY($2);`,
      [deployments, presets]
    );
  }

  /** Answers the ids it changed. A row without the key is never put back through the parser. */
  private async dropGpuLayers(queryRunner: QueryRunner, table: string): Promise<number[]> {
    const result: unknown = await queryRunner.query(
      `SELECT "id", "document" FROM "${table}" WHERE "configuration" ? '${GPU_LAYERS_KEY}';`
    );
    const rows = Array.isArray(result) ? result.filter(row => this.isStoredRow(row)) : [];

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE "${table}" SET "document" = $1, "configuration" = "configuration" - '${GPU_LAYERS_KEY}' ` +
          `WHERE "id" = $2;`,
        [this.withoutGpuLayers(row.document), row.id]
      );
    }

    return rows.map(row => row.id);
  }

  private isStoredRow(row: unknown): row is IStoredConfigurationRow {
    if (typeof row !== 'object' || row === null) {
      return false;
    }

    return 'id' in row && typeof row.id === 'number' && 'document' in row && typeof row.document === 'string';
  }
}
