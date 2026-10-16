import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentMessageType } from '@libs/agent-protocol';

import { ServerClient } from '@/server/server-client';
import { ServerSessionService } from '@/server/server-session.service';

const OBSERVED_STATE = { desiredGeneration: 1, instances: [] };

describe('ServerClient', () => {
  let send: ReturnType<typeof vi.fn>;
  let serverSessionService: { current: { send: ReturnType<typeof vi.fn> } | null };
  let client: ServerClient;

  beforeEach(() => {
    send = vi.fn();
    serverSessionService = { current: { send } };
    client = new ServerClient(serverSessionService as unknown as ServerSessionService);
  });

  it('sends an emitted message through the live session', async () => {
    await new Promise<void>(resolve => {
      client.emit(AgentMessageType.OBSERVED_STATE, OBSERVED_STATE).subscribe({ complete: () => resolve() });
    });

    expect(send).toHaveBeenCalledWith(AgentMessageType.OBSERVED_STATE, OBSERVED_STATE);
  });

  it('drops a message produced while this agent has no connection', async () => {
    serverSessionService.current = null;

    await new Promise<void>(resolve => {
      client.emit(AgentMessageType.OBSERVED_STATE, OBSERVED_STATE).subscribe({ complete: () => resolve() });
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('refuses request and response, which the protocol does not carry', async () => {
    const failure = await new Promise<Error>(resolve => {
      client.send(AgentMessageType.OBSERVED_STATE, OBSERVED_STATE).subscribe({ error: resolve });
    });

    expect(failure.message).toMatch(/events alone/);
  });
});
