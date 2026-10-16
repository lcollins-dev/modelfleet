import { DataSource } from 'typeorm';

export interface IDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  superUsername: string;
  superPassword: string;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

export const getDatabaseConfig = (): IDatabaseConfig => {
  const database = process.env.TYPEORM_DATABASE ?? 'modelfleet_int';

  if (!IDENTIFIER_PATTERN.test(database)) {
    throw new Error(`TYPEORM_DATABASE is not a valid identifier: ${database}`);
  }

  // This database is dropped on every run, and the dev scripts export
  // TYPEORM_DATABASE=modelfleet.
  if (!database.endsWith('_int')) {
    throw new Error(`Refusing to drop "${database}" - the integration database name must end in _int`);
  }

  return {
    host: process.env.TYPEORM_HOST ?? 'localhost',
    port: Number(process.env.TYPEORM_PORT ?? 5432),
    database,
    username: process.env.TYPEORM_USERNAME ?? 'modelfleet',
    password: process.env.TYPEORM_PASSWORD ?? 'modelfleet',
    superUsername: process.env.TYPEORM_SUPERUSER ?? 'postgres',
    superPassword: process.env.TYPEORM_SUPERUSER_PASSWORD ?? 'postgres',
  };
};

export const withDataSource = async (dataSource: DataSource, work: (dataSource: DataSource) => Promise<void>) => {
  await dataSource.initialize();

  try {
    await work(dataSource);
  } finally {
    await dataSource.destroy();
  }
};

export const recreateDatabase = async (config: IDatabaseConfig): Promise<void> => {
  const maintenance = new DataSource({
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.superUsername,
    password: config.superPassword,
    database: 'postgres',
  });

  await withDataSource(maintenance, async dataSource => {
    // FORCE closes connections left by an interrupted run, which would block the drop.
    await dataSource.query(`DROP DATABASE IF EXISTS "${config.database}" WITH (FORCE)`);
    await dataSource.query(`CREATE DATABASE "${config.database}" WITH ENCODING 'UTF8'`);
    await dataSource.query(`GRANT CONNECT ON DATABASE "${config.database}" TO "${config.username}"`);
  });

  const created = new DataSource({
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.superUsername,
    password: config.superPassword,
    database: config.database,
  });

  // Schema grants have to be made while connected to the new database.
  await withDataSource(created, async dataSource => {
    await dataSource.query(`GRANT ALL ON SCHEMA public TO "${config.username}"`);
  });
};
