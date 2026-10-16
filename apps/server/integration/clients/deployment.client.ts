import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getDeploymentList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown> = {},
  page: number = 1
) =>
  request(app.getHttpServer()).patch(`/api/v1/admin/deployment/list?page=${page}`).set(authHeaders(token)).send(body);

export const createDeployment = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/admin/deployment').set(authHeaders(token)).send(body);

export const getDeployment = (app: NestExpressApplication, token: string, deploymentId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/deployment/${deploymentId}`).set(authHeaders(token));

export const updateDeployment = (
  app: NestExpressApplication,
  token: string,
  deploymentId: number,
  body: Record<string, unknown>
) => request(app.getHttpServer()).patch(`/api/v1/admin/deployment/${deploymentId}`).set(authHeaders(token)).send(body);

export const getDeploymentConfiguration = (app: NestExpressApplication, token: string, deploymentId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/deployment/${deploymentId}/configuration`).set(authHeaders(token));

export const previewPresetSwap = (
  app: NestExpressApplication,
  token: string,
  deploymentId: number,
  body: Record<string, unknown>
) =>
  request(app.getHttpServer())
    .patch(`/api/v1/admin/deployment/${deploymentId}/preset-swap`)
    .set(authHeaders(token))
    .send(body);

export const getOutOfDateDeployments = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/deployment/out-of-date').set(authHeaders(token));

export const applyDeployment = (app: NestExpressApplication, token: string, deploymentId: number) =>
  request(app.getHttpServer()).post(`/api/v1/admin/deployment/${deploymentId}/apply`).set(authHeaders(token));

export const applyDeployments = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).post('/api/v1/admin/deployment/apply').set(authHeaders(token));

export const deleteDeployment = (app: NestExpressApplication, token: string, deploymentId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/deployment/${deploymentId}`).set(authHeaders(token));
