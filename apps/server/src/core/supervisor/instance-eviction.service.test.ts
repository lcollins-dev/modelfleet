import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GIB, LaunchMode } from '@libs/backends';
import { EventSeverity, EventType, InstanceChangeReason } from '@libs/dto';

import { Instance } from '@/core/instance/entities/instance.entity';

import { EventService } from '@/core/event/event.service';
import { InstanceAdmissionService } from '@/core/instance/instance-admission.service';
import { InstanceService } from '@/core/instance/instance.service';
import { FitRefusal, IFitReport } from '@/core/ledger/vram-ledger.service';
import { IEvictionPlan } from '@/core/supervisor/eviction-planner.service';
import { InstanceEvictionService } from '@/core/supervisor/instance-eviction.service';
import { InstanceLeaseService } from '@/core/supervisor/instance-lease.service';

import { buildDeployment } from '@/test/deployment.factory';
import { buildInstance } from '@/test/instance.factory';

const REFUSED: IFitReport = {
  launchMode: LaunchMode.GPU_ONLY,
  expectedBytes: 20 * GIB,
  cards: [],
  hostFreeBytes: null,
  availableBytes: 5 * GIB,
  hostWeights: null,
  shortCard: null,
  refusal: FitRefusal.TOO_LARGE,
};

describe('InstanceEvictionService', () => {
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let instanceService: { takeDown: ReturnType<typeof vi.fn> };
  let lease: InstanceLeaseService;
  let eviction: InstanceEvictionService;

  const requester = buildDeployment({ id: 1, name: 'llama' });
  const victimDeployment = buildDeployment({ id: 2, name: 'mistral' });

  const victim = (id: number): Instance =>
    buildInstance({ id, instanceKey: `key-${id}`, deploymentId: victimDeployment.id, deployment: victimDeployment });

  const planOf = (...instances: Instance[]): IEvictionPlan => ({
    victims: instances.map(instance => ({ instance, idleMs: 60_000, releasedBytes: 8 * GIB })),
    refused: REFUSED,
  });

  beforeEach(() => {
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    instanceService = { takeDown: vi.fn().mockResolvedValue(undefined) };
    lease = new InstanceLeaseService(
      { relayFor: vi.fn().mockReturnValue(null) } as never,
      { stampLastUsed: vi.fn() } as never
    );
    eviction = new InstanceEvictionService(
      eventService as unknown as EventService,
      { capacityDetail: vi.fn().mockReturnValue({ expectedBytes: 20 * GIB }) } as unknown as InstanceAdmissionService,
      lease,
      instanceService as unknown as InstanceService
    );
  });

  it('claims every victim, so a second plan cannot take one', () => {
    const instance = victim(1);

    expect(eviction.claim(planOf(instance), requester)).toBe(true);
    expect(eviction.claim(planOf(instance), requester)).toBe(false);
  });

  it('stops a quiet victim, recording the instance, what took its place, the idle time and the VRAM', async () => {
    const instance = victim(1);

    eviction.claim(planOf(instance), requester);

    await expect(eviction.stopDrained([instance])).resolves.toBe(true);

    expect(instanceService.takeDown).toHaveBeenCalledWith(
      [instance],
      expect.objectContaining({
        reason: InstanceChangeReason.EVICTED,
        detail: expect.objectContaining({ evictedFor: 'llama', idleMs: 60_000, releasedBytes: 8 * GIB }) as object,
      })
    );
    expect(lease.isDraining(instance)).toBe(false);
  });

  it('waits for a request in flight before stopping', async () => {
    const instance = victim(1);

    vi.spyOn(lease, 'inFlightOn').mockReturnValue(1);
    eviction.claim(planOf(instance), requester);

    await expect(eviction.stopDrained([instance])).resolves.toBe(false);
    expect(instanceService.takeDown).not.toHaveBeenCalled();
    expect(lease.isDraining(instance)).toBe(true);
  });

  it('puts an unstopped victim back into service when the requester abandons it', () => {
    const instance = victim(1);

    eviction.claim(planOf(instance), requester);
    eviction.abandon(requester.id);

    expect(lease.isClaimed(instance)).toBe(false);
    expect(lease.isDraining(instance)).toBe(false);
  });

  it('lets go of a losing plan without touching a winner claimed for the same requester', () => {
    const winner = victim(1);
    const loser = victim(2);

    eviction.claim(planOf(winner), requester);

    const losing = planOf(loser);

    eviction.claim(losing, requester);
    eviction.releasePlans([losing]);

    expect(lease.isClaimed(winner)).toBe(true);
    expect(lease.isClaimed(loser)).toBe(false);
  });

  it('stops a claimed instance once however often it is reconciled', async () => {
    const instance = victim(1);
    let stopped: () => void = () => undefined;

    instanceService.takeDown.mockReturnValue(
      new Promise<void>(resolve => {
        stopped = resolve;
      })
    );
    eviction.claim(planOf(instance), requester);

    const first = eviction.stopDrained([instance]);

    await eviction.stopDrained([instance]);
    stopped();
    await first;

    expect(instanceService.takeDown).toHaveBeenCalledTimes(1);
  });

  describe('swaps', () => {
    const swap = async (id: number) => {
      const instance = victim(id);

      eviction.claim(planOf(instance), requester);
      await eviction.stopDrained([instance]);
    };

    it('warns once naming both, after three swaps inside the window', async () => {
      await swap(1);
      await swap(2);
      expect(eventService.recordEvent).not.toHaveBeenCalled();

      await swap(3);
      await swap(4);

      expect(eventService.recordEvent).toHaveBeenCalledTimes(1);
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.DEPLOYMENT_SWAPPING,
        EventSeverity.WARNING,
        expect.objectContaining({
          message: expect.stringContaining('**mistral**') as string,
          detail: expect.objectContaining({ name: 'llama', otherName: 'mistral', swaps: 3 }) as object,
        })
      );
    });

    it('does not suggest pinning, since these deployments are already pinned', async () => {
      await swap(1);
      await swap(2);
      await swap(3);

      const [, , fields] = eventService.recordEvent.mock.calls[0] as [unknown, unknown, { message: string }];

      expect(fields.message).toContain('SCHEDULER_MIN_RESIDENCY');
      expect(fields.message.toLowerCase()).not.toContain('pin');
    });

    it('warns again once the window has passed', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-20T12:00:00Z') });

      await swap(1);
      await swap(2);
      await swap(3);

      vi.setSystemTime(new Date('2026-10-20T13:00:00Z'));

      await swap(4);
      await swap(5);
      await swap(6);

      expect(eventService.recordEvent).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('counts one start evicting two of a deployment once', async () => {
      const first = victim(1);
      const second = victim(2);

      eviction.claim(planOf(first, second), requester);
      await eviction.stopDrained([first, second]);
      await swap(3);
      expect(eventService.recordEvent).not.toHaveBeenCalled();

      await swap(4);
      expect(eventService.recordEvent).toHaveBeenCalledTimes(1);
    });
  });
});
