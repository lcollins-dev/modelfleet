import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentObservedState,
  DesiredInstance,
  InstanceState,
  ObservedInstance,
  ServerDesiredState,
} from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { DockerUnavailableError } from '@/docker/api/errors';
import { InstanceRuntimeService } from '@/instance/instance-runtime.service';
import { ReconcilerService } from '@/reconcile/reconciler.service';
import { TelemetryService } from '@/telemetry/telemetry.service';
import { buildDesiredInstance, buildObservedInstance } from '@/test/instance.factory';

const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';

const RECONCILE_INTERVAL_MS = 10_000;

const configService = { reconcileIntervalMs: 10_000 } as unknown as ConfigService;

const desiredState = (instances: DesiredInstance[], generation = 1): ServerDesiredState => ({
  instances,
  generation,
});

const desired = (instanceKey: string, revision = 1) => buildDesiredInstance({ instanceKey, revision });

/** Stands in for containers: what start puts on the node is what list answers with. */
class FakeRuntime {
  readonly held = new Map<string, ObservedInstance>();
  readonly ready = new Subject<string>();

  readonly start = vi.fn((instance: DesiredInstance) => {
    this.held.set(
      instance.instanceKey,
      buildObservedInstance({ instanceKey: instance.instanceKey, revision: instance.revision })
    );

    return Promise.resolve();
  });

  readonly stop = vi.fn((instanceKey: string) => {
    this.held.delete(instanceKey);

    return Promise.resolve();
  });

  list = vi.fn(() => Promise.resolve([...this.held.values()]));

  changes() {
    return this.ready.asObservable();
  }
}

const runtimeOf = (fake: FakeRuntime): InstanceRuntimeService => fake as unknown as InstanceRuntimeService;

const GPU_TOTAL_BYTES = 24 * 1024 ** 3;

const readCards: { deviceKey: string; memoryTotalBytes: number | null }[] = [];

const telemetryService = {
  currentInventory: () => ({ devices: readCards }),
} as unknown as TelemetryService;

