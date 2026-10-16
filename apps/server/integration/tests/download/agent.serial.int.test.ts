import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RawData, WebSocket } from 'ws';

import {
  AGENT_SOCKET_PATH,
  AgentMessageType,
  DesiredDownload,
  DownloadFileState,
  DownloadState,
  PROTOCOL_VERSION,
  ServerMessageType,
  decodeServerMessage,
  encodeAgentMessage,
} from '@libs/agent-protocol';
import {
  DownloadState as ApiDownloadState,
  DownloadProgressState,
  DownloadTargetState,
  EventPartyType,
  EventType,
  DownloadDto,
  DownloadProgressResponseDto,
  EventDto,
  UserRoleId,
} from '@libs/dto';

import { createDownload, getDownload, retryDownload, stopDownload } from '../../clients/download.client';
import { getEventList } from '../../clients/event.client';
import { registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { FAKE_HUB_COMMIT, FAKE_HUB_PUBLIC } from '../../utils/fake-hub';
import { openSse } from '../../utils/sse';

interface IRegisteredNode {
  id: number;
  nodeKey: string;
  secret: string;
}

class DesiredDownloadsLog {
  private readonly sets: DesiredDownload[][] = [];
  private readonly waiting: (() => void)[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (data: RawData) => {
      const decoded = decodeServerMessage(Buffer.from(data as Buffer).toString('utf8'));

      if (decoded.ok && decoded.message.type === ServerMessageType.DESIRED_DOWNLOADS) {
        this.sets.push(decoded.message.payload.downloads);
        this.waiting.splice(0).forEach(wake => wake());
      }
    });
  }

  get count(): number {
    return this.sets.length;
  }

  /** A node is sent an empty set on connect, so pass the `count` taken before an action to wait for its set. */
  async until(accept: (downloads: DesiredDownload[]) => boolean, from: number = 0): Promise<DesiredDownload[]> {
    for (;;) {
      const found = this.sets.slice(from).find(accept);

      if (found !== undefined) {
        return found;
      }

      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
  }

  latest(): DesiredDownload[] | undefined {
    return this.sets.at(-1);
  }
}

describe('Downloads over the agent connection (integration, serial)', () => {
  let app: NestExpressApplication;
  let socketUrl: string;
  let adminToken: string;

  const sockets: WebSocket[] = [];

  const register = async (): Promise<IRegisteredNode> => {
    const response = await registerNode(app, adminToken, { name: `rig-${randomUUID()}` }).expect(201);

    return response.body as IRegisteredNode;
  };

  const connect = async (node: IRegisteredNode): Promise<{ socket: WebSocket; log: DesiredDownloadsLog }> => {
    const socket = new WebSocket(socketUrl);
    const log = new DesiredDownloadsLog(socket);

    sockets.push(socket);

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

    return { socket, log };
  };

  const create = async (nodeIds: number[], directory = `huggingface/${FAKE_HUB_PUBLIC}`): Promise<DownloadDto> => {
    const response = await createDownload(app, adminToken, {
      repository: FAKE_HUB_PUBLIC,
      directory,
      files: ['config.json', 'model.gguf'],
      nodeIds,
    }).expect(201);

    return response.body as DownloadDto;
  };

  const entryOf = (downloadKey: string, state: DownloadState, message: string | null = null, attempt = 0) => ({
    downloadKey,
    attempt,
    state,
    message,
    files: [
      { path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 1000 },
      { path: 'config.json', state: DownloadFileState.PENDING, bytesDone: 0 },
    ],
  });

  const reportAll = (socket: WebSocket, downloads: ReturnType<typeof entryOf>[]) => {
    socket.send(encodeAgentMessage(AgentMessageType.DOWNLOAD_PROGRESS, { downloads }));
  };

  const report = (socket: WebSocket, downloadKey: string, state: DownloadState, message: string | null = null) => {
    reportAll(socket, [entryOf(downloadKey, state, message)]);
  };

  const eventTypesOf = async (downloadId: number): Promise<EventType[]> => {
    const events = await getEventList(app, adminToken, {
      subjectType: EventPartyType.DOWNLOAD,
      subjectId: `${downloadId}`,
    }).expect(200);

    return (events.body.eventList as EventDto[]).map(event => event.type);
  };

  const targetOf = async (downloadId: number, nodeId: number) => {
    const response = await getDownload(app, adminToken, downloadId).expect(200);

    return (response.body as DownloadDto).targets.find(target => target.nodeId === nodeId);
  };

  beforeAll(async () => {
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

  it('sends a node an empty set on welcome, so it knows the server has spoken', async () => {
    const { log } = await connect(await register());

    expect(await log.until(() => true)).toEqual([]);
  });

  it('sends a node its active downloads on welcome, pinned and pointed at the configured Hub', async () => {
    const node = await register();
    const download = await create([node.id]);
    const { log } = await connect(node);

    const [desired] = await log.until(downloads => downloads.length > 0);

    expect(desired).toMatchObject({
      repository: FAKE_HUB_PUBLIC,
      directory: `huggingface/${FAKE_HUB_PUBLIC}`,
      revision: FAKE_HUB_COMMIT,
      endpoint: process.env.HUGGINGFACE_ENDPOINT,
      files: [
        {
          path: 'config.json',
          url: `${process.env.HUGGINGFACE_ENDPOINT}/${FAKE_HUB_PUBLIC}/resolve/${FAKE_HUB_COMMIT}/config.json`,
          sizeBytes: 752,
          digest: { algorithm: 'git-sha1' },
        },
        {
          path: 'model.gguf',
          url: `${process.env.HUGGINGFACE_ENDPOINT}/${FAKE_HUB_PUBLIC}/resolve/${FAKE_HUB_COMMIT}/model.gguf`,
          sizeBytes: 639_447_744,
          digest: { algorithm: 'sha256' },
        },
      ],
    });
    expect(desired).not.toHaveProperty('token');
    expect(download.targets[0].state).toBe(DownloadTargetState.ACTIVE);
  });

  it('shows what the node reports, then records its success and stops asking for it', async () => {
    const node = await register();
    const { socket, log } = await connect(node);
    const download = await create([node.id]);
    const [desired] = await log.until(downloads => downloads.length > 0);

    report(socket, desired.downloadKey, DownloadState.DOWNLOADING);

    await expect.poll(async () => (await targetOf(download.id, node.id))?.bytesDone).toBe(1000);
    expect((await targetOf(download.id, node.id))?.progress).toBe(DownloadProgressState.DOWNLOADING);

    const beforeSuccess = log.count;

    report(socket, desired.downloadKey, DownloadState.SUCCEEDED);

    await expect.poll(async () => (await targetOf(download.id, node.id))?.state).toBe(DownloadTargetState.SUCCEEDED);
    await log.until(downloads => downloads.length === 0, beforeSuccess);

    const events = await getEventList(app, adminToken, {
      subjectType: EventPartyType.DOWNLOAD,
      subjectId: `${download.id}`,
    }).expect(200);

    expect((events.body.eventList as EventDto[]).map(event => event.type)).toContain(EventType.DOWNLOAD_SUCCEEDED);
  });

  it('streams what nodes report without the page, keyed by the download', async () => {
    const node = await register();
    const { socket, log } = await connect(node);
    const download = await create([node.id]);
    const [desired] = await log.until(downloads => downloads.length > 0);

    report(socket, desired.downloadKey, DownloadState.DOWNLOADING);
    await expect.poll(async () => (await targetOf(download.id, node.id))?.bytesDone).toBe(1000);

    const stream = await openSse(app, '/api/v1/admin/download/progress/stream', authHeaders(adminToken));

    try {
      const [opening] = await stream.take(1);
      const progress = JSON.parse(opening) as DownloadProgressResponseDto;

      expect(progress.downloads.find(entry => entry.key === download.key)?.targets).toEqual([
        {
          nodeId: node.id,
          progress: DownloadProgressState.DOWNLOADING,
          bytesDone: 1000,
          bytesPerSecond: null,
          files: [
            { path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 1000 },
            { path: 'config.json', state: DownloadFileState.PENDING, bytesDone: 0 },
          ],
        },
      ]);
    } finally {
      stream.close();
    }
  });

  it('sends a node its downloads oldest first', async () => {
    const node = await register();
    const older = await create([node.id], 'ordered/older');
    const newer = await create([node.id], 'ordered/newer');
    const { log } = await connect(node);

    const desired = await log.until(downloads => downloads.length === 2);

    expect(desired.map(entry => entry.downloadKey)).toEqual([older.key, newer.key]);
  });

  it('leaves the other node downloading when one node fails', async () => {
    const failing = await register();
    const kept = await register();
    const failingAgent = await connect(failing);
    const keptAgent = await connect(kept);
    const download = await create([failing.id, kept.id]);
    const [desired] = await failingAgent.log.until(downloads => downloads.length > 0);

    await keptAgent.log.until(downloads => downloads.length > 0);

    const beforeFailure = failingAgent.log.count;

    report(failingAgent.socket, desired.downloadKey, DownloadState.FAILED, 'The disk filled while writing model.gguf');

    await failingAgent.log.until(downloads => downloads.length === 0, beforeFailure);

    const response = await getDownload(app, adminToken, download.id).expect(200);
    const body = response.body as DownloadDto;

    expect(body.targets.find(target => target.nodeId === kept.id)?.state).toBe(DownloadTargetState.ACTIVE);
    expect(body.state).toBe(ApiDownloadState.ACTIVE);
    expect(keptAgent.log.latest()).toHaveLength(1);
  });

  it('asks a node to try again after a retry, at the same commit and for the same files', async () => {
    const node = await register();
    const { socket, log } = await connect(node);
    const download = await create([node.id]);
    const [desired] = await log.until(downloads => downloads.length > 0);

    const beforeFailure = log.count;

    report(socket, desired.downloadKey, DownloadState.FAILED, 'The source answered 503');

    await log.until(downloads => downloads.length === 0, beforeFailure);

    const beforeRetry = log.count;

    await retryDownload(app, adminToken, download.id).expect(201);

    const [again] = await log.until(downloads => downloads.length > 0, beforeRetry);

    expect(again).toEqual({ ...desired, attempt: 1 });
    expect((await targetOf(download.id, node.id))?.state).toBe(DownloadTargetState.ACTIVE);
    expect((await targetOf(download.id, node.id))?.message).toBeNull();
    expect(await eventTypesOf(download.id)).toContain(EventType.DOWNLOAD_RETRIED);
  });

  it('settles nothing from a report of the attempt before a retry', async () => {
    const node = await register();
    const { socket, log } = await connect(node);
    const download = await create([node.id]);
    const [desired] = await log.until(downloads => downloads.length > 0);

    await stopDownload(app, adminToken, download.id).expect(201);
    await retryDownload(app, adminToken, download.id).expect(201);
    await log.until(downloads => downloads[0]?.attempt === 1);

    reportAll(socket, [entryOf(desired.downloadKey, DownloadState.FAILED, 'The source answered 503', 0)]);
    reportAll(socket, [entryOf(desired.downloadKey, DownloadState.SUCCEEDED, null, 1)]);

    await expect.poll(async () => (await targetOf(download.id, node.id))?.state).toBe(DownloadTargetState.SUCCEEDED);
    expect(await eventTypesOf(download.id)).not.toContain(EventType.DOWNLOAD_FAILED);
  });

  it('drops a download from the stopped node alone, leaving the other node asked for it', async () => {
    const stopped = await register();
    const kept = await register();
    const stoppedAgent = await connect(stopped);
    const keptAgent = await connect(kept);
    const download = await create([stopped.id, kept.id]);

    await stoppedAgent.log.until(downloads => downloads.length > 0);
    await keptAgent.log.until(downloads => downloads.length > 0);

    const beforeStop = stoppedAgent.log.count;

    await stopDownload(app, adminToken, download.id, { nodeId: stopped.id }).expect(201);

    await stoppedAgent.log.until(downloads => downloads.length === 0, beforeStop);
    expect(keptAgent.log.latest()).toHaveLength(1);
  });

  it('ignores a success reported for a download the server has already stopped on that node', async () => {
    const node = await register();
    const { socket, log } = await connect(node);
    const stopped = await create([node.id], 'settled/stopped');
    const running = await create([node.id], 'settled/running');
    const desired = await log.until(downloads => downloads.length === 2);

    await stopDownload(app, adminToken, stopped.id).expect(201);

    // One report, read in order, so the running download settling shows the stopped one was read first.
    reportAll(
      socket,
      desired.map(entry => entryOf(entry.downloadKey, DownloadState.SUCCEEDED))
    );

    await expect.poll(async () => (await targetOf(running.id, node.id))?.state).toBe(DownloadTargetState.SUCCEEDED);
    expect((await targetOf(stopped.id, node.id))?.state).toBe(DownloadTargetState.STOPPED);
  });
});
