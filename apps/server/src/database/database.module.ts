import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { addTransactionalDataSource } from 'typeorm-transactional';

import { ConfigService } from '../config/config.service';

import { ConfigModule } from '../config/config.module';

import { migrations, testMigrations } from './migrations';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.typeormHost,
        port: configService.typeormPort,
        username: configService.typeormUsername,
        password: configService.typeormPassword,
        database: configService.typeormDatabase,
        logging: configService.typeormLogging,
        autoLoadEntities: true,
        entitySkipConstructor: true,
        migrations: configService.useTestMigrations ? [...migrations, ...testMigrations] : migrations,
        migrationsRun: configService.typeormMigrationsRun,
        extra: {
          ssl: configService.typeormUseSSL,
        },
      }),
      dataSourceFactory(options) {
        if (!options) {
          throw new Error('Invalid options passed');
        }

        return Promise.resolve(addTransactionalDataSource(new DataSource(options)));
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
