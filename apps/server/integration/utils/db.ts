import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';

export const dbQuery = <T = Record<string, unknown>>(
  app: NestExpressApplication,
  sql: string,
  params: unknown[] = []
): Promise<T[]> => app.get(DataSource).query(sql, params);
