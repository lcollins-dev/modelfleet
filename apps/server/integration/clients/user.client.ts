import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { TEST_PASSWORD } from '../factories/user.factory';
import { authHeaders } from '../utils/auth';

export const loginRequest = (app: NestExpressApplication, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/user/login').send(body);

export const login = async (
  app: NestExpressApplication,
  email: string,
  password: string = TEST_PASSWORD
): Promise<string> => {
  const response = await loginRequest(app, { email, password }).expect(201);

  return String(response.body.token);
};

export const getProfile = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/user/profile').set(authHeaders(token));

export const logout = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).post('/api/v1/user/logout').set(authHeaders(token));

export const getUserRoles = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/user/role/list').set(authHeaders(token));

export const getUserList = (
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown>,
  page: number = 1
) => request(app.getHttpServer()).patch(`/api/v1/admin/user/list?page=${page}`).set(authHeaders(token)).send(body);

export const getUserStats = (app: NestExpressApplication, token: string) =>
  request(app.getHttpServer()).get('/api/v1/admin/user/stats').set(authHeaders(token));

export const createUser = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/admin/user').set(authHeaders(token)).send(body);

export const getUser = (app: NestExpressApplication, token: string, userId: number | string) =>
  request(app.getHttpServer()).get(`/api/v1/admin/user/${userId}`).set(authHeaders(token));

export const updateUser = (app: NestExpressApplication, token: string, userId: number, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(`/api/v1/admin/user/${userId}`).set(authHeaders(token)).send(body);

export const updateUserState = (
  app: NestExpressApplication,
  token: string,
  userId: number,
  body: Record<string, unknown>
) => request(app.getHttpServer()).patch(`/api/v1/admin/user/${userId}/state`).set(authHeaders(token)).send(body);

export const logoutAllSessions = (app: NestExpressApplication, token: string, userId: number) =>
  request(app.getHttpServer()).patch(`/api/v1/admin/user/${userId}/logout-all-sessions`).set(authHeaders(token));
