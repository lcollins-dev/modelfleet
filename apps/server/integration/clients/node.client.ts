import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const registerNode = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/admin/node').set(authHeaders(token)).send(body);

export const getNodeList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown> = {},
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/node/list?page=${page}`).set(authHeaders(token)).send(body);

export const getNode = (app: NestExpressApplication, token: string, nodeId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/node/${nodeId}`).set(authHeaders(token));

export const updateNode = (app: NestExpressApplication, token: string, nodeId: number, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(`/api/v1/admin/node/${nodeId}`).set(authHeaders(token)).send(body);

export const updateNodeState = (
  app: NestExpressApplication,
  token: string,
  nodeId: number,
  body: Record<string, unknown>
) => request(app.getHttpServer()).patch(`/api/v1/admin/node/${nodeId}/state`).set(authHeaders(token)).send(body);

export const deleteNode = (app: NestExpressApplication, token: string, nodeId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/node/${nodeId}`).set(authHeaders(token));
