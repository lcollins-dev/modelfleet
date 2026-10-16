import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import {
  AgentCloseCode,
  AgentMessageType,
  PROTOCOL_VERSION,
  RejectReason,
  SUPPORTED_PROTOCOL_VERSIONS,
  ServerWelcome,
  decodeAgentMessage,
} from '@libs/agent-protocol';
import { ISocketPort } from '@libs/runtime';

import { IServerSessionOptions, ServerSession } from '@/server/server-session';

const NODE_KEY = '11111111-1111-4111-8111-111111111111';
const HEARTBEAT_INTERVAL_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;

const RELAY = { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' };

const welcome = (): ServerWelcome => ({
  nodeKey: NODE_KEY,
  protocolVersion: PROTOCOL_VERSION,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
});

const buildSocket = () => ({
  send: vi.fn<ISocketPort['send']>(),
  close: vi.fn<ISocketPort['close']>(),
});

type ISocketMock = ReturnType<typeof buildSocket>;

const readSent = (socket: ISocketMock, index = 0) => {
  const frame = socket.send.mock.calls[index][0];
  const decoded = decodeAgentMessage(frame);

  if (!decoded.ok) {
    throw new Error(`The session sent a frame it cannot read back: ${decoded.reason}`);
  }

  return decoded.message;
};

describe('ServerSession', () => {
  let socket: ISocketMock;
  let onOpened: Mock<IServerSessionOptions['onOpened']>;
  let onClosed: Mock<IServerSessionOptions['onClosed']>;

  const buildSession = () =>
    new ServerSession(socket, {
      nodeKey: NODE_KEY,
      secret: 'mfn_secret',
      agentVersion: '1.2.3',
      relay: RELAY,
      gpuHeadroomBytes: 2 * 1024 ** 3,
      handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
      onOpened,
      onClosed,
    });

  beforeEach(() => {
    vi.useFakeTimers();

    socket = buildSocket();
    onOpened = vi.fn<IServerSessionOptions['onOpened']>();
    onClosed = vi.fn<IServerSessionOptions['onClosed']>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens with a hello carrying its credentials, every version it speaks and its GPU headroom', () => {
    buildSession().start();

    const hello = readSent(socket);

    expect(hello.type).toBe(AgentMessageType.HELLO);
    expect(hello.payload).toMatchObject({
      nodeKey: NODE_KEY,
      secret: 'mfn_secret',
      agentVersion: '1.2.3',
      protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      relay: RELAY,
      gpuHeadroomBytes: 2 * 1024 ** 3,
    });
  });

  it('beats at the interval the welcome named', () => {
    const session = buildSession();

    session.start();
    session.handleWelcome(welcome());
    socket.send.mockClear();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(readSent(socket).type).toBe(AgentMessageType.HEARTBEAT);
    expect(onOpened).toHaveBeenCalledOnce();
    expect(session.isReady).toBe(true);
  });

  it('sends no heartbeat before it has been welcomed', () => {
    const session = buildSession();

    session.start();
    socket.send.mockClear();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('closes a connection the server never welcomed', () => {
    const session = buildSession();

    session.start();

    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);

    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.HEARTBEAT_TIMEOUT, 'handshake-timeout');
  });

  it('closes on a refusal, naming the reason the server gave', () => {
    const session = buildSession();

    session.start();
    session.handleReject({ reason: RejectReason.INVALID_CREDENTIALS, message: 'refused' });

    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.REJECTED, RejectReason.INVALID_CREDENTIALS);
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('closes on a frame it cannot read', () => {
    const session = buildSession();

    session.start();
    session.handleMalformed('payload failed validation');

    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.REJECTED, RejectReason.MALFORMED_MESSAGE);
  });

  it('closes when a second welcome arrives on one connection', () => {
    const session = buildSession();

    session.start();
    session.handleWelcome(welcome());
    session.handleWelcome(welcome());

    expect(socket.close).toHaveBeenCalledWith(AgentCloseCode.REJECTED, 'unexpected-message');
    expect(onOpened).toHaveBeenCalledOnce();
  });

  it('stops beating once the connection closes', () => {
    const session = buildSession();

    session.start();
    session.handleWelcome(welcome());
    session.handleClose();
    socket.send.mockClear();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('reports a welcomed session ending', () => {
    const session = buildSession();

    session.start();
    session.handleWelcome(welcome());
    session.handleClose();

    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('reports no session ending where the handshake never settled', () => {
    const session = buildSession();

    session.start();
    session.handleClose();

    expect(onClosed).not.toHaveBeenCalled();
  });

  it('ignores a message that arrives after it closed', () => {
    const session = buildSession();

    session.start();
    session.handleClose();
    session.handleWelcome(welcome());

    expect(onOpened).not.toHaveBeenCalled();
  });
});
