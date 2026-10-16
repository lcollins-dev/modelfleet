import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getEventList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown> = {},
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/event/list?page=${page}`).set(authHeaders(token)).send(body);

export const getEventStream = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/event/stream').set(authHeaders(token));
