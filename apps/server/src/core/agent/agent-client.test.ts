import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerMessageType } from '@libs/agent-protocol';

import { AgentSessionService } from '@/core/agent/agent-session.service';

import { AgentClient } from '@/core/agent/agent-client';

const NODE_ID = 42;
const INSTANCE_KEY = '33333333-3333-4333-8333-333333333333';

const DESIRED_STATE = { instances: [{ instanceKey: INSTANCE_KEY, revision: 1 }], generation: 1 };

describe('AgentClient', () => {
  let send: ReturnType<typeof vi.fn>;
  let agentSessionService: { get: ReturnType<typeof vi.fn> };
  let client: AgentClient;

  beforeEach(() => {
    send = vi.fn();
    agentSessionService = { get: vi.fn().mockReturnValue({ send }) };
    client = new AgentClient(agentSessionService as unknown as AgentSessionService, NODE_ID);
  });

  it('sends an emitted message through the session of the node it names', async () => {
    await new Promise<void>(resolve => {
      client.emit(ServerMessageType.DESIRED_STATE, DESIRED_STATE).subscribe({ complete: () => resolve() });
    });

    expect(agentSessionService.get).toHaveBeenCalledWith(NODE_ID);
    expect(send).toHaveBeenCalledWith(ServerMessageType.DESIRED_STATE, DESIRED_STATE);
  });

  it('drops a message for a node out of contact', async () => {
    agentSessionService.get.mockReturnValue(undefined);

    await new Promise<void>(resolve => {
      client.emit(ServerMessageType.DESIRED_STATE, DESIRED_STATE).subscribe({ complete: () => resolve() });
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('resolves the session as the message dispatches', async () => {
    const reconnected = vi.fn();
    agentSessionService.get.mockReturnValue({ send: reconnected });

    await new Promise<void>(resolve => {
      client.emit(ServerMessageType.DESIRED_STATE, DESIRED_STATE).subscribe({ complete: () => resolve() });
    });

    expect(reconnected).toHaveBeenCalledWith(ServerMessageType.DESIRED_STATE, DESIRED_STATE);
  });

  it('refuses request and response until the protocol carries it', async () => {
    const failure = await new Promise<Error>(resolve => {
      client.send(ServerMessageType.DESIRED_STATE, DESIRED_STATE).subscribe({ error: resolve });
    });

    expect(failure.message).toMatch(/goes over the node's relay/);
  });
});
