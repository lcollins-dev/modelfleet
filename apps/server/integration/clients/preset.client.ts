import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getPresetList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown> = {},
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/preset/list?page=${page}`).set(authHeaders(token)).send(body);

export const createPreset = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/admin/preset').set(authHeaders(token)).send(body);

export const getPreset = (app: NestExpressApplication, token: string, presetId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/preset/${presetId}`).set(authHeaders(token));

export const updatePreset = (
  app: NestExpressApplication,
  token: string,
  presetId: number,
  body: Record<string, unknown>
) => request(app.getHttpServer()).patch(`/api/v1/admin/preset/${presetId}`).set(authHeaders(token)).send(body);

export const getPresetImpact = (
  app: NestExpressApplication,
  token: string,
  presetId: number,
  body: Record<string, unknown>
) => request(app.getHttpServer()).patch(`/api/v1/admin/preset/${presetId}/impact`).set(authHeaders(token)).send(body);

export const deletePreset = (app: NestExpressApplication, token: string, presetId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/preset/${presetId}`).set(authHeaders(token));
