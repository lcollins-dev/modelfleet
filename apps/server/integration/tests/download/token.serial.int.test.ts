import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RawData, WebSocket } from 'ws';

import {
  AGENT_SOCKET_PATH,
  AgentMessageType,
  DesiredDownload,
  PROTOCOL_VERSION,
  ServerMessageType,
  decodeServerMessage,
  encodeAgentMessage,
} from '@libs/agent-protocol';
import { DownloadDto, UserRoleId } from '@libs/dto';

import { createDownload, getDownload, getDownloadList, getRepositoryListing } from '../../clients/download.client';
import { registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import {
  FAKE_HUB_COMMIT,
  FAKE_HUB_GATED,
  FAKE_HUB_GATED_REFUSED,
  FAKE_HUB_PRIVATE,
  FAKE_HUB_TOKEN,
} from '../../utils/fake-hub';

interface IRegisteredNode {
  id: number;
  nodeKey: string;
  secret: string;
}

// A token changes what every Hub read sends and every node is asked for, so this file owns its app.
describe('Downloads with a Hugging Face token (integration, serial)', () => {
  let app: NestExpressApplication;
  let socketUrl: string;
  let adminToken: string;

  const sockets: WebSocket[] = [];

  const register = async (): Promise<IRegisteredNode> => {
    const response = await registerNode(app, adminToken, { name: `rig-${randomUUID()}` }).expect(201);

    return response.body as IRegisteredNode;
  };

  const create = async (repository: string, nodeId: number): Promise<DownloadDto> => {
    const response = await createDownload(app, adminToken, {
      repository,
      directory: `huggingface/${repository}`,
      files: ['config.json'],
      nodeIds: [nodeId],
    }).expect(201);

    return response.body as DownloadDto;
  };

  const desiredOnWelcome = async (node: IRegisteredNode): Promise<DesiredDownload[]> => {
    const socket = new WebSocket(socketUrl);

    sockets.push(socket);

    const desired = new Promise<DesiredDownload[]>(resolve => {
      socket.on('message', (data: RawData) => {
        const decoded = decodeServerMessage(Buffer.from(data as Buffer).toString('utf8'));

        if (decoded.ok && decoded.message.type === ServerMessageType.DESIRED_DOWNLOADS) {
          if (decoded.message.payload.downloads.length > 0) {
            resolve(decoded.message.payload.downloads);
          }
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    socket.send(
      encodeAgentMessage(AgentMessageType.HELLO, {
        nodeKey: node.nodeKey,
        secret: node.secret,
        agentVersion: 'integration',
        protocolVersions: [PROTOCOL_VERSION],
        relay: { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' },
      })
    );

    return desired;
  };

  beforeAll(async () => {
    process.env.HUGGINGFACE_TOKEN = FAKE_HUB_TOKEN;

    app = await bootstrapApp();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    socketUrl = `ws://127.0.0.1:${address.port}${AGENT_SOCKET_PATH}`;

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.close();
    }

    await app.close();
  });

  it.each([FAKE_HUB_GATED, FAKE_HUB_PRIVATE])('lists %s, which the token reaches', async repository => {
    const response = await getRepositoryListing(app, adminToken, { repository }).expect(200);

    expect(response.body).toMatchObject({ repository, revision: FAKE_HUB_COMMIT });
    expect(response.body.files).toHaveLength(2);
  });

  it.each([FAKE_HUB_GATED, FAKE_HUB_PRIVATE])(
    'pins %s and asks the node to fetch it with the token',
    async repository => {
      const node = await register();
      const download = await create(repository, node.id);

      const [desired] = await desiredOnWelcome(node);

      expect(download).toMatchObject({ repository, revision: FAKE_HUB_COMMIT });
      expect(desired).toMatchObject({ repository, token: FAKE_HUB_TOKEN });
    }
  );

  it('says the token has not been granted a gated repository whose terms its account never accepted', async () => {
    const node = await register();
    const reason =
      `${FAKE_HUB_GATED_REFUSED} is gated, ` +
      'and the account HUGGINGFACE_TOKEN belongs to has not been granted access';

    const listed = await getRepositoryListing(app, adminToken, { repository: FAKE_HUB_GATED_REFUSED }).expect(400);
    const created = await createDownload(app, adminToken, {
      repository: FAKE_HUB_GATED_REFUSED,
      directory: 'huggingface/refused',
      files: ['config.json'],
      nodeIds: [node.id],
    }).expect(400);

    expect(listed.body.message).toBe(reason);
    expect(created.body.message).toBe(reason);
  });

  it('says the token cannot reach a repository the Hub hides from it, not that a revision is missing', async () => {
    const node = await register();

    const response = await createDownload(app, adminToken, {
      repository: 'owner/unknown',
      directory: 'huggingface/owner/unknown',
      files: ['config.json'],
      nodeIds: [node.id],
    }).expect(400);

    expect(response.body.message).toBe('owner/unknown does not exist, or HUGGINGFACE_TOKEN cannot reach it');
  });

  it('never answers the token to the console', async () => {
    const node = await register();
    const created = await createDownload(app, adminToken, {
      repository: FAKE_HUB_GATED,
      directory: 'huggingface/answered',
      files: ['config.json'],
      nodeIds: [node.id],
    }).expect(201);

    const answers = [
      created,
      await getDownload(app, adminToken, (created.body as DownloadDto).id).expect(200),
      await getDownloadList(app, adminToken).expect(200),
      await getRepositoryListing(app, adminToken, { repository: FAKE_HUB_GATED }).expect(200),
    ];

    for (const answer of answers) {
      expect(answer.text).not.toContain(FAKE_HUB_TOKEN);
    }
  });
});
