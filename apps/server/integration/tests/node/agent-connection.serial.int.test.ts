import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { AddressInfo, createConnection } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RawData, WebSocket } from 'ws';

import {
  AGENT_SOCKET_PATH,
  AgentCloseCode,
  AgentMessageType,
  DesiredInstance,
  InstanceState,
  ObservedInstance,
  PROTOCOL_VERSION,
  RejectReason,
  ServerMessage,
  ServerMessageType,
  decodeServerMessage,
  encodeAgentMessage,
} from '@libs/agent-protocol';
import { BackendId } from '@libs/backends';
import { EventPartyType, EventType, EventDto, NodeState, UserRoleId } from '@libs/dto';

import { NodeStateService } from '@/core/node/node-state.service';

import { getEventList } from '../../clients/event.client';
import { deleteNode, getNode, registerNode, updateNodeState } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

interface IRegisteredNode {
  id: number;
  name: string;
  nodeKey: string;
  secret: string;
}

const INSTANCE_KEY = '44444444-4444-4444-8444-444444444444';

const WAIT_OPTIONS = { timeout: 10_000 };

const desiredInstance = (overrides: Partial<DesiredInstance> = {}): DesiredInstance => ({
  instanceKey: INSTANCE_KEY,
  revision: 1,
  backend: BackendId.LLAMA_CPP,
  servedModel: 'chat-8b',
  model: {
    sizeBytes: 4_368_439_296,
    architecture: 'llama',
    quantisation: 'Q4_K',
    layerCount: 32,
    embeddingLength: 4096,
    headCount: 32,
    headCountKv: 8,
    contextLength: 8192,
  },
  weightsPath: '/models/llama-3-8b.gguf',
  configuration: { contextSize: 8192 },
  pins: { cpu: false, gpus: ['GPU-11111111-2222-3333-4444-555555555555'] },
  image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
  ...overrides,
});

const observedInstance = (overrides: Partial<ObservedInstance> = {}): ObservedInstance => ({
  instanceKey: INSTANCE_KEY,
  revision: 1,
  instanceState: InstanceState.READY,
  message: null,
  uptimeMs: null,
  exitCode: null,
  ...overrides,
});

const readFrame = (data: RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  return Buffer.from(data).toString('utf8');
};

