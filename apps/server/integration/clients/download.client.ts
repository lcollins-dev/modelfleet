import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const createDownload = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/admin/download').set(authHeaders(token)).send(body);

export const getRepositoryListing = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch('/api/v1/admin/download/listing').set(authHeaders(token)).send(body);

export const getDownload = (app: NestExpressApplication, token: string, downloadId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/download/${downloadId}`).set(authHeaders(token));

export const getDownloadList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown> = {},
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/download/list?page=${page}`).set(authHeaders(token)).send(body);

export const retryDownload = (app: NestExpressApplication, token: string, downloadId: number) =>
  request(app.getHttpServer()).post(`/api/v1/admin/download/${downloadId}/retry`).set(authHeaders(token));

export const stopDownload = (
  app: NestExpressApplication,
  token: string,
  downloadId: number,
  body: Record<string, unknown> = {}
) => request(app.getHttpServer()).post(`/api/v1/admin/download/${downloadId}/stop`).set(authHeaders(token)).send(body);

export const dismissDownload = (app: NestExpressApplication, token: string, downloadId: number) =>
  request(app.getHttpServer()).delete(`/api/v1/admin/download/${downloadId}`).set(authHeaders(token));
