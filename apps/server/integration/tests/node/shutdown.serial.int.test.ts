import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { RawData, WebSocket } from 'ws';

import {
  AGENT_SOCKET_PATH,
  AgentCloseCode,
  AgentMessageType,
  PROTOCOL_VERSION,
  ServerMessageType,
  decodeServerMessage,
  encodeAgentMessage,
} from '@libs/agent-protocol';
import { EventType, UserRoleId } from '@libs/dto';

import { registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { getDatabaseConfig, withDataSource } from '../../utils/database';

// Closes its app, so it reads the result through a data source of its own.
describe('Agent shutdown (integration, serial)', () => {
  it("records a connected node's disconnection before the server shuts down", async () => {
    const app = await bootstrapApp();
    let nodeId: number;

    try {
      await app.listen(0);

      const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
      const adminToken = await login(app, admin.email);

      const node = await registerNode(app, adminToken, { name: `rig-${randomUUID()}` }).expect(201);
      nodeId = node.body.id;

      const address = app.getHttpServer().address() as AddressInfo;
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}${AGENT_SOCKET_PATH}`);

      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });

      // Desired state follows the recorded connection, so the session is settled before shutdown begins.
      const settled = new Promise<void>(resolve => {
        socket.on('message', (data: RawData) => {
          const decoded = Buffer.isBuffer(data) ? decodeServerMessage(data.toString('utf8')) : null;

          if (decoded?.ok === true && decoded.message.type === ServerMessageType.DESIRED_STATE) {
            resolve();
          }
        });
      });

      socket.send(
        encodeAgentMessage(AgentMessageType.HELLO, {
          nodeKey: node.body.nodeKey,
          secret: node.body.secret,
          agentVersion: 'integration',
          protocolVersions: [PROTOCOL_VERSION],
          relay: { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' },
        })
      );

      await settled;
    } finally {
      await app.close();
    }

    let disconnections: { detail: { closeCode: number } }[] = [];
    const config = getDatabaseConfig();

    await withDataSource(
      new DataSource({
        type: 'postgres',
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.database,
      }),
      async dataSource => {
        disconnections = await dataSource.query('SELECT detail FROM "event" WHERE "type" = $1 AND "subjectId" = $2', [
          EventType.NODE_DISCONNECTED,
          `${nodeId}`,
        ]);
      }
    );

    expect(disconnections).toEqual([{ detail: expect.objectContaining({ closeCode: AgentCloseCode.SHUTDOWN }) }]);
  });
});
