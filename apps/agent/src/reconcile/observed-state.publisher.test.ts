import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentMessageType, AgentObservedState, InstanceState } from '@libs/agent-protocol';

import { ObservedStatePublisher } from '@/reconcile/observed-state.publisher';
import { ReconcilerService } from '@/reconcile/reconciler.service';
import { ServerConnectionService } from '@/server/server-connection.service';

const KEY_A = '11111111-1111-4111-8111-111111111111';

const OBSERVED_STATE: AgentObservedState = {
  desiredGeneration: 1,
  instances: [
    {
      instanceKey: KEY_A,
      revision: 1,
      instanceState: InstanceState.READY,
      message: null,
      uptimeMs: 0,
      exitCode: null,
    },
  ],
};

const settled = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('ObservedStatePublisher', () => {
  let changes: Subject<AgentObservedState>;
  let welcomes: Subject<void>;
  let send: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let publisher: ObservedStatePublisher;

  beforeEach(() => {
    changes = new Subject<AgentObservedState>();
    welcomes = new Subject<void>();
    send = vi.fn();
    report = vi.fn().mockResolvedValue(undefined);

    publisher = new ObservedStatePublisher(
      { changes: () => changes.asObservable(), report } as unknown as ReconcilerService,
      { sessionOpened: () => welcomes.asObservable(), send } as unknown as ServerConnectionService
    );

    publisher.onModuleInit();
  });

  it('sends what the reconciler announces', () => {
    changes.next(OBSERVED_STATE);

    expect(send).toHaveBeenCalledWith(AgentMessageType.OBSERVED_STATE, OBSERVED_STATE);
  });

  it('asks for a report on every welcome', async () => {
    welcomes.next();
    welcomes.next();
    await settled();

    expect(report).toHaveBeenCalledTimes(2);
  });

  it('stops sending once it is torn down', async () => {
    publisher.onModuleDestroy();

    changes.next(OBSERVED_STATE);
    welcomes.next();
    await settled();

    expect(send).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
