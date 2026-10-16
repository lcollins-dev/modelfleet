import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import {
  ClientRequest,
  IncomingMessage,
  Server,
  ServerResponse,
  createServer,
  request as httpRequest,
} from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { WebSocket } from 'ws';

import {
  AGENT_SOCKET_PATH,
  AgentMessageType,
  InstanceState,
  ModelTask,
  PROTOCOL_VERSION,
  encodeAgentMessage,
} from '@libs/agent-protocol';
import { BackendId, GIB } from '@libs/backends';
import { ActivationPolicy, EventType, InstanceChangeReason, UserRoleId } from '@libs/dto';

import { InferenceMetricsService } from '@/core/inference/inference-metrics.service';

import { createApiKey } from '../../clients/api-key.client';
import { createDeployment, deleteDeployment } from '../../clients/deployment.client';
import { updateModel } from '../../clients/model.client';
import { registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { ESTIMABLE_METADATA, reportCard } from '../../utils/ledger';
import { listenGateway } from '@/app';

const RELAY_TOKEN = 'a-relay-token-long-enough-for-the-schema';

const DEPLOYMENT_DOCUMENT = 'image: ghcr.io/ggml-org/llama.cpp:server\ncontextSize: 4096\n';

const WEIGHTS_PATH = '/srv/models/llama-3-8b.gguf';

const DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';

/** Far more than any buffer in the chain holds, so taking them all would mean nothing was gating the flow. */
const BACKPRESSURE_CHUNKS = 60_000;

interface IRelayCall {
  method: string;
  url: string;
  authorization: string;
  contentType: string;
  body: string;
  bytes: Buffer;
  request: IncomingMessage;
  response: ServerResponse;
}

interface IAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface IInstanceRow {
  instanceKey: string;
  instanceState: string;
}

interface IOpenStream {
  request: ClientRequest;
  response: IncomingMessage;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const CLIENT_CLOSED_REQUEST = 499;

const until = async (reached: () => boolean, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!reached()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the stream to move');
    }

    await sleep(10);
  }
};

