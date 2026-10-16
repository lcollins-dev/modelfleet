import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const createApiKey = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/admin/api-key').set(authHeaders(token)).send(body);

export const getApiKeyList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown> = {},
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/api-key/list?page=${page}`).set(authHeaders(token)).send(body);

export const getApiKeyStats = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/api-key/stats').set(authHeaders(token));

export const revokeApiKey = (app: NestExpressApplication, token: string, apiKeyId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/api-key/${apiKeyId}`).set(authHeaders(token));
