import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getBatchJobList = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/batch-job/list').set(authHeaders(token));

export const getBatchJob = (app: NestExpressApplication, token: string, batchJobId: number | string) =>
  request(app.getHttpServer()).get(`/api/v1/admin/batch-job/${batchJobId}`).set(authHeaders(token));

export const getBatchJobRunList = (
  app: NestExpressApplication,
  token: string,
  batchJobId: number,
  page: number | string = 1
) =>
  request(app.getHttpServer())
    .get(`/api/v1/admin/batch-job/${batchJobId}/runs`)
    .query({ page })
    .set(authHeaders(token));

export const updateBatchJobState = (
  app: NestExpressApplication,
  token: string,
  batchJobId: number,
  body: Record<string, unknown>
) =>
  request(app.getHttpServer()).patch(`/api/v1/admin/batch-job/${batchJobId}/state`).set(authHeaders(token)).send(body);

export const runBatchJob = (app: NestExpressApplication, token: string, batchJobId: number) =>
  request(app.getHttpServer()).post(`/api/v1/admin/batch-job/${batchJobId}/run`).set(authHeaders(token));