describe('ReconcilerService', () => {
  let fake: FakeRuntime;
  let reconcilerService: ReconcilerService;
  let announced: AgentObservedState[];

  const listen = (service: ReconcilerService): AgentObservedState[] => {
    const seen: AgentObservedState[] = [];
    service.changes().subscribe(state => seen.push(state));

    return seen;
  };

  const keysAnnounced = (seen: AgentObservedState[]): string[] =>
    seen.at(-1)?.instances.map(instance => instance.instanceKey) ?? [];

  beforeEach(() => {
    readCards.splice(
      0,
      readCards.length,
      { deviceKey: 'GPU-read', memoryTotalBytes: GPU_TOTAL_BYTES },
      { deviceKey: 'GPU-unread', memoryTotalBytes: null }
    );
    fake = new FakeRuntime();
    reconcilerService = new ReconcilerService(configService, runtimeOf(fake), telemetryService);
    announced = listen(reconcilerService);
  });

  it('starts what the server asked for', async () => {
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));

    expect(keysAnnounced(announced)).toEqual([KEY_A]);
    expect(announced.at(-1)?.desiredGeneration).toBe(1);
  });

  it('hands each start the total memory of every card the node has read', async () => {
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));

    expect(fake.start).toHaveBeenCalledWith(
      expect.objectContaining({ instanceKey: KEY_A }),
      new Map([['GPU-read', GPU_TOTAL_BYTES]])
    );
  });

  it('removes an instance that has left desired state', async () => {
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_B)], 2));

    expect(keysAnnounced(announced)).toEqual([KEY_B]);
  });

  it('replaces an instance the server moved to a new revision', async () => {
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A, 2)], 2));

    expect(fake.stop).toHaveBeenCalledWith(KEY_A);
    expect(announced.at(-1)?.instances[0].revision).toBe(2);
  });

  it('removes what it is replacing before it starts the replacement', async () => {
    const order: string[] = [];

    fake.stop.mockImplementation((instanceKey: string) => {
      order.push(`stop:${instanceKey}`);
      fake.held.delete(instanceKey);

      return Promise.resolve();
    });
    fake.start.mockImplementation((instance: DesiredInstance) => {
      order.push(`start:${instance.instanceKey}`);
      fake.held.set(instance.instanceKey, buildObservedInstance({ instanceKey: instance.instanceKey }));

      return Promise.resolve();
    });

    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A, 2)], 2));

    expect(order).toEqual([`start:${KEY_A}`, `stop:${KEY_A}`, `start:${KEY_A}`]);
  });

  it('takes no action where the node already matches', async () => {
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));
    fake.start.mockClear();

    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)], 2));

    expect(fake.start).not.toHaveBeenCalled();
  });

  it('leaves a failed instance alone, since keeping it alive is the runtime job', async () => {
    fake.held.set(KEY_A, buildObservedInstance({ instanceKey: KEY_A, instanceState: InstanceState.FAILED }));

    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));

    expect(fake.start).not.toHaveBeenCalled();
    expect(announced.at(-1)?.instances[0]).toMatchObject({ instanceState: InstanceState.FAILED });
  });

  it('announces what the node holds without acting on it', async () => {
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));
    fake.start.mockClear();

    await reconcilerService.report();

    expect(fake.start).not.toHaveBeenCalled();
    expect(keysAnnounced(announced)).toEqual([KEY_A]);
  });

  it('leaves what the node holds alone where the server has recorded no set for it', async () => {
    fake.held.set(KEY_A, buildObservedInstance({ instanceKey: KEY_A }));

    await reconcilerService.applyDesiredState({ instances: [], generation: 0 });

    expect(fake.stop).not.toHaveBeenCalled();
    expect(fake.held.has(KEY_A)).toBe(true);
  });

  it('leaves what the node holds alone until the server has sent it a set', async () => {
    fake.held.set(KEY_A, buildObservedInstance({ instanceKey: KEY_A }));

    await reconcilerService.converge();

    expect(fake.stop).not.toHaveBeenCalled();
    expect(fake.held.has(KEY_A)).toBe(true);
  });

  it('leaves the node alone where the Docker daemon cannot be reached', async () => {
    fake.list.mockRejectedValue(new DockerUnavailableError('The Docker daemon could not be reached (ENOENT)'));

    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));

    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.stop).not.toHaveBeenCalled();
  });

  it('runs the rest of the plan when one instance cannot be acted on', async () => {
    fake.held.set(KEY_A, buildObservedInstance({ instanceKey: KEY_A }));
    fake.stop.mockRejectedValueOnce(new Error('removal already in progress'));

    await reconcilerService.applyDesiredState(desiredState([desired(KEY_B)]));

    expect(fake.start).toHaveBeenCalledWith(expect.objectContaining({ instanceKey: KEY_B }), expect.anything());
  });

  it('stops the whole plan where the daemon goes away part way through it', async () => {
    fake.held.set(KEY_A, buildObservedInstance({ instanceKey: KEY_A }));
    fake.stop.mockRejectedValueOnce(new DockerUnavailableError('The Docker daemon could not be reached (ENOENT)'));

    await reconcilerService.applyDesiredState(desiredState([desired(KEY_B)]));

    expect(fake.start).not.toHaveBeenCalled();
  });

  it('reports as soon as an instance passes its readiness probe', async () => {
    await reconcilerService.applyDesiredState(desiredState([desired(KEY_A)]));

    reconcilerService.onModuleInit();
    fake.ready.next(KEY_A);

    await vi.waitFor(() => {
      expect(announced.length).toBeGreaterThan(1);
    });

    reconcilerService.onModuleDestroy();
  });

  describe('on its own', () => {
    let service: ReconcilerService;

    beforeEach(() => {
      vi.useFakeTimers();

      service = new ReconcilerService(configService, runtimeOf(fake), telemetryService);
    });

    afterEach(() => {
      service.onModuleDestroy();
      vi.useRealTimers();
    });

    it('converges on the timer, so drift is corrected without the server asking', async () => {
      const seen = listen(service);

      await service.applyDesiredState(desiredState([desired(KEY_A)]));
      service.onModuleInit();

      fake.held.delete(KEY_A);
      await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);

      expect(keysAnnounced(seen)).toEqual([KEY_A]);
    });
  });
});
