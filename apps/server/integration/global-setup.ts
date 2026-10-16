import { DataSource } from 'typeorm';

import { BatchJobId } from '@libs/dto';

import { getDatabaseConfig, recreateDatabase } from './utils/database';
import { FakeHub } from './utils/fake-hub';
import { migrations, testMigrations } from '@/database/migrations';

/** Returns the teardown, which stops the fake Hub every worker was pointed at. */
export default async function setup(): Promise<() => Promise<void>> {
  const config = getDatabaseConfig();

  await recreateDatabase(config);

  const dataSource = new DataSource({
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.database,
    migrations: [...migrations, ...testMigrations],
  });

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();

    // The specs reconcile their own deployments, so the job's fleet-wide pass must not act between their steps.
    await dataSource.query('UPDATE batch_job SET enabled = false WHERE id = $1', [BatchJobId.RESIDENCY]);
  } finally {
    await dataSource.destroy();
  }

  // Set before any worker forks, so every app a spec creates reads repositories from here, never from the Hub.
  const fakeHub = new FakeHub();

  process.env.HUGGINGFACE_ENDPOINT = await fakeHub.start();

  return () => fakeHub.stop();
}
