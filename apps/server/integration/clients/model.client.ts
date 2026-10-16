import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getModelList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown> = {},
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/model/list?page=${page}`).set(authHeaders(token)).send(body);

export const getModel = (app: NestExpressApplication, token: string, modelId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/model/${modelId}`).set(authHeaders(token));

export const updateModel = (
  app: NestExpressApplication,
  token: string,
  modelId: number,
  body: Record<string, unknown>
) => request(app.getHttpServer()).patch(`/api/v1/admin/model/${modelId}`).set(authHeaders(token)).send(body);

export const deleteModel = (app: NestExpressApplication, token: string, modelId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/model/${modelId}`).set(authHeaders(token));

export const getNodeModelInventory = (app: NestExpressApplication, token: string, nodeId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/node/${nodeId}/model`).set(authHeaders(token));

export const scanNodeModels = (app: NestExpressApplication, token: string, nodeId: number) =>
  request(app.getHttpServer()).post(`/api/v1/admin/node/${nodeId}/model/scan`).set(authHeaders(token));
