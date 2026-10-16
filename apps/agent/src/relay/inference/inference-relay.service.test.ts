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

import { InstanceState, RelayError } from '@libs/agent-protocol';

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

interface IDeferred<TValue> {
  promise: Promise<TValue>;
  resolve: (value: TValue) => void;
}

function deferred<TValue>(): IDeferred<TValue> {
  let resolve!: (value: TValue) => void;
  const promise = new Promise<TValue>(settle => {
    resolve = settle;
  });

  return { promise, resolve };
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

describe('InferenceRelayService', () => {
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

  describe('resolving an instance', () => {
    it('names an instance this node does not hold rather than failing to connect', async () => {
      const answer = await read(send(`/instances/${INSTANCE_KEY}/v1/models`));

      const { error } = JSON.parse(answer.body) as RelayError;

      expect(answer.status).toBe(404);
      expect(error.code).toBe('instance_not_found');
      expect(error.message).toContain(INSTANCE_KEY);
    });

    it('names the state of an instance that is not ready', async () => {
      instanceEndpointService.replace(
        new Map([[INSTANCE_KEY, { instanceState: InstanceState.STARTING, address: null }]])
      );

      const answer = await read(send(`/instances/${INSTANCE_KEY}/v1/models`));

      const { error } = JSON.parse(answer.body) as RelayError;

      expect(answer.status).toBe(503);
      expect(error.code).toBe('instance_not_ready');
      expect(error.message).toContain(InstanceState.STARTING);
    });

    it('names an unreachable backend apart from a request the backend refused', async () => {
      const vacated = await listen((_, response) => response.end());
      const port = portOf(vacated);

      await stop(vacated);
      holdReady(port);

      const answer = await read(send(`/instances/${INSTANCE_KEY}/v1/models`));

      const { error } = JSON.parse(answer.body) as RelayError;

      expect(answer.status).toBe(502);
      expect(error.code).toBe('instance_unreachable');
      expect(error.message).toContain('ECONNREFUSED');
    });
  });

  describe('forwarding', () => {
    it('carries the method, path, query and body to the backend', async () => {
      const seen = deferred<{ method: string; url: string; body: string }>();

      backend = await listen((request, response) => {
        const chunks: Buffer[] = [];

        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          seen.resolve({
            method: request.method ?? '',
            url: request.url ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
          });

          response.end('ok');
        });
      });
      holdReady(portOf(backend));

      await read(
        send(`/instances/${INSTANCE_KEY}/v1/chat/completions?stream=false`, {
          method: 'POST',
          headers: [['content-type', 'application/json']],
          body: '{"model":"a"}',
        })
      );

      await expect(seen.promise).resolves.toEqual({
        method: 'POST',
        url: '/v1/chat/completions?stream=false',
        body: '{"model":"a"}',
      });
    });

    it('withholds the relay credential from the backend', async () => {
      const seen = deferred<string | undefined>();

      backend = await listen((request, response) => {
        seen.resolve(request.headers.authorization);
        response.end('ok');
      });
      holdReady(portOf(backend));

      await read(send(`/instances/${INSTANCE_KEY}/v1/models`));

      await expect(seen.promise).resolves.toBeUndefined();
    });

    it('answers with what the backend answered, a refusal of its own included', async () => {
      backend = await listen((_, response) => {
        response.setHeader('content-type', 'application/json');
        response.setHeader('x-backend', 'vllm');
        response.writeHead(422);
        response.end('{"error":"context length"}');
      });
      holdReady(portOf(backend));

      const answer = await read(send(`/instances/${INSTANCE_KEY}/v1/chat/completions`, { method: 'POST' }));

      expect(answer.status).toBe(422);
      expect(answer.headers['x-backend']).toBe('vllm');
      expect(answer.body).toBe('{"error":"context length"}');
    });
  });

  describe('streaming', () => {
    it('relays each chunk as it arrives rather than buffering the response to completion', async () => {
      const sawFirst = deferred<null>();

      backend = await listen((_, response) => {
        response.setHeader('content-type', 'text/event-stream');
        response.writeHead(200);
        response.write('data: first\n\n');

        sawFirst.promise
          .then(() => {
            response.write('data: second\n\n');
            response.end();
          })
          .catch(() => response.destroy());
      });
      holdReady(portOf(backend));

      const clientRequest = send(`/instances/${INSTANCE_KEY}/v1/chat/completions`, { method: 'POST' });
      const answer = read(clientRequest);

      clientRequest.on('response', response => {
        response.once('data', () => sawFirst.resolve(null));
      });

      // The backend writes its second chunk only once this client has the first, so a buffered relay never finishes.
      expect((await answer).body).toBe('data: first\n\ndata: second\n\n');
    });

    it('holds the backend back while the caller is not reading, rather than draining it into memory', async () => {
      const CHUNK = Buffer.alloc(64 * 1024, 'x');
      const MAX_WRITES = 256;
      const SETTLE_MS = 300;

      let writes = 0;
      let drained = false;

      backend = await listen((_, response) => {
        response.setHeader('content-type', 'application/octet-stream');
        response.writeHead(200);

        // Writes only as fast as the relay takes them, so what it manages is what backpressure allowed.
        const pump = () => {
          while (writes < MAX_WRITES) {
            writes += 1;

            if (!response.write(CHUNK)) {
              response.once('drain', pump);

              return;
            }
          }

          drained = true;
        };

        pump();
      });
      holdReady(portOf(backend));

      const clientRequest = send(`/instances/${INSTANCE_KEY}/v1/completions`, { method: 'POST' });

      await new Promise<void>(resolve => {
        clientRequest.on('response', () => resolve());
      });

      await new Promise<void>(resolve => {
        setTimeout(resolve, SETTLE_MS);
      });

      expect(drained).toBe(false);
      expect(writes).toBeLessThan(MAX_WRITES);

      clientRequest.destroy();
    });
  });

  describe('cancellation', () => {
    it('cancels the upstream request when the caller disconnects', async () => {
      const abandoned = deferred<null>();

      backend = await listen((_, response) => {
        response.setHeader('content-type', 'text/event-stream');
        response.writeHead(200);
        response.write('data: first\n\n');

        response.on('close', () => {
          if (!response.writableEnded) {
            abandoned.resolve(null);
          }
        });
      });
      holdReady(portOf(backend));

      const clientRequest = send(`/instances/${INSTANCE_KEY}/v1/chat/completions`, { method: 'POST' });

      clientRequest.on('error', () => {});

      await new Promise<void>(resolve => {
        clientRequest.on('response', response => response.once('data', () => resolve()));
      });

      clientRequest.destroy();

      await expect(abandoned.promise).resolves.toBeNull();
    });

    it('cancels a request the caller abandons before the backend has answered at all', async () => {
      const arrived = deferred<null>();
      const abandoned = deferred<null>();

      backend = await listen((request, response) => {
        request.resume();
        arrived.resolve(null);

        // Answers nothing, so only the caller going away can end this request.
        response.on('close', () => {
          if (!response.writableEnded) {
            abandoned.resolve(null);
          }
        });
      });
      holdReady(portOf(backend));

      const clientRequest = send(`/instances/${INSTANCE_KEY}/v1/chat/completions`, { method: 'POST' });

      clientRequest.on('error', () => {});

      await arrived.promise;

      clientRequest.destroy();

      await expect(abandoned.promise).resolves.toBeNull();
    });
  });

  describe('deadlines', () => {
    const DEADLINE_MS = 100;

    let deadlineRelay: RelayService;

    const sendTo = (accept: string) => {
      const clientRequest = httpRequest({
        host: '127.0.0.1',
        port: deadlineRelay.port ?? 0,
        method: 'POST',
        path: `/instances/${INSTANCE_KEY}/v1/audio/transcriptions`,
        headers: { authorization: `Bearer ${token}`, accept },
      });

      clientRequest.end();

      return clientRequest;
    };

    beforeEach(async () => {
      const deadlineConfig = { relayPort: 0, relayHeadersTimeoutMs: DEADLINE_MS } as unknown as ConfigService;

      deadlineRelay = new RelayService(
        deadlineConfig,
        relayTokenService,
        new InferenceRelayService(deadlineConfig, instanceEndpointService),
        logsRelayService
      );

      await deadlineRelay.onApplicationBootstrap();
    });

    afterEach(async () => {
      await deadlineRelay.onApplicationShutdown();
    });

    it('waits on a whole answer past the headers deadline, however long the work takes', async () => {
      backend = await listen((request, response) => {
        request.resume();
        response.setHeader('content-type', 'application/json');
        setTimeout(() => response.writeHead(200).end('{"text":"hi"}'), DEADLINE_MS * 3);
      });
      holdReady(portOf(backend));

      const answer = await read(sendTo('application/json'));

      expect(answer.status).toBe(200);
      expect(answer.body).toBe('{"text":"hi"}');
    });

    it('refuses a stream whose head does not arrive by the deadline', async () => {
      backend = await listen(request => {
        request.resume();
      });
      holdReady(portOf(backend));

      const answer = await read(sendTo('text/event-stream'));
      const refusal = JSON.parse(answer.body) as RelayError;

      expect(answer.status).toBe(502);
      expect(refusal.error.code).toBe('instance_unreachable');
    });
  });
});
