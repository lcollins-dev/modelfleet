import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';

describe('Public routes (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  describe('availability', () => {
    it('answers without a session', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/availability').expect(200);

      expect(response.body).toEqual({ available: true });
    });

    it('answers the same when a bad token is sent', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/availability')
        .set(authHeaders('not-a-token'))
        .expect(200);

      expect(response.body).toEqual({ available: true });
    });
  });

  describe('version', () => {
    it('reports a version without a session', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/version').expect(200);

      expect(typeof response.body.version).toBe('string');
      expect(response.body.version.length).toBeGreaterThan(0);
    });
  });

  describe('unknown routes', () => {
    it('answers a request for a route that does not exist with a 404', async () => {
      await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    });
  });
});
