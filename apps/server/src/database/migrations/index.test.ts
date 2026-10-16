import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { migrations, testMigrations } from '@/database/migrations';

const MIGRATIONS_DIR = __dirname;

const ascending = (left: number, right: number): number => left - right;

const timestampsOnDisk = (dir: string): number[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => /^(\d+)-(?!.*\.test\.ts$).+\.ts$/.exec(entry.name))
    .filter(match => match !== null)
    .map(match => Number(match[1]))
    .sort(ascending);

const registeredTimestamps = (registered: readonly (new () => MigrationInterface)[]): number[] =>
  registered.map(migration => Number(/\d+$/.exec(migration.name)?.[0]));

describe('migrations', () => {
  it('registers every migration file, so none is silently skipped at run time', () => {
    expect(registeredTimestamps(migrations).sort(ascending)).toEqual(timestampsOnDisk(MIGRATIONS_DIR));
  });

  it('registers every test migration file against testMigrations rather than migrations', () => {
    expect(registeredTimestamps(testMigrations).sort(ascending)).toEqual(
      timestampsOnDisk(join(MIGRATIONS_DIR, 'test'))
    );
  });

  it('lists migrations in timestamp order, which is the order they run in', () => {
    const timestamps = registeredTimestamps(migrations);

    expect(timestamps).toEqual([...timestamps].sort(ascending));
  });
});