const COMPLETION = JSON.stringify({
  id: 'cmpl-1',
  created: 1,
  model: 'llama',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const chunkOf = (content: string): string =>
  `data: ${JSON.stringify({
    id: 'chunk-1',
    created: 1,
    model: 'llama',
    choices: [{ index: 0, delta: { content } }],
  })}\n\n`;

/** Plays the node agent's relay: it checks the session token, reads the instance key, and answers as a backend. */
class FakeRelay {
  readonly calls: IRelayCall[] = [];

  private readonly server: Server;

  private answer: (call: IRelayCall) => void = call => call.response.writeHead(200).end('{}');

  constructor() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];

      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const call: IRelayCall = {
          method: request.method ?? '',
          url: request.url ?? '',
          authorization: request.headers.authorization ?? '',
          contentType: request.headers['content-type'] ?? '',
          body: bytes.toString('utf8'),
          bytes,
          request,
          response,
        };

        this.calls.push(call);

        if (call.authorization !== `Bearer ${RELAY_TOKEN}`) {
          response.writeHead(401).end('{}');

          return;
        }

        this.answer(call);
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  answersWith(answer: (call: IRelayCall) => void): void {
    this.answer = answer;
  }

  forget(): void {
    this.calls.length = 0;
  }

  listen(): Promise<void> {
    return new Promise(resolve => this.server.listen(0, resolve));
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }
}

describe('Gateway inference (integration, serial)', () => {
  let app: NestExpressApplication;
  let gatewayPort: number;
  let gatewayServer: Server;
  let adminToken: string;
  let apiKeyToken: string;
  let relay: FakeRelay;
  let socket: WebSocket;
  let nodeId: number;

  const uniqueName = (prefix: string): string => `${prefix}-${randomUUID()}`;

  const call = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    raw?: string | Buffer
  ): Promise<IAnswer> => {
    const payload = raw ?? (body === undefined ? '' : JSON.stringify(body));

    return new Promise<IAnswer>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: gatewayPort,
          path,
          method: body === undefined && raw === undefined ? 'GET' : 'POST',
          headers: {
            authorization: `Bearer ${apiKeyToken}`,
            'content-type': 'application/json',
            ...headers,
          },
        },
        response => {
          let received = '';

          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (received += chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body: received })
          );
        }
      );

      request.on('error', reject);
      request.end(payload);
    });
  };

  const openStream = (path: string, body: unknown): Promise<IOpenStream> =>
    new Promise<IOpenStream>((resolve, reject) => {
      const payload = JSON.stringify(body);

      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: gatewayPort,
          path,
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKeyToken}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
        },
        response => resolve({ request, response })
      );

      request.on('error', reject);
      request.end(payload);
    });

  const backendAnswering = (write: (backend: ServerResponse) => void): Promise<ServerResponse> =>
    new Promise<ServerResponse>(resolve => {
      relay.answersWith(relayCall => {
        relayCall.response.writeHead(200, { 'content-type': 'text/event-stream' });

        // Node holds the head back until something is written, and the gateway answers on the head alone.
        relayCall.response.flushHeaders();

        write(relayCall.response);
        resolve(relayCall.response);
      });
    });

  const insertModel = async (tasks: ModelTask[]): Promise<number> => {
    const rows = await dbQuery<{ id: number }>(
      app,
      `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name", "detectedTasks")
       VALUES ($1, 'gguf', 'model', 1000, 1, 'Llama 3 8B', $2) RETURNING id`,
      [randomUUID().replaceAll('-', '').padEnd(64, '0'), tasks]
    );

    return rows[0].id;
  };

  const createTestDeployment = async (tasks: ModelTask[] = []): Promise<{ id: number; name: string }> => {
    const name = uniqueName('chat');
    const response = await createDeployment(app, adminToken, {
      name,
      modelId: await insertModel(tasks),
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ON_DEMAND,
      document: DEPLOYMENT_DOCUMENT,
    }).expect(201);

    return { id: response.body.id, name };
  };

  const insertReadyInstance = async (deploymentId: number, configurationRevision = 'rev'): Promise<string> => {
    const instanceKey = randomUUID();

    await dbQuery(
      app,
      `INSERT INTO "instance"
         ("instanceKey", "deploymentId", "nodeId", "revision", "configurationRevision", "pins", "instanceState")
       VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6)`,
      [
        instanceKey,
        deploymentId,
        nodeId,
        configurationRevision,
        JSON.stringify({ cpu: true, gpus: [] }),
        InstanceState.READY,
      ]
    );

    return instanceKey;
  };

  /** Pinned to the connected node's CPU, which admission sizes against nothing, so a request can start it. */
  const createColdDeployment = async (
    placement = `placement:\n  nodeIds:\n    - ${nodeId}\n`,
    tasks: ModelTask[] = []
  ) => {
    const models = await dbQuery<{ id: number }>(
      app,
      `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name", "ggufMetadata", "detectedTasks")
       VALUES ($1, 'gguf', 'model', 1000, 1, 'Llama 3 8B', $2, $3) RETURNING id`,
      [randomUUID().replaceAll('-', '').padEnd(64, '0'), JSON.stringify(ESTIMABLE_METADATA), tasks]
    );

    await dbQuery(
      app,
      `INSERT INTO "availability" ("modelId", "nodeId", "path", "lastConfirmedDate") VALUES ($1, $2, $3, now())`,
      [models[0].id, nodeId, WEIGHTS_PATH]
    );

    const name = uniqueName('cold');
    const response = await createDeployment(app, adminToken, {
      name,
      modelId: models[0].id,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ON_DEMAND,
      document: `${DEPLOYMENT_DOCUMENT}${placement}`,
    }).expect(201);

    return { id: response.body.id as number, name };
  };

  const instancesOf = (deploymentId: number): Promise<IInstanceRow[]> =>
    dbQuery<IInstanceRow>(
      app,
      'SELECT "instanceKey", "instanceState" FROM "instance" WHERE "deploymentId" = $1 ORDER BY "instanceKey"',
      [deploymentId]
    );

  /** Waits for the request to start the deployment, and answers with the one instance it started. */
  const startedBy = async (deploymentId: number): Promise<string> => {
    await vi.waitFor(async () => expect(await instancesOf(deploymentId)).toHaveLength(1), { timeout: 10_000 });

    const [instance] = await instancesOf(deploymentId);

    return instance.instanceKey;
  };

  const reportInstance = (instanceKey: string, instanceState: InstanceState, message: string | null = null): void => {
    socket.send(
      encodeAgentMessage(AgentMessageType.OBSERVED_STATE, {
        desiredGeneration: null,
        instances: [{ instanceKey, revision: 1, instanceState, message, uptimeMs: null, exitCode: null }],
      })
    );
  };

  const completion = (name: string, stream = false) => ({
    model: name,
    messages: [{ role: 'user', content: 'hi' }],
    ...(stream ? { stream: true } : {}),
  });

  beforeAll(async () => {
    app = await bootstrapApp();
    await app.listen(0);

    gatewayServer = await listenGateway(app, 0);
    gatewayPort = (gatewayServer.address() as AddressInfo).port;

    relay = new FakeRelay();
    await relay.listen();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    const issued = await createApiKey(app, adminToken, { name: uniqueName('key') }).expect(201);
    apiKeyToken = issued.body.token;

    const node = await registerNode(app, adminToken, { name: uniqueName('node') }).expect(201);
    nodeId = node.body.id;

    const address = app.getHttpServer().address() as AddressInfo;
    socket = new WebSocket(`ws://127.0.0.1:${address.port}${AGENT_SOCKET_PATH}`);

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    socket.send(
      encodeAgentMessage(AgentMessageType.HELLO, {
        nodeKey: node.body.nodeKey,
        secret: node.body.secret,
        agentVersion: 'integration',
        protocolVersions: [PROTOCOL_VERSION],
        relay: { url: relay.url, token: RELAY_TOKEN },
      })
    );

    await new Promise<void>(resolve => socket.once('message', () => resolve()));
  });

  afterAll(async () => {
    socket.close();

    await relay.close();
    await new Promise(resolve => gatewayServer.close(resolve));
    await app.close();
  });

  beforeEach(() => {
    relay.forget();
  });

  describe('the listener', () => {
    it('refuses the management API on the gateway port', async () => {
      const answer = await call('/api/v1/admin/user/list', undefined);

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body)).toHaveProperty('error.type', 'not_found_error');
    });

    it('refuses the inference routes on the management port', async () => {
      const response = await request(app.getHttpServer()).get('/v1/models');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ statusCode: 404, message: 'Not Found' });
    });

    it('refuses an absolute-form request line for an inference route on the management port', async () => {
      const address = app.getHttpServer().address() as AddressInfo;

      const answer = await new Promise<number>((resolve, reject) => {
        httpRequest({ host: '127.0.0.1', port: address.port, path: 'http://example.test/v1/models' }, response => {
          response.resume();
          resolve(response.statusCode ?? 0);
        })
          .on('error', reject)
          .end();
      });

      expect(answer).toBe(404);
    });

    it('routes the inference path case-insensitively, as the router does', async () => {
      const answer = await call('/V1/models', undefined);

      expect(answer.status).toBe(200);
    });

    it('refuses a caller presenting no key', async () => {
      const answer = await call('/v1/models', undefined, { authorization: '' });

      expect(answer.status).toBe(401);
      expect(JSON.parse(answer.body)).toHaveProperty('error.code', 'invalid_api_key');
    });

    it('refuses a caller presenting an unknown key', async () => {
      const answer = await call('/v1/models', undefined, { authorization: 'Bearer mfk_deadbeef_nope' });

      expect(answer.status).toBe(401);
    });
  });

  describe('body limits', () => {
    // Above the management API's 8mb and below the gateway's 32mb.
    const MIDDLING = 12 * 1024 * 1024;
    const OVERSIZED = 40 * 1024 * 1024;

    const promptOf = (bytes: number) => ({
      model: 'nothing-here',
      messages: [{ role: 'user', content: 'x'.repeat(bytes) }],
    });

    it('reads a body the management API would refuse, to the gateway limit', async () => {
      const answer = await call('/v1/chat/completions', promptOf(MIDDLING));

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body).error.code).toBe('model_not_found');
    });

    it('still holds the management API to its own limit', async () => {
      const response = await request(app.getHttpServer()).post('/api/v1/user/login').send(promptOf(MIDDLING));

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Request body is too large');
    });

    it('refuses a body over the gateway limit with a 413 in OpenAI form', async () => {
      const answer = await call('/v1/chat/completions', promptOf(OVERSIZED));

      expect(answer.status).toBe(413);
      expect(JSON.parse(answer.body).error.type).toBe('invalid_request_error');
    });

    it('refuses a body that is not JSON in OpenAI form', async () => {
      const answer = await call('/v1/chat/completions', undefined, {}, '{"model": ');

      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.body).error.type).toBe('invalid_request_error');
    });

    it('answers a path no route serves in OpenAI form', async () => {
      const answer = await call('/v1/does-not-exist', undefined);

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body).error.type).toBe('not_found_error');
    });
  });

  describe('GET /v1/models', () => {
    it('lists a deployment that is running nothing', async () => {
      const deployment = await createTestDeployment();

      const answer = await call('/v1/models', undefined);
      const listed = JSON.parse(answer.body);

      expect(answer.status).toBe(200);
      expect(listed.object).toBe('list');
      expect(listed.data).toContainEqual(
        expect.objectContaining({ id: deployment.name, object: 'model', owned_by: 'modelfleet' })
      );
    });
  });

  describe('resolution', () => {
    it('answers chat to a deployment whose model transcribes with unsupported_operation, never reaching a node', async () => {
      const deployment = await createTestDeployment();

      await dbQuery(
        app,
        `UPDATE "model" SET "detectedTasks" = '{transcription}' WHERE "id" = (SELECT "modelId" FROM "deployment" WHERE "id" = $1)`,
        [deployment.id]
      );

      const answer = await call('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body).error).toMatchObject({ code: 'unsupported_operation' });
      expect(relay.calls).toHaveLength(0);
    });

    it('refuses embeddings to a chat model without starting an instance', async () => {
      const deployment = await createColdDeployment(undefined, [ModelTask.CHAT]);

      relay.forget();

      const answer = await call('/v1/embeddings', { model: deployment.name, input: 'hi' });

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body).error).toMatchObject({ code: 'unsupported_operation' });
      expect(await instancesOf(deployment.id)).toHaveLength(0);
      expect(relay.calls).toHaveLength(0);
    });

    it("routes by an admin's tasks from the next request after they are set", async () => {
      const deployment = await createTestDeployment([ModelTask.CHAT]);
      const [{ modelId }] = await dbQuery<{ modelId: number }>(
        app,
        'SELECT "modelId" FROM "deployment" WHERE "id" = $1',
        [deployment.id]
      );

      await insertReadyInstance(deployment.id);
      relay.forget();

      const before = await call('/v1/embeddings', { model: deployment.name, input: 'hi' });

      await updateModel(app, adminToken, modelId, { tasks: [ModelTask.CHAT, ModelTask.EMBEDDING] }).expect(200);

      relay.answersWith(relayCall => {
        relayCall.response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ data: [{ index: 0, embedding: [0.1] }], model: 'llama' }));
      });

      const after = await call('/v1/embeddings', { model: deployment.name, input: 'hi' });

      expect(before.status).toBe(404);
      expect(after.status).toBe(200);
    });

    it('answers a name matching no deployment with model_not_found', async () => {
      const answer = await call('/v1/chat/completions', { model: 'nothing-here', messages: [{ role: 'user' }] });

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body).error).toMatchObject({ code: 'model_not_found', param: 'model' });
    });

    it('answers a deployment that cannot be started with a 503 saying why', async () => {
      const deployment = await createTestDeployment();

      const answer = await call('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(answer.status).toBe(503);
      expect(JSON.parse(answer.body).error).toMatchObject({
        code: 'model_cannot_start',
        message: `The model '${deployment.name}' cannot be started. Choose one node's CPU or one or more GPUs.`,
      });
      expect(relay.calls).toHaveLength(0);
    });

    it('refuses a request naming an invalid body', async () => {
      const answer = await call('/v1/chat/completions', { model: 'x', messages: [] });

      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.body).error.type).toBe('invalid_request_error');
    });
  });

  describe('proxying', () => {
    it('relays a completion to the instance and normalises the answer', async () => {
      const deployment = await createTestDeployment();
      const instanceKey = await insertReadyInstance(deployment.id);

      relay.answersWith(relayCall => {
        relayCall.response.setHeader('content-type', 'application/json');
        relayCall.response.writeHead(200).end(
          JSON.stringify({
            id: 'cmpl-1',
            created: 1,
            model: 'llama',
            choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        );
      });

      const answer = await call('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
        max_completion_tokens: 16,
        my_own_parameter: 'kept',
      });

      const relayed = relay.calls.at(-1);

      expect(answer.status).toBe(200);
      expect(relayed?.url).toBe(`/instances/${instanceKey}/v1/chat/completions`);
      expect(relayed?.authorization).toBe(`Bearer ${RELAY_TOKEN}`);

      const sent = JSON.parse(relayed?.body ?? '{}');

      expect(sent.my_own_parameter).toBe('kept');
      expect(sent.max_tokens).toBe(16);

      // llama.cpp omits `object`, and the mapping is what puts the canonical one back.
      expect(JSON.parse(answer.body).object).toBe('chat.completion');
    });

    it('relays an embedding and normalises the answer', async () => {
      const deployment = await createTestDeployment();
      await insertReadyInstance(deployment.id);

      relay.answersWith(relayCall => {
        relayCall.response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }], model: 'llama' }));
      });

      const answer = await call('/v1/embeddings', { model: deployment.name, input: 'hi' });
      const body = JSON.parse(answer.body);

      expect(answer.status).toBe(200);
      expect(relay.calls.at(-1)?.url).toContain('/v1/embeddings');
      expect(body.object).toBe('list');
      expect(body.data[0].object).toBe('embedding');
    });

    it("answers with the backend's own error under its own status", async () => {
      const deployment = await createTestDeployment();
      await insertReadyInstance(deployment.id);

      relay.answersWith(relayCall => {
        relayCall.response
          .writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { message: 'context is full', type: 'invalid_request_error', code: null } }));
      });

      const answer = await call('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.body).error.message).toBe('context is full');
    });

    it('answers 502 where the node relay cannot be reached', async () => {
      const deployment = await createTestDeployment();
      await insertReadyInstance(deployment.id);

      relay.answersWith(relayCall => relayCall.request.socket.destroy());

      const answer = await call('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(answer.status).toBe(502);
      expect(JSON.parse(answer.body).error.code).toBe('model_unreachable');
    });
  });

  describe('streaming', () => {
    it('writes each chunk on as it arrives rather than buffering to completion', async () => {
      const deployment = await createTestDeployment();
      await insertReadyInstance(deployment.id);

      const arriving = backendAnswering(backend => backend.write(chunkOf('one')));

      const { response } = await openStream('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });

      const backend = await arriving;

      let received = '';

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (received += chunk));

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');

      await until(() => received.includes('one'));

      backend.write(chunkOf('two'));
      await until(() => received.includes('two'));

      backend.write('data: [DONE]\n\n');
      backend.end();

      await new Promise<void>(resolve => response.on('end', resolve));

      // The backend omits `object`, so its presence is the canonical mapping running on each chunk.
      expect(received).toContain('"object":"chat.completion.chunk"');
      expect(received.trimEnd().endsWith('data: [DONE]')).toBe(true);
    });

    it('holds the backend back while the caller is not reading', async () => {
      const deployment = await createTestDeployment();
      await insertReadyInstance(deployment.id);

      const arriving = backendAnswering(() => undefined);

      const { response } = await openStream('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });

      response.pause();

      const backend = await arriving;
      const filler = 'x'.repeat(512);
      let written = 0;

      const pump = (): void => {
        while (written < BACKPRESSURE_CHUNKS && backend.write(chunkOf(filler))) {
          written++;
        }
      };

      backend.on('drain', pump);
      pump();

      await sleep(500);

      // Buffering to completion would have taken every chunk on offer; backpressure stops well short.
      expect(written).toBeLessThan(BACKPRESSURE_CHUNKS);

      response.resume();
      response.on('data', () => undefined);

      await until(() => written >= BACKPRESSURE_CHUNKS, 20_000);

      backend.end();
    }, 30_000);

    it('refuses a stream whose head does not arrive by the headers deadline', async () => {
      const deployment = await createTestDeployment();
      await insertReadyInstance(deployment.id);

      relay.answersWith(() => undefined);

      const answer = await call('/v1/chat/completions', completion(deployment.name, true));

      expect(answer.status).toBe(502);
      expect(JSON.parse(answer.body).error.code).toBe('model_unreachable');
    });

    it('cancels the upstream request when the caller disconnects', async () => {
      const deployment = await createTestDeployment();
      await insertReadyInstance(deployment.id);

      let cancelled = false;

      relay.answersWith(relayCall => {
        relayCall.response.writeHead(200, { 'content-type': 'text/event-stream' });
        relayCall.response.write(chunkOf('one'));

        relayCall.response.on('close', () => {
          cancelled = !relayCall.response.writableEnded;
        });
      });

      const { request, response } = await openStream('/v1/chat/completions', {
        model: deployment.name,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });

      let received = '';

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (received += chunk));

      await until(() => received.includes('one'));

      request.destroy();

      await until(() => cancelled);

      expect(cancelled).toBe(true);
    });
  });

  describe('cold load', () => {
    beforeEach(() => {
      relay.answersWith(relayCall => {
        relayCall.response.writeHead(200, { 'content-type': 'application/json' }).end(COMPLETION);
      });
    });

    it('starts a deployment with no ready instance and serves the request once it is ready', async () => {
      const deployment = await createColdDeployment();

      const answering = call('/v1/chat/completions', completion(deployment.name));
      const instanceKey = await startedBy(deployment.id);

      expect(relay.calls).toHaveLength(0);

      reportInstance(instanceKey, InstanceState.READY);

      const answer = await answering;

      expect(answer.status).toBe(200);
      expect(relay.calls.at(-1)?.url).toBe(`/instances/${instanceKey}/v1/chat/completions`);

      const started = await dbQuery<{ detail: { reason: string } }>(
        app,
        `SELECT "detail" FROM "event" WHERE "subjectId" = $1 AND "type" = $2`,
        [`${deployment.id}`, EventType.INSTANCE_STARTED]
      );

      expect(started.map(event => event.detail.reason)).toEqual([InstanceChangeReason.ON_REQUEST]);
    });

    it('starts one instance for requests arriving together, and serves them all from it', async () => {
      const deployment = await createColdDeployment();

      const answering = Array.from({ length: 20 }, () => call('/v1/chat/completions', completion(deployment.name)));
      const instanceKey = await startedBy(deployment.id);

      await sleep(200);
      expect(await instancesOf(deployment.id)).toHaveLength(1);

      reportInstance(instanceKey, InstanceState.READY);

      const answers = await Promise.all(answering);

      expect(answers.map(answer => answer.status)).toEqual(Array(20).fill(200));
      expect(relay.calls.map(relayCall => relayCall.url)).toEqual(
        Array(20).fill(`/instances/${instanceKey}/v1/chat/completions`)
      );
    });

    it('opens a streaming request with keepalive while it waits, then streams the answer', async () => {
      const deployment = await createColdDeployment();

      const { response } = await openStream('/v1/chat/completions', completion(deployment.name, true));

      let received = '';

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (received += chunk));

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['x-accel-buffering']).toBe('no');

      await until(() => received.includes(': keepalive'));

      const arriving = backendAnswering(backend => {
        backend.write(chunkOf('one'));
        backend.end('data: [DONE]\n\n');
      });

      reportInstance(await startedBy(deployment.id), InstanceState.READY);
      await arriving;

      await new Promise<void>(resolve => response.on('end', resolve));

      expect(received).toContain('"content":"one"');
    });

    it('carries on loading when the caller that started it goes away', async () => {
      const deployment = await createColdDeployment();

      const { request } = await openStream('/v1/chat/completions', completion(deployment.name, true));
      const instanceKey = await startedBy(deployment.id);
      const record = vi.spyOn(app.get(InferenceMetricsService), 'record');
      onTestFinished(() => record.mockRestore());

      request.destroy();

      // The gateway records a caller that left once it has stopped waiting on the instance for it.
      await vi.waitFor(
        () =>
          expect(record).toHaveBeenCalledWith(
            expect.objectContaining({ deploymentId: deployment.id, status: CLIENT_CLOSED_REQUEST })
          ),
        { timeout: 10_000 }
      );

      reportInstance(instanceKey, InstanceState.READY);

      await vi.waitFor(
        async () =>
          expect(await instancesOf(deployment.id)).toEqual([{ instanceKey, instanceState: InstanceState.READY }]),
        { timeout: 10_000 }
      );
      expect(relay.calls).toHaveLength(0);
    });

    it('refuses a deployment whose pinned GPU has no room, saying so, and starts nothing', async () => {
      await dbQuery(
        app,
        `INSERT INTO "gpu" ("nodeId", "deviceKey", "vendor", "lastReportedDate") VALUES ($1, $2, 'nvidia', now())
         ON CONFLICT DO NOTHING`,
        [nodeId, DEVICE_KEY]
      );
      await reportCard(app, nodeId, DEVICE_KEY, { totalBytes: GIB });

      const deployment = await createColdDeployment(
        `placement:\n  gpus:\n    - nodeId: ${nodeId}\n      deviceKey: ${DEVICE_KEY}\n`
      );

      const answer = await call('/v1/chat/completions', completion(deployment.name));
      const error = JSON.parse(answer.body).error;

      expect(answer.status).toBe(503);
      expect(error.code).toBe('model_does_not_fit');
      expect(error.message).toMatch(/more than the pinned GPUs have free/);
      expect(await instancesOf(deployment.id)).toEqual([]);
    });

    it("refuses its waiters with the backend's output when the load fails, then backs off", async () => {
      const deployment = await createColdDeployment();

      const answering = [1, 2].map(() => call('/v1/chat/completions', completion(deployment.name)));
      const instanceKey = await startedBy(deployment.id);

      reportInstance(instanceKey, InstanceState.FAILED, 'error: CUDA out of memory');

      for (const answer of await Promise.all(answering)) {
        expect(answer.status).toBe(503);
        expect(JSON.parse(answer.body).error).toMatchObject({
          code: 'model_failed_to_start',
          message: `The model '${deployment.name}' failed to start. error: CUDA out of memory.`,
        });
      }

      const retried = await call('/v1/chat/completions', completion(deployment.name));

      expect(retried.status).toBe(503);
      expect(JSON.parse(retried.body).error.message).toMatch(/is not tried again for \d+ seconds\. error: CUDA/);
      expect(await instancesOf(deployment.id)).toEqual([{ instanceKey, instanceState: InstanceState.FAILED }]);
    });

    it('tells a streaming caller of a failed load in an event, since its status went out with the keepalive', async () => {
      const deployment = await createColdDeployment();

      const { response } = await openStream('/v1/chat/completions', completion(deployment.name, true));

      let received = '';

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (received += chunk));

      reportInstance(await startedBy(deployment.id), InstanceState.FAILED, 'error: CUDA out of memory');

      await new Promise<void>(resolve => response.on('end', resolve));

      const event = received.split('\n').find(line => line.startsWith('data: '));

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(event?.slice('data: '.length) ?? '{}').error.code).toBe('model_failed_to_start');
    });
  });

  describe('audio', () => {
    const BOUNDARY = 'modelfleet-upload-boundary';
    const UPLOAD_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

    const AUDIO = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

    const textPart = (name: string, value: string): string =>
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

    const uploadFor = (model: string, audio = AUDIO, extra = ''): Buffer =>
      Buffer.concat([
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n` +
            'Content-Type: audio/wav\r\n\r\n'
        ),
        audio,
        Buffer.from(`\r\n${textPart('model', model)}${extra}--${BOUNDARY}--\r\n`),
      ]);

    const transcribe = (body: Buffer, headers: Record<string, string> = {}): Promise<IAnswer> =>
      call('/v1/audio/transcriptions', undefined, { 'content-type': UPLOAD_TYPE, ...headers }, body);

    it('routes on a model sent after the file, and relays the upload byte for byte under its own type', async () => {
      const deployment = await createTestDeployment([ModelTask.TRANSCRIPTION]);
      const instanceKey = await insertReadyInstance(deployment.id);
      const granularities = `${textPart('timestamp_granularities[]', 'word')}${textPart('timestamp_granularities[]', 'segment')}`;
      const upload = uploadFor(deployment.name, AUDIO, granularities);

      relay.answersWith(relayCall => {
        relayCall.response
          .writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          .end('{"text":"hello"}');
      });

      const answer = await transcribe(upload);
      const relayed = relay.calls.at(-1);

      expect(answer.status).toBe(200);
      expect(answer.body).toBe('{"text":"hello"}');
      expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(relayed?.url).toBe(`/instances/${instanceKey}/v1/audio/transcriptions`);
      expect(relayed?.contentType).toBe(UPLOAD_TYPE);
      expect(relayed?.bytes.equals(upload)).toBe(true);
      expect(relayed?.body.match(/name="timestamp_granularities\[\]"/g)).toHaveLength(2);
    });

    it('relays an upload to a model whose tasks are unknown, for the backend to answer', async () => {
      const deployment = await createTestDeployment();
      const instanceKey = await insertReadyInstance(deployment.id);

      relay.answersWith(relayCall => {
        relayCall.response
          .writeHead(501, { 'content-type': 'application/json' })
          .end('{"error":{"code":501,"message":"This model cannot hear","type":"not_supported_error"}}');
      });

      const answer = await transcribe(uploadFor(deployment.name));

      expect(answer.status).toBe(501);
      expect(answer.body).toContain('This model cannot hear');
      expect(relay.calls.at(-1)?.url).toBe(`/instances/${instanceKey}/v1/audio/transcriptions`);
    });

    it.each([
      ['speech', (model: string) => call('/v1/audio/speech', { model, input: 'hello', voice: 'alloy' })],
      [
        'translations',
        (model: string) => call('/v1/audio/translations', undefined, { 'content-type': UPLOAD_TYPE }, uploadFor(model)),
      ],
    ])('refuses %s on a llama.cpp deployment, before reaching the node', async (_route, send) => {
      const deployment = await createTestDeployment([ModelTask.TRANSCRIPTION]);
      await insertReadyInstance(deployment.id);

      relay.forget();

      const answer = await send(deployment.name);

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body).error.code).toBe('unsupported_operation');
      expect(relay.calls).toHaveLength(0);
    });

    it('refuses an upload over the audio limit with a 413 in OpenAI form', async () => {
      const answer = await transcribe(uploadFor('nothing-here', Buffer.alloc(26 * 1024 * 1024)));

      expect(answer.status).toBe(413);
      expect(JSON.parse(answer.body).error).toMatchObject({
        type: 'invalid_request_error',
        message: 'The upload is larger than the 25mb limit.',
      });
    });

    it('refuses a caller with no valid key without reading its upload', async () => {
      // The upload claims far more than is ever sent, so an answer arriving at all means nothing waited to read it.
      const answer = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            host: '127.0.0.1',
            port: gatewayPort,
            path: '/v1/audio/transcriptions',
            method: 'POST',
            headers: {
              authorization: 'Bearer mfk_deadbeef_nope',
              'content-type': UPLOAD_TYPE,
              'content-length': String(30 * 1024 * 1024),
            },
          },
          response => {
            response.resume();
            resolve(response.statusCode ?? 0);
            request.destroy();
          }
        );

        request.on('error', reject);
        request.write(Buffer.alloc(1024));
      });

      expect(answer).toBe(401);
    });

    it('waits on a whole transcription past the headers deadline a stream is held to', async () => {
      const deployment = await createTestDeployment([ModelTask.TRANSCRIPTION]);
      await insertReadyInstance(deployment.id);

      relay.answersWith(relayCall => {
        setTimeout(() => {
          relayCall.response.writeHead(200, { 'content-type': 'application/json' }).end('{"text":"hello"}');
        }, 1500);
      });

      const answer = await transcribe(uploadFor(deployment.name));

      expect(answer.status).toBe(200);
      expect(answer.body).toBe('{"text":"hello"}');
    });

    it('holds an upload through a cold load and relays it whole once the instance is ready', async () => {
      const deployment = await createColdDeployment(undefined, [ModelTask.TRANSCRIPTION]);
      const upload = uploadFor(deployment.name);

      relay.answersWith(relayCall => {
        relayCall.response.writeHead(200, { 'content-type': 'application/json' }).end('{"text":"hello"}');
      });

      const answering = transcribe(upload);
      const instanceKey = await startedBy(deployment.id);

      reportInstance(instanceKey, InstanceState.READY);

      const answer = await answering;

      expect(answer.status).toBe(200);
      expect(relay.calls.at(-1)?.bytes.equals(upload)).toBe(true);
    });
  });

  describe('speech', () => {
    const VOICES_PATH = '/v1/audio/voices';

    const createSpeechDeployment = async (
      backend: BackendId,
      format: string,
      document = ''
    ): Promise<{ id: number; name: string }> => {
      const safetensorsMetadata =
        format === 'safetensors'
          ? { dtype: 'BF16', tensorCount: 1, parameterCount: 1, architecture: 'qwen3_tts' }
          : null;
      const models = await dbQuery<{ id: number }>(
        app,
        `INSERT INTO "model"
           ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name", "detectedTasks", "safetensorsMetadata")
         VALUES ($1, $2, 'model', 1000, 1, 'Speech', $3, $4) RETURNING id`,
        [randomUUID().replaceAll('-', '').padEnd(64, '0'), format, [ModelTask.SPEECH], safetensorsMetadata]
      );

      await dbQuery(
        app,
        `INSERT INTO "availability" ("modelId", "nodeId", "path", "lastConfirmedDate") VALUES ($1, $2, $3, now())`,
        [models[0].id, nodeId, '/srv/models/speech']
      );

      const name = uniqueName('speech');
      const response = await createDeployment(app, adminToken, {
        name,
        modelId: models[0].id,
        backend,
        activationPolicy: ActivationPolicy.ON_DEMAND,
        document,
      }).expect(201);

      return { id: response.body.id as number, name };
    };

    const answerVoices = (voices: unknown): void => {
      relay.answersWith(relayCall => {
        relayCall.response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(voices));
      });
    };

    it("lists a ready deployment's voices, read with a GET through its node's relay", async () => {
      const deployment = await createSpeechDeployment(BackendId.VLLM_OMNI, 'safetensors');
      const instanceKey = await insertReadyInstance(deployment.id);
      const voice = uniqueName('vivian');

      answerVoices({ voices: [voice, 'default'], uploaded_voices: [] });

      const answer = await call(VOICES_PATH, undefined);
      const relayed = relay.calls.find(relayCall => relayCall.url === `/instances/${instanceKey}${VOICES_PATH}`);

      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body).voices).toContainEqual({ id: voice, name: voice });
      expect(relayed?.method).toBe('GET');
    });

    const revisionOf = async (deploymentId: number): Promise<string> => {
      const [{ configurationRevision }] = await dbQuery<{ configurationRevision: string }>(
        app,
        `SELECT "configurationRevision" FROM "deployment" WHERE id = $1`,
        [deploymentId]
      );

      return configurationRevision;
    };

    const storeVoices = (deploymentId: number, configurationRevision: string, voices: unknown): Promise<unknown> =>
      dbQuery(
        app,
        `INSERT INTO "voice_list" ("deploymentId", "configurationRevision", "voices") VALUES ($1, $2, $3::jsonb)`,
        [deploymentId, configurationRevision, JSON.stringify(voices)]
      );

    it("stores the voices read on its revision over an earlier revision's, reading them once", async () => {
      const deployment = await createSpeechDeployment(BackendId.KOKORO, 'pytorch');
      const revision = await revisionOf(deployment.id);
      const instanceKey = await insertReadyInstance(deployment.id, revision);
      const voice = uniqueName('af_heart');

      await storeVoices(deployment.id, 'earlier', [{ id: 'stale', name: 'stale' }]);
      answerVoices({ voices: [{ id: voice }] });

      await call(VOICES_PATH, undefined);
      const answer = await call(VOICES_PATH, undefined);
      const relayed = relay.calls.filter(relayCall => relayCall.url === `/instances/${instanceKey}${VOICES_PATH}`);
      const stored = await dbQuery(
        app,
        `SELECT "configurationRevision", "voices" FROM "voice_list" WHERE "deploymentId" = $1`,
        [deployment.id]
      );

      expect(JSON.parse(answer.body).voices).toContainEqual({ id: voice, name: voice });
      expect(JSON.parse(answer.body).voices).not.toContainEqual({ id: 'stale', name: 'stale' });
      expect(relayed).toHaveLength(1);
      expect(stored).toEqual([{ configurationRevision: revision, voices: [{ id: voice, name: voice }] }]);
    });

    it('lists a stored list with no instance ready', async () => {
      const deployment = await createSpeechDeployment(BackendId.KOKORO, 'pytorch');
      const voice = uniqueName('am_adam');

      await storeVoices(deployment.id, await revisionOf(deployment.id), [{ id: voice, name: voice }]);

      const answer = await call(VOICES_PATH, undefined);

      expect(JSON.parse(answer.body).voices).toContainEqual({ id: voice, name: voice });
      expect(await instancesOf(deployment.id)).toHaveLength(0);
    });

    it("drops a deployment's voice list with the deployment", async () => {
      const deployment = await createSpeechDeployment(BackendId.KOKORO, 'pytorch');

      await storeVoices(deployment.id, await revisionOf(deployment.id), []);
      await deleteDeployment(app, adminToken, deployment.id).expect(200);

      expect(await dbQuery(app, `SELECT 1 FROM "voice_list" WHERE "deploymentId" = $1`, [deployment.id])).toHaveLength(
        0
      );
    });

    it('starts no deployment to list its voices', async () => {
      const placement = `placement:\n  nodeIds:\n    - ${nodeId}\n`;
      const deployment = await createSpeechDeployment(BackendId.KOKORO, 'pytorch', placement);

      answerVoices({ voices: [] });

      const answer = await call(VOICES_PATH, undefined);

      expect(answer.status).toBe(200);

      await sleep(250);

      expect(await instancesOf(deployment.id)).toHaveLength(0);
    });

    it('refuses a voice upload with a 404 in OpenAI form, never reaching a node', async () => {
      const answer = await call(VOICES_PATH, { name: 'mine', consent: 'yes' });

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body).error).toBeDefined();
      expect(relay.calls).toHaveLength(0);
    });

    it('refuses a format vLLM-Omni cannot produce before reaching the node', async () => {
      const deployment = await createSpeechDeployment(BackendId.VLLM_OMNI, 'safetensors');
      await insertReadyInstance(deployment.id);

      relay.forget();

      const answer = await call('/v1/audio/speech', {
        model: deployment.name,
        input: 'hello',
        voice: 'vivian',
        response_format: 'aac',
      });

      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.body).error).toMatchObject({ code: 'unsupported_parameter', param: 'response_format' });
      expect(relay.calls).toHaveLength(0);
    });

    it("relays vLLM-Omni's speech events byte for byte", async () => {
      const deployment = await createSpeechDeployment(BackendId.VLLM_OMNI, 'safetensors');
      const instanceKey = await insertReadyInstance(deployment.id);
      const events =
        'event: speech.audio.delta\ndata: {"type":"speech.audio.delta","audio":"UklGRg==","response_format":"pcm"}\n\n' +
        'event: speech.audio.done\ndata: {"type":"speech.audio.done","usage":{"input_tokens":3}}\n\n';

      relay.answersWith(relayCall => {
        relayCall.response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' }).end(events);
      });

      const answer = await call('/v1/audio/speech', {
        model: deployment.name,
        input: 'hello',
        voice: 'vivian',
        response_format: 'pcm',
        stream_format: 'sse',
      });
      const relayed = relay.calls.at(-1);

      expect(answer.status).toBe(200);
      expect(answer.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(answer.body).toBe(events);
      expect(relayed?.url).toBe(`/instances/${instanceKey}/v1/audio/speech`);
      expect(JSON.parse(relayed?.body ?? '{}')).toMatchObject({ model: deployment.name, voice: 'vivian' });
    });
  });
});
