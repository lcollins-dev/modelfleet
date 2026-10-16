import { InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import {
  AgentCloseCode,
  AgentHello,
  PROTOCOL_VERSION,
  ServerMessageType,
  decodeServerMessage,
} from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { AgentSessionService } from '@/core/agent/agent-session.service';
import { NodeAgentService } from '@/core/node/node-agent.service';
import { NodeStateService } from '@/core/node/node-state.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

import { DesiredStatePublisher } from '@/core/agent/desired-state.publisher';
import { buildDesiredInstance } from '@/test/instance.factory';
import { buildNode, TEST_NODE_KEY as NODE_KEY } from '@/test/node.factory';

const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const INSTANCE_KEY = '33333333-3333-4333-8333-333333333333';

const RELAY = { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' };

const hello = (): AgentHello => ({
  nodeKey: NODE_KEY,
  secret: 'mfn_secret',
  agentVersion: '1.2.3',
  protocolVersions: [PROTOCOL_VERSION],
  relay: RELAY,
});

const buildClient = () =>
  ({
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  }) as unknown as WebSocket & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

const REQUEST = { socket: { remoteAddress: '192.0.2.7' } } as IncomingMessage;

/** `emit` reaches the socket a microtask later, since it connects through a promise. */
const dispatched = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const readSent = (client: ReturnType<typeof buildClient>, index = 0) => {
  const decoded = decodeServerMessage(client.send.mock.calls[index][0] as string);

  if (!decoded.ok) {
    throw new Error(`The session sent a frame it cannot read back: ${decoded.reason}`);
  }

  return decoded.message;
};

describe('AgentSessionService', () => {
  let service: AgentSessionService;
  let publisher: DesiredStatePublisher;
  let nodeStateService: NodeStateService;
  let nodeAgentService: { authenticate: ReturnType<typeof vi.fn> } & Record<string, ReturnType<typeof vi.fn>>;
  let telemetryService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    nodeAgentService = {
      authenticate: vi.fn(),
      recordConnected: vi.fn().mockResolvedValue(undefined),
      recordDisconnected: vi.fn().mockResolvedValue(undefined),
      markSeen: vi.fn().mockResolvedValue(undefined),
      findLiveNode: vi.fn().mockResolvedValue(null),
    };

    nodeStateService = new NodeStateService();
    telemetryService = { recordInventory: vi.fn(), recordTelemetry: vi.fn(), forget: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentSessionService,
        { provide: NodeAgentService, useValue: nodeAgentService },
        { provide: NodeStateService, useValue: nodeStateService },
        { provide: TelemetryService, useValue: telemetryService },
        AgentConnectionService,
        DesiredStatePublisher,
        {
          provide: ConfigService,
          useValue: {
            nodeHeartbeatIntervalMs: 10_000,
            nodeHandshakeTimeoutMs: 10_000,
            nodeOfflineThresholdMs: 30_000,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AgentSessionService);
    publisher = moduleRef.get(DesiredStatePublisher);
    publisher.onModuleInit();
  });

  const welcome = async (nodeId: number) => {
    nodeAgentService.authenticate.mockResolvedValue({
      ok: true,
      node: buildNode({ id: nodeId, name: `rig-${nodeId}` }),
      protocolVersion: PROTOCOL_VERSION,
    });

    const client = buildClient();
    const session = service.open(client, REQUEST);
    await session.handleHello(hello(), MESSAGE_ID);

    return { client, session };
  };

  it('binds a session to the socket it was opened for', () => {
    const client = buildClient();
    const session = service.open(client, REQUEST);

    expect(service.forClient(client)).toBe(session);
  });

  it('holds nothing against a node until the handshake succeeds', () => {
    service.open(buildClient(), REQUEST);

    expect(service.size).toBe(0);
  });

  it('holds a welcomed session against its node', async () => {
    const { session } = await welcome(42);

    expect(service.get(42)).toBe(session);
    expect(service.size).toBe(1);
  });

  it('holds where a welcomed node relays inference, and what it accepts', async () => {
    await welcome(42);

    expect(service.relayFor(42)).toEqual(RELAY);
  });

  it('holds no relay for a node with no session, so nothing is dialled at a node that is gone', async () => {
    const { session } = await welcome(42);

    expect(service.relayFor(7)).toBeNull();

    await session.handleClose(1006);

    expect(service.relayFor(42)).toBeNull();
  });

  it('closes the older connection when the same node connects again', async () => {
    const first = await welcome(42);
    const second = await welcome(42);

    expect(first.session).not.toBe(second.session);
    expect(first.client.close).toHaveBeenCalledWith(AgentCloseCode.SUPERSEDED, 'superseded');
    expect(service.get(42)).toBe(second.session);
    expect(service.size).toBe(1);
  });

  it('leaves a successor in place when the session it replaced closes late', async () => {
    const first = await welcome(42);
    const second = await welcome(42);

    await first.session.handleClose(AgentCloseCode.SUPERSEDED);

    expect(service.get(42)).toBe(second.session);
  });

  it('drops a session from its socket once that socket closes', async () => {
    const { client } = await welcome(42);

    const onClose = client.on.mock.calls.find(call => call[0] === 'close')?.[1] as (code: number) => void;
    onClose(1006);

    expect(() => service.forClient(client)).toThrow(InternalServerErrorException);
  });

  it('refuses a socket it never opened a session for', () => {
    expect(() => service.forClient(buildClient())).toThrow(InternalServerErrorException);
  });

  it('pushes desired state to the node it moved for', async () => {
    const { client } = await welcome(42);
    client.send.mockClear();

    nodeStateService.setDesiredInstances(42, [buildDesiredInstance({ instanceKey: INSTANCE_KEY })]);
    await dispatched();

    const desiredState = readSent(client);

    expect(desiredState.type).toBe(ServerMessageType.DESIRED_STATE);
    expect(desiredState.payload).toMatchObject({ instances: [buildDesiredInstance({ instanceKey: INSTANCE_KEY })] });
  });

  it('leaves a node alone when another node is scheduled to', async () => {
    const { client } = await welcome(42);
    client.send.mockClear();

    nodeStateService.setDesiredInstances(43, [buildDesiredInstance({ instanceKey: INSTANCE_KEY })]);
    await dispatched();

    expect(client.send).not.toHaveBeenCalled();
  });

  it('makes what a node holds unknown once its connection drops', async () => {
    const { session } = await welcome(42);
    nodeStateService.replaceObserved(42, { desiredGeneration: 0, instances: [] });

    await session.handleClose(1006);

    expect(nodeStateService.getObserved(42)).toBeNull();
  });

  it('keeps the successor report when the session it replaced closes late', async () => {
    const first = await welcome(42);
    await welcome(42);
    nodeStateService.replaceObserved(42, { desiredGeneration: 0, instances: [] });

    await first.session.handleClose(AgentCloseCode.SUPERSEDED);

    expect(nodeStateService.getObserved(42)).not.toBeNull();
  });

  it('stops pushing desired state once the module is torn down', async () => {
    const { client } = await welcome(42);
    publisher.onModuleDestroy();
    client.send.mockClear();

    nodeStateService.setDesiredInstances(42, [buildDesiredInstance({ instanceKey: INSTANCE_KEY })]);
    await dispatched();

    expect(client.send).not.toHaveBeenCalled();
  });

  it('closes every session on shutdown', async () => {
    const first = await welcome(1);
    const second = await welcome(2);

    await service.closeAll();

    expect(first.client.close).toHaveBeenCalled();
    expect(second.client.close).toHaveBeenCalled();
    expect(service.size).toBe(0);
  });

  it("finishes shutting down only once each node's disconnection is recorded", async () => {
    const { promise: recording, resolve: recorded } = Promise.withResolvers<undefined>();
    nodeAgentService.recordDisconnected.mockReturnValue(recording);
    await welcome(1);

    let closed = false;
    const closing = service.closeAll().then(() => {
      closed = true;
    });
    await dispatched();

    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      AgentCloseCode.SHUTDOWN
    );
    expect(closed).toBe(false);

    recorded(undefined);
    await closing;

    expect(closed).toBe(true);
  });

  it('waits on a disconnection still being recorded when shutdown begins', async () => {
    const { promise: recording, resolve: recorded } = Promise.withResolvers<undefined>();
    nodeAgentService.recordDisconnected.mockReturnValue(recording);
    const { client } = await welcome(1);

    const onClose = client.on.mock.calls.find(call => call[0] === 'close')?.[1] as (code: number) => void;
    onClose(1006);

    let closed = false;
    const closing = service.closeAll().then(() => {
      closed = true;
    });
    await dispatched();

    expect(closed).toBe(false);

    recorded(undefined);
    await closing;

    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledOnce();
    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 1006);
  });

  it('records a disconnection once where its socket closes after shutdown', async () => {
    const { client } = await welcome(1);

    await service.closeAll();

    const onClose = client.on.mock.calls.find(call => call[0] === 'close')?.[1] as (code: number) => void;
    onClose(1006);
    await dispatched();

    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledOnce();
    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      AgentCloseCode.SHUTDOWN
    );
  });

  it('records a session already closing on shutdown with the code it was closed with', async () => {
    await welcome(42);
    await welcome(42);

    await service.closeAll();

    expect(nodeAgentService.recordDisconnected).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 42 }),
      AgentCloseCode.SUPERSEDED
    );
    expect(nodeAgentService.recordDisconnected).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 42 }),
      AgentCloseCode.SHUTDOWN
    );
  });

  it('finishes shutting down where a disconnection cannot be recorded', async () => {
    nodeAgentService.recordDisconnected.mockRejectedValue(new Error('the database went away'));
    await welcome(1);

    await expect(service.closeAll()).resolves.toBeUndefined();
  });

  it('stops waiting on a disconnection that is never recorded', async () => {
    nodeAgentService.recordDisconnected.mockReturnValue(new Promise(() => {}));
    await welcome(1);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      const closing = service.closeAll();

      await vi.advanceTimersByTimeAsync(5000);

      await expect(closing).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
