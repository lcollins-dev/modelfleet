import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  AGENT_SOCKET_PATH,
  AgentMessageType,
  InstanceState,
  PROTOCOL_VERSION,
  RELAY_TAIL_COMPLETE_HEADER,
  encodeAgentMessage,
} from '@libs/agent-protocol';
import { BackendId } from '@libs/backends';
import { ActivationPolicy, EventType, InstanceOutputEndReason, UserRoleId } from '@libs/dto';

import { createDeployment } from '../../clients/deployment.client';
import { registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';
import { openSse } from '../../utils/sse';

const RELAY_TOKEN = 'a-relay-token-long-enough-for-the-schema';

/** Plays the node agent's relay serving one instance's output: the tail, then the end of the container. */
class FakeLogsRelay {
  readonly urls: string[] = [];

  private readonly server: Server;

  constructor(private readonly output: string) {
    this.server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
      this.urls.push(incoming.url ?? '');

      if (incoming.headers.authorization !== `Bearer ${RELAY_TOKEN}`) {
        response.writeHead(401).end();

        return;
      }

      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', [RELAY_TAIL_COMPLETE_HEADER]: 'true' });
      response.end(this.output);
    });
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
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

describe('Instance output (integration, serial)', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let userToken: string;
  let relay: FakeLogsRelay;
  let socket: WebSocket;
  let deploymentId: number;
  let otherDeploymentId: number;
  let instanceKey: string;

  const outputPath = (key: string, inDeployment = deploymentId) =>
    `/api/v1/admin/deployment/${inDeployment}/instance/${key}/output/stream`;

  const deploymentBody = (modelId: number) => ({
    name: `chat-${randomUUID()}`,
    modelId,
    backend: BackendId.LLAMA_CPP,
    activationPolicy: ActivationPolicy.ON_DEMAND,
    document: 'image: ghcr.io/ggml-org/llama.cpp:server\n',
  });

  beforeAll(async () => {
    app = await bootstrapApp();
    await app.listen(0);

    relay = new FakeLogsRelay(
      '2026-10-15T14:02:11.123456789Z main: loading model\n' +
        '2026-10-15T14:02:12.000000000Z main: server is listening\n'
    );
    await relay.listen();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    const user = await createTestUser(app);
    userToken = await login(app, user.email);

    const node = await registerNode(app, adminToken, { name: `node-${randomUUID()}` }).expect(201);

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

    const models = await dbQuery<{ id: number }>(
      app,
      `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name")
       VALUES ($1, 'gguf', 'model', 1000, 1, 'Llama 3 8B') RETURNING id`,
      [randomUUID().replaceAll('-', '').padEnd(64, '0')]
    );

    const deployment = await createDeployment(app, adminToken, deploymentBody(models[0].id)).expect(201);
    deploymentId = deployment.body.id;

    const other = await createDeployment(app, adminToken, deploymentBody(models[0].id)).expect(201);
    otherDeploymentId = other.body.id;

    instanceKey = randomUUID();

    await dbQuery(
      app,
      `INSERT INTO "instance"
         ("instanceKey", "deploymentId", "nodeId", "revision", "configurationRevision", "pins", "instanceState")
       VALUES ($1, $2, $3, 1, 'rev', $4::jsonb, $5)`,
      [instanceKey, deploymentId, node.body.id, JSON.stringify({ cpu: true, gpus: [] }), InstanceState.READY]
    );
  });

  afterAll(async () => {
    socket.close();

    await relay.close();
    await app.close();
  });

  it("streams the instance's output, then ends", async () => {
    const stream = await openSse(app, outputPath(instanceKey), authHeaders(adminToken));

    expect(await stream.status).toBe(200);

    const frames = (await stream.take(3)).map(payload => JSON.parse(payload));
    stream.close();

    expect(frames).toEqual([
      { kind: 'opened', tailLines: 1000, complete: true },
      {
        kind: 'lines',
        lines: [
          { date: '2026-10-15T14:02:11.123Z', text: 'main: loading model', cut: false },
          { date: '2026-10-15T14:02:12.000Z', text: 'main: server is listening', cut: false },
        ],
      },
      { kind: 'ended', reason: InstanceOutputEndReason.EXITED },
    ]);
    expect(relay.urls).toContain(`/logs/${instanceKey}?tail=1000`);

    const events = await dbQuery<{ id: number }>(
      app,
      `SELECT "id" FROM "event" WHERE "type" = $1 AND "detail"->>'instanceKey' = $2`,
      [EventType.INSTANCE_OUTPUT_READ, instanceKey]
    );

    expect(events).toHaveLength(1);
  });

  it('refuses an instance key that is not a uuid', async () => {
    await request(app.getHttpServer()).get(outputPath('not-a-key')).set(authHeaders(adminToken)).expect(400);
  });

  it('refuses an instance of another deployment as not found', async () => {
    await request(app.getHttpServer())
      .get(outputPath(instanceKey, otherDeploymentId))
      .set(authHeaders(adminToken))
      .expect(404);
  });

  it('refuses a user without system admin rights', async () => {
    await request(app.getHttpServer()).get(outputPath(instanceKey)).set(authHeaders(userToken)).expect(403);
  });
});
