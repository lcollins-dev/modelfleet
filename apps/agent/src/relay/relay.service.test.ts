import {
  ClientRequest,
  createServer,
  IncomingMessage,
  request as httpRequest,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InstanceState, RELAY_REFUSAL_HEADER, RelayError } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { ContainerService } from '@/docker/container.service';
import { InstanceEndpointService } from '@/instance/instance-endpoint.service';
import { InferenceRelayService } from '@/relay/inference/inference-relay.service';
import { LogsRelayService } from '@/relay/logs/logs-relay.service';
import { RelayTokenService } from '@/relay/relay-token.service';
import { RelayService } from '@/relay/relay.service';

const INSTANCE_KEY = '11111111-2222-4333-8444-555555555555';

const configService = { relayPort: 0, relayHeadersTimeoutMs: 2000 } as unknown as ConfigService;

const logsRelayService = new LogsRelayService({} as ContainerService);

interface IAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Server> {
  const server = createServer(handler);

  return new Promise<Server>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stop(server: Server): Promise<void> {
  return new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

function read(clientRequest: ClientRequest): Promise<IAnswer> {
  return new Promise<IAnswer>((resolve, reject) => {
    clientRequest.on('error', reject);
    clientRequest.on('response', response => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      response.on('error', reject);
    });
  });
}

describe('RelayService', () => {
  let relayService: RelayService;
  let relayTokenService: RelayTokenService;
  let instanceEndpointService: InstanceEndpointService;
  let backend: Server | null = null;
  let token: string;

  const send = (path: string, options: { method?: string; headers?: [string, string][]; body?: string } = {}) => {
    const clientRequest = httpRequest({
      host: '127.0.0.1',
      port: relayService.port ?? 0,
      method: options.method ?? 'GET',
      path,
      headers: Object.fromEntries([['authorization', `Bearer ${token}`], ...(options.headers ?? [])]),
    });

    clientRequest.end(options.body);

    return clientRequest;
  };

  const holdReady = (port: number) => {
    instanceEndpointService.replace(
      new Map([[INSTANCE_KEY, { instanceState: InstanceState.READY, address: { host: '127.0.0.1', port } }]])
    );
  };

  beforeEach(async () => {
    relayTokenService = new RelayTokenService();
    instanceEndpointService = new InstanceEndpointService();
    relayService = new RelayService(
      configService,
      relayTokenService,
      new InferenceRelayService(configService, instanceEndpointService),
      logsRelayService
    );

    token = relayTokenService.mint();

    await relayService.onApplicationBootstrap();
  });

  afterEach(async () => {
    await relayService.onApplicationShutdown();

    if (backend !== null) {
      await stop(backend);
      backend = null;
    }
  });

  describe('authentication', () => {
    it('refuses a request carrying no token', async () => {
      const unauthenticated = httpRequest({
        host: '127.0.0.1',
        port: relayService.port ?? 0,
        path: `/instances/${INSTANCE_KEY}/v1/models`,
      });

      unauthenticated.end();

      const answer = await read(unauthenticated);

      expect(answer.status).toBe(401);
      expect((JSON.parse(answer.body) as RelayError).error.code).toBe('unauthorized');
      expect(answer.headers[RELAY_REFUSAL_HEADER]).toBe('unauthorized');
    });

    it('refuses a request carrying a token the handshake did not mint', async () => {
      const answer = await read(
        send(`/instances/${INSTANCE_KEY}/v1/models`, { headers: [['authorization', 'Bearer not-the-token']] })
      );

      expect(answer.status).toBe(401);
    });

    it('refuses every request once the session that minted the token has gone', async () => {
      backend = await listen((_, response) => response.end('served'));
      holdReady(portOf(backend));

      relayTokenService.clear();

      expect((await read(send(`/instances/${INSTANCE_KEY}/v1/models`))).status).toBe(401);
    });
  });

  describe('dispatch', () => {
    it('refuses a target that names no instance', async () => {
      const answer = await read(send('/v1/models'));

      expect(answer.status).toBe(404);
      expect((JSON.parse(answer.body) as RelayError).error.code).toBe('not_found');
    });
  });
});
