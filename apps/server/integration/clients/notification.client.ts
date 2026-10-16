import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { authHeaders } from '../utils/auth';

export const getNotificationList = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/notification/list').set(authHeaders(token));

export const clearNotification = (app: NestExpressApplication, token: string, notificationId: number | string) =>
  request(app.getHttpServer()).patch(`/api/v1/notification/${notificationId}/clear`).set(authHeaders(token));
