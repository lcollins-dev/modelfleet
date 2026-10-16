import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getNodeTelemetryStatus = (app: NestExpressApplication, token: string, nodeId: number) =>
  request(app.getHttpServer()).get(`/api/v1/admin/node/${nodeId}/telemetry`).set(authHeaders(token));

export const getFleetTelemetry = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/telemetry').set(authHeaders(token));
