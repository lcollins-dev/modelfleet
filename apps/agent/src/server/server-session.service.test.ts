import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentMessageType, decodeAgentMessage } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { RelayTokenService } from '@/relay/relay-token.service';
import { ServerSessionService } from '@/server/server-session.service';

const RELAY_URL = 'http://agent:3040';

const configService = {
  nodeKey: '11111111-1111-4111-8111-111111111111',
  nodeSecret: 'mfn_secret',
  version: '1.2.3',
  relayAdvertiseUrl: RELAY_URL,
  connectTimeoutMs: 10_000,
} as unknown as ConfigService;

const buildSocket = () => {
  const listeners = new Map<string, () => void>();

  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    emitClose: () => listeners.get('close')?.(),
  };
};

describe('ServerSessionService', () => {
  let relayTokenService: RelayTokenService;
  let serverSessionService: ServerSessionService;

  beforeEach(() => {
    relayTokenService = new RelayTokenService();
    serverSessionService = new ServerSessionService(configService, relayTokenService);
  });

  const helloFrom = (socket: ReturnType<typeof buildSocket>) => {
    const decoded = decodeAgentMessage(socket.send.mock.calls[0][0] as string);

    if (!decoded.ok || decoded.message.type !== AgentMessageType.HELLO) {
      throw new Error('The session sent no hello');
    }

    return decoded.message.payload;
  };

  it('advertises the relay and mints the token that opens it, in the hello', () => {
    const socket = buildSocket();

    serverSessionService.open(socket as unknown as WebSocket).start();

    const { relay } = helloFrom(socket);

    expect(relay.url).toBe(RELAY_URL);
    expect(relayTokenService.accepts(relay.token)).toBe(true);
  });

  it('mints a token per connection, so the one a dropped session advertised no longer opens the relay', () => {
    const first = buildSocket();

    serverSessionService.open(first as unknown as WebSocket).start();

    const firstToken = helloFrom(first).relay.token;

    const second = buildSocket();

    serverSessionService.open(second as unknown as WebSocket).start();

    expect(relayTokenService.accepts(firstToken)).toBe(false);
    expect(relayTokenService.accepts(helloFrom(second).relay.token)).toBe(true);
  });

  it('closes the relay to every token once the session holding it ends', () => {
    const socket = buildSocket();

    serverSessionService.open(socket as unknown as WebSocket).start();

    const token = helloFrom(socket).relay.token;

    socket.emitClose();

    expect(relayTokenService.accepts(token)).toBe(false);
  });

  it('leaves a replacement session its own token when the socket it superseded closes', () => {
    const superseded = buildSocket();

    serverSessionService.open(superseded as unknown as WebSocket).start();

    const replacement = buildSocket();

    serverSessionService.open(replacement as unknown as WebSocket).start();

    const token = helloFrom(replacement).relay.token;

    superseded.emitClose();

    expect(relayTokenService.accepts(token)).toBe(true);
  });

  it('closes the relay on shutdown', () => {
    const socket = buildSocket();

    serverSessionService.open(socket as unknown as WebSocket).start();

    const token = helloFrom(socket).relay.token;

    serverSessionService.close();

    expect(relayTokenService.accepts(token)).toBe(false);
  });
});
