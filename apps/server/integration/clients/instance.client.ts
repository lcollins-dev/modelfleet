import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getDeploymentInstances = (app: NestExpressApplication, token: string, deploymentId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/deployment/${deploymentId}/instance`).set(authHeaders(token));

export const startDeployment = (app: NestExpressApplication, token: string, deploymentId: number) =>
  request(app.getHttpServer()).post(`/api/v1/admin/deployment/${deploymentId}/instance`).set(authHeaders(token));

export const getNodeInstances = (app: NestExpressApplication, token: string, nodeId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/node/${nodeId}/instance`).set(authHeaders(token));

export const stopDeployment = (app: NestExpressApplication, token: string, deploymentId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/deployment/${deploymentId}/instance`).set(authHeaders(token));

export const getInstances = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/instance').set(authHeaders(token));

export const previewPlacement = (app: NestExpressApplication, token: string, body: object) =>
  request(app.getHttpServer()).patch('/api/v1/admin/instance/placement-preview').set(authHeaders(token)).send(body);
