import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { Server, get } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapApp } from '../../setup';
import { listenGateway } from '@/app';

const INDEX_HTML = '<!doctype html><title>Modelfleet</title>';
const ASSET_JS = 'export const version = 1;';

const fetched = (port: number, path: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path }, response => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    }).on('error', reject);
  });

// Serving the web app changes what every unmatched route answers, so this file owns its app.
describe('Web app serving (integration, serial)', () => {
  let app: NestExpressApplication;
  let webRootPath: string;
  let gatewayPort: number;
  let gatewayServer: Server;

  beforeAll(async () => {
    webRootPath = mkdtempSync(join(tmpdir(), 'modelfleet-web-'));
    writeFileSync(join(webRootPath, 'index.html'), INDEX_HTML);
    mkdirSync(join(webRootPath, 'assets'));
    writeFileSync(join(webRootPath, 'assets', 'app.js'), ASSET_JS);

    process.env.WEB_ROOT_PATH = webRootPath;

    app = await bootstrapApp();

    gatewayServer = await listenGateway(app, 0);
    gatewayPort = (gatewayServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise(resolve => gatewayServer.close(resolve));

    rmSync(webRootPath, { recursive: true, force: true });
  });

  it('serves the web app at the root', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);

    expect(response.text).toBe(INDEX_HTML);
  });

  it('serves a built asset as itself', async () => {
    const response = await request(app.getHttpServer()).get('/assets/app.js').expect(200);

    expect(response.text).toBe(ASSET_JS);
  });

  it('falls back to the web app for a path outside /api', async () => {
    for (const path of ['/sign-in', '/nodes/1', '/deployments/3/configuration', '/apis', '/api-docs']) {
      const response = await request(app.getHttpServer()).get(path).expect(200);

      expect(response.text).toBe(INDEX_HTML);
    }
  });

  it('leaves the management API answering for itself', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/availability').expect(200);

    expect(response.body).toEqual({ available: true });
  });

  it('answers an unknown path under /api with a json 404 rather than the web app', async () => {
    for (const path of ['/api', '/api/', '/api/v1/does-not-exist', '/api/v2/does-not-exist?query=1']) {
      const response = await request(app.getHttpServer()).get(path).expect(404);

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body.statusCode).toBe(404);
    }
  });

  it('answers a non-GET request for an unknown path with a 404', async () => {
    await request(app.getHttpServer()).post('/sign-in').expect(404);
  });

  it('leaves the gateway answering on its own listener rather than the web app', async () => {
    const answer = await fetched(gatewayPort, '/v1/models');

    expect(answer.status).toBe(401);
    expect(answer.body).not.toBe(INDEX_HTML);
  });

  it('answers an unknown gateway route with a 404 rather than the web app', async () => {
    const answer = await fetched(gatewayPort, '/v1/does-not-exist');

    expect(answer.status).toBe(404);
    expect(answer.body).not.toBe(INDEX_HTML);
  });
});