/** Reading is destructive: each message is handed out once. Download sets are left to the download specs. */
class MessageQueue {
  private readonly arrived: ServerMessage[] = [];
  private readonly waiting: ((message: ServerMessage) => void)[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (data: RawData) => {
      const decoded = decodeServerMessage(readFrame(data));

      if (!decoded.ok) {
        throw new Error(`The server sent a frame the agent cannot read: ${decoded.reason}`);
      }

      if (decoded.message.type === ServerMessageType.DESIRED_DOWNLOADS) {
        return;
      }

      const waiter = this.waiting.shift();

      if (waiter === undefined) {
        this.arrived.push(decoded.message);
      } else {
        waiter(decoded.message);
      }
    });
  }

  next(): Promise<ServerMessage> {
    const arrived = this.arrived.shift();

    if (arrived !== undefined) {
      return Promise.resolve(arrived);
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  /** Discards every message ahead of the first of this type. */
  async nextOfType(type: ServerMessageType): Promise<ServerMessage> {
    for (;;) {
      const message = await this.next();

      if (message.type === type) {
        return message;
      }
    }
  }
}

const queues = new WeakMap<WebSocket, MessageQueue>();

const queueFor = (socket: WebSocket): MessageQueue => {
  const queue = queues.get(socket);

  if (queue === undefined) {
    throw new Error('This socket was opened without a message queue');
  }

  return queue;
};

const nextMessage = (socket: WebSocket): Promise<ServerMessage> => queueFor(socket).next();

const nextMessageOfType = (socket: WebSocket, type: ServerMessageType): Promise<ServerMessage> =>
  queueFor(socket).nextOfType(type);

const nextClose = (socket: WebSocket): Promise<number> =>
  new Promise(resolve => {
    socket.once('close', (code: number) => {
      resolve(code);
    });
  });

// One agent connection needs a listening server, which the shared app never starts.
describe('Agent connection (integration, serial)', () => {
  let app: NestExpressApplication;
  let socketUrl: string;
  let adminToken: string;

  const sockets: WebSocket[] = [];

  const uniqueName = (prefix: string = 'rig'): string => `${prefix}-${randomUUID()}`;

  const register = async (): Promise<IRegisteredNode> => {
    const response = await registerNode(app, adminToken, { name: uniqueName() }).expect(201);

    return response.body;
  };

  const open = async (): Promise<WebSocket> => {
    const socket = new WebSocket(socketUrl);
    sockets.push(socket);
    queues.set(socket, new MessageQueue(socket));

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    return socket;
  };

  const sayHello = (
    socket: WebSocket,
    node: Pick<IRegisteredNode, 'nodeKey' | 'secret'>,
    protocolVersions: number[] = [PROTOCOL_VERSION]
  ): void => {
    socket.send(
      encodeAgentMessage(AgentMessageType.HELLO, {
        nodeKey: node.nodeKey,
        secret: node.secret,
        agentVersion: 'integration',
        protocolVersions,
        relay: { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' },
      })
    );
  };

  const connect = async (
    node: IRegisteredNode
  ): Promise<{ socket: WebSocket; welcome: ServerMessage; desiredState: ServerMessage }> => {
    const socket = await open();

    sayHello(socket, node);

    const welcome = await nextMessage(socket);
    expect(welcome.type).toBe(ServerMessageType.WELCOME);

    const desiredState = await nextMessage(socket);
    expect(desiredState.type).toBe(ServerMessageType.DESIRED_STATE);

    return { socket, welcome, desiredState };
  };

  const refusalsFor = async (nodeKey: string): Promise<EventDto[]> => {
    const response = await getEventList(app, adminToken, {
      type: [EventType.NODE_CONNECTION_REFUSED],
      subjectType: EventPartyType.NODE,
    }).expect(200);

    return (response.body.eventList as EventDto[]).filter(event => event.detail.nodeKey === nodeKey);
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

  describe('handshake', () => {
    it('welcomes a registered node presenting its secret', async () => {
      const node = await register();

      const { welcome } = await connect(node);

      expect(welcome.payload).toMatchObject({
        nodeKey: node.nodeKey,
        protocolVersion: PROTOCOL_VERSION,
      });
    });

    it('marks a connected node online and records the connection', async () => {
      const node = await register();

      await connect(node);

      const response = await getNode(app, adminToken, node.id).expect(200);
      expect(response.body.state).toBe(NodeState.ONLINE);
      expect(response.body.lastSeenDate).not.toBeNull();
      expect(response.body.agentVersion).toBe('integration');

      const events = await getEventList(app, adminToken, {
        type: [EventType.NODE_CONNECTED],
        subjectType: EventPartyType.NODE,
        subjectId: `${node.id}`,
      }).expect(200);

      expect(events.body.eventList).toHaveLength(1);
    });

    it('refuses a node key that was never registered, and records the attempt', async () => {
      const socket = await open();
      const answered = nextMessage(socket);
      const closed = nextClose(socket);

      sayHello(socket, { nodeKey: randomUUID(), secret: 'mfn_whatever' });

      const reject = await answered;

      expect(reject.type).toBe(ServerMessageType.REJECT);
      expect(reject.payload).toMatchObject({ reason: RejectReason.UNKNOWN_NODE });
      expect(await closed).toBe(AgentCloseCode.REJECTED);

      const events = await getEventList(app, adminToken, {
        type: [EventType.NODE_CONNECTION_REFUSED],
      }).expect(200);

      expect(events.body.eventList.length).toBeGreaterThan(0);
    });

    it('refuses the wrong secret for a registered node, and records the attempt', async () => {
      const node = await register();

      const socket = await open();
      const answered = nextMessage(socket);

      sayHello(socket, { nodeKey: node.nodeKey, secret: 'mfn_not-the-secret' });

      const reject = await answered;

      expect(reject.payload).toMatchObject({ reason: RejectReason.INVALID_CREDENTIALS });

      const refusals = await refusalsFor(node.nodeKey);
      expect(refusals).toHaveLength(1);
      expect(refusals[0].detail.reason).toBe(RejectReason.INVALID_CREDENTIALS);
    });

    it('refuses a disabled node holding the right secret', async () => {
      const node = await register();
      await updateNodeState(app, adminToken, node.id, { enabled: false }).expect(200);

      const socket = await open();
      const answered = nextMessage(socket);

      sayHello(socket, node);

      expect((await answered).payload).toMatchObject({ reason: RejectReason.NODE_DISABLED });
    });

    it('refuses a protocol version the server does not speak, naming the reason', async () => {
      const node = await register();

      const socket = await open();
      const answered = nextMessage(socket);

      sayHello(socket, node, [PROTOCOL_VERSION + 99]);

      const reject = await answered;

      expect(reject.payload).toMatchObject({ reason: RejectReason.UNSUPPORTED_PROTOCOL_VERSION });
    });

    it('refuses a frame it cannot read', async () => {
      const socket = await open();
      const answered = nextMessage(socket);

      socket.send('{ not json');

      expect((await answered).payload).toMatchObject({ reason: RejectReason.MALFORMED_MESSAGE });
    });

    it('refuses a heartbeat sent before the handshake', async () => {
      const socket = await open();
      const answered = nextMessage(socket);

      socket.send(encodeAgentMessage(AgentMessageType.HEARTBEAT, {}));

      expect((await answered).payload).toMatchObject({ reason: RejectReason.UNEXPECTED_MESSAGE });
    });
  });

  describe('heartbeat', () => {
    it('moves the node on with each beat', async () => {
      const node = await register();
      const { socket } = await connect(node);

      const [connected] = await dbQuery<{ lastSeenDate: Date }>(
        app,
        'SELECT "lastSeenDate" FROM "node" WHERE id = $1',
        [node.id]
      );

      await new Promise(resolve => setTimeout(resolve, 25));
      socket.send(encodeAgentMessage(AgentMessageType.HEARTBEAT, {}));

      await vi.waitFor(async () => {
        const [beaten] = await dbQuery<{ lastSeenDate: Date }>(app, 'SELECT "lastSeenDate" FROM "node" WHERE id = $1', [
          node.id,
        ]);

        expect(new Date(beaten.lastSeenDate).getTime()).toBeGreaterThan(new Date(connected.lastSeenDate).getTime());
      }, WAIT_OPTIONS);
    });

    it('ends a session whose node is disabled while it is connected', async () => {
      const node = await register();
      const { socket } = await connect(node);

      await updateNodeState(app, adminToken, node.id, { enabled: false }).expect(200);

      const answered = nextMessage(socket);
      const closed = nextClose(socket);

      socket.send(encodeAgentMessage(AgentMessageType.HEARTBEAT, {}));

      expect((await answered).payload).toMatchObject({ reason: RejectReason.NODE_DISABLED });
      expect(await closed).toBe(AgentCloseCode.REJECTED);
    });
  });

  describe('desired and observed state', () => {
    it('sends a node with nothing scheduled to it an empty set', async () => {
      const node = await register();

      const { desiredState } = await connect(node);

      expect(desiredState.payload).toMatchObject({ instances: [], generation: 0 });
    });

    it('pushes a new generation to the node the change was made for', async () => {
      const node = await register();
      const { socket } = await connect(node);

      const nodeStateService = app.get(NodeStateService);
      nodeStateService.setDesiredInstances(node.id, [desiredInstance()]);

      const pushed = await nextMessageOfType(socket, ServerMessageType.DESIRED_STATE);

      expect(pushed.payload).toMatchObject({
        instances: [desiredInstance()],
        generation: 1,
      });
    });

    it('takes an observed state report as the truth about the node', async () => {
      const node = await register();
      const { socket } = await connect(node);

      socket.send(
        encodeAgentMessage(AgentMessageType.OBSERVED_STATE, {
          desiredGeneration: 0,
          instances: [observedInstance({ uptimeMs: 60_000 })],
        })
      );

      await vi.waitFor(
        () =>
          expect(app.get(NodeStateService).getObserved(node.id)).toMatchObject({
            desiredGeneration: 0,
            instances: [{ instanceKey: INSTANCE_KEY, instanceState: InstanceState.READY }],
          }),
        WAIT_OPTIONS
      );
    });

    it('replaces the whole set on the next report, dropping what the node no longer holds', async () => {
      const node = await register();
      const { socket } = await connect(node);

      socket.send(
        encodeAgentMessage(AgentMessageType.OBSERVED_STATE, {
          desiredGeneration: 0,
          instances: [observedInstance()],
        })
      );
      await vi.waitFor(
        () => expect(app.get(NodeStateService).getObserved(node.id)?.instances).toHaveLength(1),
        WAIT_OPTIONS
      );

      socket.send(encodeAgentMessage(AgentMessageType.OBSERVED_STATE, { desiredGeneration: 0, instances: [] }));
      await vi.waitFor(
        () => expect(app.get(NodeStateService).getObserved(node.id)?.instances).toEqual([]),
        WAIT_OPTIONS
      );
    });

    it('makes what a node holds unknown once it drops off, leaving its desired set alone', async () => {
      const node = await register();
      const { socket } = await connect(node);

      const nodeStateService = app.get(NodeStateService);
      nodeStateService.setDesiredInstances(node.id, [desiredInstance()]);

      socket.send(encodeAgentMessage(AgentMessageType.OBSERVED_STATE, { desiredGeneration: 1, instances: [] }));
      await vi.waitFor(() => expect(nodeStateService.getObserved(node.id)).not.toBeNull(), WAIT_OPTIONS);

      socket.close();
      await vi.waitFor(() => expect(nodeStateService.getObserved(node.id)).toBeNull(), WAIT_OPTIONS);

      expect(nodeStateService.getDesiredState(node.id).instances).toHaveLength(1);
    });

    it('replaces what it believed with the report a reconnecting node sends', async () => {
      const node = await register();
      const first = await connect(node);

      first.socket.send(
        encodeAgentMessage(AgentMessageType.OBSERVED_STATE, {
          desiredGeneration: 0,
          instances: [observedInstance()],
        })
      );
      await vi.waitFor(
        () => expect(app.get(NodeStateService).getObserved(node.id)?.instances).toHaveLength(1),
        WAIT_OPTIONS
      );

      first.socket.close();
      await vi.waitFor(() => expect(app.get(NodeStateService).getObserved(node.id)).toBeNull(), WAIT_OPTIONS);

      const second = await connect(node);
      second.socket.send(encodeAgentMessage(AgentMessageType.OBSERVED_STATE, { desiredGeneration: 0, instances: [] }));
      await vi.waitFor(
        () => expect(app.get(NodeStateService).getObserved(node.id)?.instances).toEqual([]),
        WAIT_OPTIONS
      );
    });

    it('refuses an observed state report sent before the handshake', async () => {
      const socket = await open();

      socket.send(encodeAgentMessage(AgentMessageType.OBSERVED_STATE, { desiredGeneration: null, instances: [] }));

      expect((await nextMessage(socket)).payload).toMatchObject({ reason: RejectReason.UNEXPECTED_MESSAGE });
    });

    it('drops both states for a node that is deleted', async () => {
      const node = await register();
      const { socket } = await connect(node);

      const nodeStateService = app.get(NodeStateService);
      nodeStateService.setDesiredInstances(node.id, [desiredInstance()]);

      socket.send(encodeAgentMessage(AgentMessageType.OBSERVED_STATE, { desiredGeneration: 1, instances: [] }));
      await vi.waitFor(() => expect(nodeStateService.getObserved(node.id)).not.toBeNull(), WAIT_OPTIONS);

      await deleteNode(app, adminToken, node.id).expect(200);

      expect(nodeStateService.getObserved(node.id)).toBeNull();
      expect(nodeStateService.getDesiredState(node.id)).toEqual({ instances: [], generation: 0 });
    });
  });

  describe('one connection per node', () => {
    it('closes the older connection when the same node connects again', async () => {
      const node = await register();
      const { socket: first } = await connect(node);

      const superseded = nextClose(first);

      await connect(node);

      expect(await superseded).toBe(AgentCloseCode.SUPERSEDED);
    });
  });

  describe('paths', () => {
    it('upgrades nothing but the agent path', async () => {
      const socket = new WebSocket(`${socketUrl}-not-really`);
      sockets.push(socket);

      await expect(
        new Promise((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
        })
      ).rejects.toThrow();
    });

    it('upgrades the agent path however it is queried', async () => {
      const node = await register();

      const socket = new WebSocket(`${socketUrl}?anything=at-all`);
      sockets.push(socket);
      queues.set(socket, new MessageQueue(socket));

      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });

      sayHello(socket, node);

      expect((await nextMessage(socket)).type).toBe(ServerMessageType.WELCOME);
    });

    it('answers an upgrade whose host header is not a host, and keeps serving', async () => {
      const address = app.getHttpServer().address() as AddressInfo;

      const answer = await new Promise<string>((resolve, reject) => {
        const raw = createConnection(address.port, '127.0.0.1', () => {
          raw.write(
            `GET ${AGENT_SOCKET_PATH} HTTP/1.1\r\nHost: not a host\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${Buffer.from('0123456789abcdef').toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`
          );
        });

        raw.once('data', (chunk: Buffer) => {
          raw.destroy();
          resolve(chunk.toString('utf8'));
        });

        raw.once('error', reject);
      });

      expect(answer).toContain('400');

      const node = await register();
      const { welcome } = await connect(node);

      expect(welcome.type).toBe(ServerMessageType.WELCOME);
    });
  });
});
