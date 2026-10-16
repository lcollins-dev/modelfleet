import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerMessageType } from '@libs/agent-protocol';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { AgentSessionService } from '@/core/agent/agent-session.service';

import { buildDesiredInstance } from '@/test/instance.factory';

const NODE_ID = 42;
const OTHER_NODE_ID = 43;
const INSTANCE_KEY = '33333333-3333-4333-8333-333333333333';

const DESIRED_STATE = { instances: [buildDesiredInstance({ instanceKey: INSTANCE_KEY })], generation: 1 };

/** `emit` reaches the session a microtask later, since it connects through a promise. */
const dispatched = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('AgentConnectionService', () => {
  let send: ReturnType<typeof vi.fn>;
  let other: ReturnType<typeof vi.fn>;
  let agentSessionService: { get: ReturnType<typeof vi.fn> };
  let agentConnectionService: AgentConnectionService;

  beforeEach(() => {
    send = vi.fn();
    other = vi.fn();

    agentSessionService = {
      get: vi.fn((nodeId: number) => (nodeId === NODE_ID ? { send } : { send: other })),
    };

    agentConnectionService = new AgentConnectionService(agentSessionService as unknown as AgentSessionService);
  });

  it('carries a message to the node it names', async () => {
    agentConnectionService.send(NODE_ID, ServerMessageType.DESIRED_STATE, DESIRED_STATE);

    await dispatched();

    expect(send).toHaveBeenCalledWith(ServerMessageType.DESIRED_STATE, DESIRED_STATE);
  });

  it('gives each node its own client', async () => {
    agentConnectionService.send(NODE_ID, ServerMessageType.DESIRED_STATE, DESIRED_STATE);
    agentConnectionService.send(OTHER_NODE_ID, ServerMessageType.DESIRED_STATE, DESIRED_STATE);

    await dispatched();

    expect(send).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();
  });
});
