import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { Server, get } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { createApiKey } from '../../clients/api-key.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { listenGateway } from '@/app';

const LIMIT = 3;
const ADDRESS_LIMIT = 8;

const UNKNOWN_KEY = 'mfk_000000000000000000000000_wrong';

const fetched = (port: number, token: string, forwardedFor?: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };

    if (forwardedFor !== undefined) {
      headers['x-forwarded-for'] = forwardedFor;
    }

    get({ host: '127.0.0.1', port, path: '/v1/models', headers }, response => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    }).on('error', reject);
  });

// Lowering the gateway's budget changes what every gateway route answers, so this file owns its app.
describe('Gateway throttle (integration, serial)', () => {
  let app: NestExpressApplication;
  let gatewayPort: number;
  let gatewayServer: Server;
  let firstKey: string;
  let secondKey: string;

  beforeAll(async () => {
    process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS = `${LIMIT}`;
    process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS_PER_ADDRESS = `${ADDRESS_LIMIT}`;
    process.env.TRUST_PROXY = 'loopback';

    app = await bootstrapApp();
    gatewayServer = await listenGateway(app, 0);
    gatewayPort = (gatewayServer.address() as AddressInfo).port;

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    const adminToken = await login(app, admin.email);

    firstKey = (await createApiKey(app, adminToken, { name: `key-${randomUUID()}` }).expect(201)).body.token;
    secondKey = (await createApiKey(app, adminToken, { name: `key-${randomUUID()}` }).expect(201)).body.token;
  });

  afterAll(async () => {
    await new Promise(resolve => gatewayServer.close(resolve));
    await app.close();
  });

  it('budgets each key on its own rather than every caller behind one address', async () => {
    for (let index = 0; index < LIMIT; index++) {
      expect((await fetched(gatewayPort, firstKey)).status).toBe(200);
    }

    const throttled = await fetched(gatewayPort, firstKey);

    expect(throttled.status).toBe(429);
    expect(JSON.parse(throttled.body).error.type).toBe('rate_limit_error');

    expect((await fetched(gatewayPort, secondKey)).status).toBe(200);
  });

  it('bounds an address presenting keys that never verify', async () => {
    const statuses: number[] = [];

    for (let index = 0; index < ADDRESS_LIMIT; index++) {
      statuses.push((await fetched(gatewayPort, UNKNOWN_KEY)).status);
    }

    expect(statuses).toContain(401);
    expect(statuses.at(-1)).toBe(429);
  });

  it('budgets each client a trusted proxy names on its own', async () => {
    for (let index = 0; index < ADDRESS_LIMIT; index++) {
      await fetched(gatewayPort, UNKNOWN_KEY, '198.51.100.1');
    }

    expect((await fetched(gatewayPort, UNKNOWN_KEY, '198.51.100.1')).status).toBe(429);
    expect((await fetched(gatewayPort, UNKNOWN_KEY, '198.51.100.2')).status).toBe(401);
  });
});
