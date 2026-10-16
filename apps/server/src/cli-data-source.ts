import { DataSource } from 'typeorm';

import { parseEnvironment } from '@libs/runtime';

import { environment } from './config/config.schema';
import { migrations, testMigrations } from './database/migrations';

const env = parseEnvironment(environment);

// eslint-disable-next-line @typescript-eslint/naming-convention
const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.TYPEORM_HOST,
  port: env.TYPEORM_PORT,
  username: env.TYPEORM_USERNAME,
  password: env.TYPEORM_PASSWORD,
  database: env.TYPEORM_DATABASE,
  migrations: env.USE_TEST_MIGRATIONS ? [...migrations, ...testMigrations] : migrations,
  extra: {
    ssl: env.TYPEORM_USE_SSL,
  },
});

module.exports = {
  AppDataSource,
};
