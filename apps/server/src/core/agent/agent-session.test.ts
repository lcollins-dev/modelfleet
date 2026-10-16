import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import {
  AgentCloseCode,
  AgentCloseReason,
  AgentHello,
  AgentObservedState,
  InstanceState,
  PROTOCOL_VERSION,
  RejectReason,
  ServerDesiredState,
  ServerMessageType,
  decodeServerMessage,
} from '@libs/agent-protocol';
import { ISocketPort } from '@libs/runtime';

import { NodeAgentService } from '@/core/node/node-agent.service';
import { NodeStateService } from '@/core/node/node-state.service';

import { AgentSession, IAgentSessionOptions } from '@/core/agent/agent-session';
import { buildDesiredInstance } from '@/test/instance.factory';
import { buildNode, TEST_NODE_ID as NODE_ID, TEST_NODE_KEY as NODE_KEY } from '@/test/node.factory';

const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const REMOTE_ADDRESS = '192.0.2.7';
const INSTANCE_KEY = '33333333-3333-4333-8333-333333333333';

const RELAY = { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' };

const EMPTY_DESIRED_STATE: ServerDesiredState = { instances: [], generation: 0 };

const observedState = (): AgentObservedState => ({
  desiredGeneration: 0,
  instances: [
    {
      instanceKey: INSTANCE_KEY,
      revision: 1,
      instanceState: InstanceState.READY,
      message: null,
      uptimeMs: null,
      exitCode: null,
    },
  ],
});

const OPTIONS: Omit<IAgentSessionOptions, 'onOpened' | 'onClosed'> = {
  remoteAddress: REMOTE_ADDRESS,
  heartbeatIntervalMs: 10_000,
  handshakeTimeoutMs: 5_000,
  silenceTimeoutMs: 30_000,
};

const hello = (): AgentHello => ({
  nodeKey: NODE_KEY,
  secret: 'mfn_secret',
  agentVersion: '1.2.3',
  protocolVersions: [PROTOCOL_VERSION],
  relay: RELAY,
});

const buildSocket = () => ({
  send: vi.fn<ISocketPort['send']>(),
  close: vi.fn<ISocketPort['close']>(),
});

type ISocketMock = ReturnType<typeof buildSocket>;

const readSent = (socket: ISocketMock, index = 0) => {
  const frame = socket.send.mock.calls[index][0];
  const decoded = decodeServerMessage(frame);

  if (!decoded.ok) {
    throw new Error(`The session sent a frame it cannot read back: ${decoded.reason}`);
  }

  return decoded.message;
};

describe('AgentSession', () => {
  let socket: ISocketMock;
  let nodeAgentService: {
    authenticate: ReturnType<typeof vi.fn>;
    recordConnected: ReturnType<typeof vi.fn>;
    recordDisconnected: ReturnType<typeof vi.fn>;
    markSeen: ReturnType<typeof vi.fn>;
    findLiveNode: ReturnType<typeof vi.fn>;
  };
  let nodeStateService: {
    getDesiredState: ReturnType<typeof vi.fn>;
    replaceObserved: ReturnType<typeof vi.fn>;
    clearObserved: ReturnType<typeof vi.fn>;
  };
  let onOpened: Mock<(session: AgentSession) => void>;
  let onClosed: Mock<(session: AgentSession) => void>;

  const elapse = (ms: number): void => {
    vi.advanceTimersByTime(ms);
  };

  const buildSession = () =>
    new AgentSession(
      socket,
      nodeAgentService as unknown as NodeAgentService,
      nodeStateService as unknown as NodeStateService,
      { ...OPTIONS, onOpened, onClosed }
    );

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();

    socket = buildSocket();
    onOpened = vi.fn<(session: AgentSession) => void>();
    onClosed = vi.fn<(session: AgentSession) => void>();

    nodeAgentService = {
      authenticate: vi.fn().mockResolvedValue({ ok: true, node: buildNode(), protocolVersion: PROTOCOL_VERSION }),
      recordConnected: vi.fn().mockResolvedValue(undefined),
      recordDisconnected: vi.fn().mockResolvedValue(undefined),
      markSeen: vi.fn().mockResolvedValue(undefined),
      findLiveNode: vi.fn().mockResolvedValue(buildNode()),
    };

    nodeStateService = {
      getDesiredState: vi.fn().mockReturnValue(EMPTY_DESIRED_STATE),
      replaceObserved: vi.fn(),
      clearObserved: vi.fn(),
    };
  });

  it('welcomes an authenticated agent with the negotiated version and the heartbeat interval', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    const welcome = readSent(socket);

    expect(welcome.type).toBe(ServerMessageType.WELCOME);
    expect(welcome.payload).toMatchObject({
      nodeKey: NODE_KEY,
      protocolVersion: PROTOCOL_VERSION,
      heartbeatIntervalMs: OPTIONS.heartbeatIntervalMs,
    });
    expect(welcome.correlationId).toBe(MESSAGE_ID);
    expect(session.isReady).toBe(true);
    expect(onOpened).toHaveBeenCalledWith(session);
  });

  it('holds the GPU headroom the agent reported for as long as the session lasts', async () => {
    const session = buildSession();

    await session.handleHello({ ...hello(), gpuHeadroomBytes: 2 * 1024 ** 3 }, MESSAGE_ID);

    expect(session.gpuHeadroomBytes).toBe(2 * 1024 ** 3);
  });

  it('holds no GPU headroom for an agent that predates reporting one', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    expect(session.gpuHeadroomBytes).toBeNull();
  });

  it('records the connection once the agent is welcomed', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    expect(nodeAgentService.recordConnected).toHaveBeenCalledOnce();
  });

  it('sends the node its desired state as soon as it is welcomed', async () => {
    nodeStateService.getDesiredState.mockReturnValue({
      instances: [buildDesiredInstance({ instanceKey: INSTANCE_KEY, revision: 4 })],
      generation: 7,
    });

    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    const desiredState = readSent(socket, 1);

    expect(desiredState.type).toBe(ServerMessageType.DESIRED_STATE);
    expect(desiredState.payload).toMatchObject({
      instances: [{ instanceKey: INSTANCE_KEY, revision: 4 }],
      generation: 7,
    });
    expect(nodeStateService.getDesiredState).toHaveBeenCalledWith(NODE_ID);
  });

  it('takes an observed state report whole, without comparing it to what it believed', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    session.handleObservedState(observedState());

    expect(nodeStateService.replaceObserved).toHaveBeenCalledWith(NODE_ID, observedState());
  });

  it('refuses an observed state report that arrives before the handshake', () => {
    const session = buildSession();

    session.handleObservedState(observedState());

    expect(readSent(socket).payload).toMatchObject({ reason: RejectReason.UNEXPECTED_MESSAGE });
    expect(nodeStateService.replaceObserved).not.toHaveBeenCalled();
  });

  it('sends nothing on a connection that never got past the handshake', () => {
    const session = buildSession();

    session.send(ServerMessageType.DESIRED_STATE, EMPTY_DESIRED_STATE);

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('refuses a rejected handshake with the reason the service gave, and closes', async () => {
    nodeAgentService.authenticate.mockResolvedValue({
      ok: false,
      reason: RejectReason.INVALID_CREDENTIALS,
      message: 'The secret is incorrect for this node',
    });

    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    const reject = readSent(socket);

    expect(reject.type).toBe(ServerMessageType.REJECT);
    expect(reject.payload).toMatchObject({ reason: RejectReason.INVALID_CREDENTIALS });
    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.REJECTED, RejectReason.INVALID_CREDENTIALS);
    expect(session.isReady).toBe(false);
  });

  it('answers a frame the codec could not read, rather than leaving the agent in silence', () => {
    const session = buildSession();

    session.handleMalformed('The frame is not valid JSON');

    expect(readSent(socket).payload).toMatchObject({
      reason: RejectReason.MALFORMED_MESSAGE,
      message: 'The frame is not valid JSON',
    });
    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.REJECTED, RejectReason.MALFORMED_MESSAGE);
  });

  it('refuses a heartbeat that arrives before the handshake', async () => {
    const session = buildSession();

    await session.handleHeartbeat();

    expect(readSent(socket).payload).toMatchObject({ reason: RejectReason.UNEXPECTED_MESSAGE });
    expect(nodeAgentService.markSeen).not.toHaveBeenCalled();
  });

  it('refuses a second hello on one connection', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    socket.send.mockClear();

    await session.handleHello(hello(), MESSAGE_ID);

    expect(readSent(socket).payload).toMatchObject({ reason: RejectReason.UNEXPECTED_MESSAGE });
    expect(nodeAgentService.authenticate).toHaveBeenCalledOnce();
  });

  it('stamps the node as seen on each heartbeat', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    await session.handleHeartbeat();

    expect(nodeAgentService.markSeen).toHaveBeenCalledWith(NODE_ID);
  });

  it('ends a session whose node was disabled after it connected', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    nodeAgentService.findLiveNode.mockResolvedValue(buildNode({ enabled: false }));
    socket.send.mockClear();

    await session.handleHeartbeat();

    expect(readSent(socket).payload).toMatchObject({ reason: RejectReason.NODE_DISABLED });
    expect(nodeAgentService.markSeen).not.toHaveBeenCalled();
  });

  it('ends a session whose node was deleted after it connected', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    nodeAgentService.findLiveNode.mockResolvedValue(null);
    socket.send.mockClear();

    await session.handleHeartbeat();

    expect(readSent(socket).payload).toMatchObject({ reason: RejectReason.UNKNOWN_NODE });
  });

  it('holds a connection that has yet to use up its handshake window', () => {
    buildSession();

    elapse(OPTIONS.handshakeTimeoutMs - 1);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('refuses a connection that never said hello', () => {
    buildSession();

    elapse(OPTIONS.handshakeTimeoutMs);

    expect(readSent(socket).payload).toMatchObject({ reason: RejectReason.UNEXPECTED_MESSAGE });
    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.REJECTED, RejectReason.UNEXPECTED_MESSAGE);
  });

  it('holds a welcomed connection to the silence window, which outlasts the handshake one', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    elapse(OPTIONS.handshakeTimeoutMs + 1);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('closes a welcomed connection that went silent', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    elapse(OPTIONS.silenceTimeoutMs + 1);

    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.HEARTBEAT_TIMEOUT, 'heartbeat-timeout');
    expect(session.isReady).toBe(false);
  });

  it('holds a connection open while heartbeats keep arriving', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    for (let beat = 0; beat < 5; beat += 1) {
      elapse(OPTIONS.silenceTimeoutMs - 1);
      await session.handleHeartbeat();
    }

    expect(socket.close).not.toHaveBeenCalled();
    expect(session.isReady).toBe(true);
  });

  it('leaves a closed connection alone however long it has been', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    await session.handleClose(1006);
    socket.close.mockClear();

    elapse(OPTIONS.silenceTimeoutMs * 10);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('records a disconnection for a session that had been welcomed', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    await session.handleClose(AgentCloseCode.SHUTDOWN);

    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledWith(expect.objectContaining({ id: NODE_ID }), 4004);
    expect(onClosed).toHaveBeenCalledWith(session);
  });

  it('records no disconnection for a connection that never got past the handshake', async () => {
    const session = buildSession();

    await session.handleClose(1006);

    expect(nodeAgentService.recordDisconnected).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledWith(session);
  });

  it('runs the close path once, however many times it is told', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);

    await session.handleClose(1006);
    await session.handleClose(1006);

    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledOnce();
  });

  it('records the code it closed with, over the one the socket reports later', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    session.close(AgentCloseCode.HEARTBEAT_TIMEOUT, AgentCloseReason.HEARTBEAT_TIMEOUT);
    await session.handleClose(1006);

    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledWith(
      expect.objectContaining({ id: NODE_ID }),
      AgentCloseCode.HEARTBEAT_TIMEOUT
    );
  });

  it('opens nothing for a connection that closes while it is authenticated', async () => {
    const { promise: authenticated, resolve: authenticate } = Promise.withResolvers<unknown>();
    nodeAgentService.authenticate.mockReturnValue(authenticated);
    const session = buildSession();

    const greeting = session.handleHello(hello(), MESSAGE_ID);
    const closing = session.handleClose(1006);

    authenticate({ ok: true, node: buildNode(), protocolVersion: PROTOCOL_VERSION });
    await Promise.all([greeting, closing]);

    expect(onOpened).not.toHaveBeenCalled();
    expect(nodeAgentService.recordConnected).not.toHaveBeenCalled();
    expect(nodeAgentService.recordDisconnected).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('records a connection before its end where the session closes while the connection is recorded', async () => {
    const { promise: connected, resolve: connect } = Promise.withResolvers<undefined>();
    nodeAgentService.recordConnected.mockReturnValue(connected);
    const session = buildSession();

    const greeting = session.handleHello(hello(), MESSAGE_ID);
    await vi.waitFor(() => expect(nodeAgentService.recordConnected).toHaveBeenCalled());

    const closing = session.handleClose(1006);
    await Promise.resolve();

    expect(nodeAgentService.recordDisconnected).not.toHaveBeenCalled();

    connect(undefined);
    await Promise.all([greeting, closing]);

    expect(nodeAgentService.recordDisconnected).toHaveBeenCalledOnce();
    expect(readSent(socket).type).toBe(ServerMessageType.WELCOME);
    expect(socket.send).toHaveBeenCalledOnce();

    elapse(OPTIONS.silenceTimeoutMs);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('ignores a message that arrives after the session has closed', async () => {
    const session = buildSession();

    await session.handleHello(hello(), MESSAGE_ID);
    await session.handleClose(1006);
    socket.send.mockClear();

    await session.handleHeartbeat();

    expect(socket.send).not.toHaveBeenCalled();
  });
});
