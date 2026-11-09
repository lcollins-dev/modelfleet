import { Injectable, Logger } from '@nestjs/common';
import ms from 'ms';

import { EventPartyType, EventSeverity, EventType, InstanceChangeReason } from '@libs/dto';

import { Deployment } from '../deployment/entities/deployment.entity';
import { Instance } from '../instance/entities/instance.entity';

import { EventService } from '../event/event.service';
import { InstanceAdmissionService } from '../instance/instance-admission.service';
import { IPlannedEviction } from '../instance/instance-launch.service';
import { InstanceService } from '../instance/instance.service';
import { IEvictionPlan } from './eviction-planner.service';
import { InstanceLeaseService } from './instance-lease.service';

const SWAPS_TO_WARN = 3;
const SWAP_WINDOW_MS = 30 * 60_000;

interface IEviction {
  plan: IEvictionPlan;
  victim: IPlannedEviction;
  requester: Deployment;

  /** Set before the stop is awaited, so a reconcile arriving meanwhile cannot stop it twice. */
  stopping: boolean;
}

interface ISwapHistory {
  dates: number[];
  warnedAt: number | null;

  /** One start evicting two of a deployment's instances is one swap. */
  lastPlan: IEvictionPlan | null;
}

@Injectable()
export class InstanceEvictionService {
  private readonly logger = new Logger(InstanceEvictionService.name);

  /** By the victim's instance id. */
  private readonly evictions = new Map<number, IEviction>();

  /** By the pair's deployment ids, smallest first, so a swap in either direction counts the same. */
  private readonly swaps = new Map<string, ISwapHistory>();

  constructor(
    private readonly eventService: EventService,
    private readonly instanceAdmissionService: InstanceAdmissionService,
    private readonly instanceLeaseService: InstanceLeaseService,
    private readonly instanceService: InstanceService
  ) {}

  /** False where a victim is already draining, so no other plan can share one. */
  claim(plan: IEvictionPlan, requester: Deployment): boolean {
    const instances = plan.victims.map(victim => victim.instance);

    if (!this.instanceLeaseService.claim(instances)) {
      return false;
    }

    for (const victim of plan.victims) {
      this.evictions.set(victim.instance.id, { plan, victim, requester, stopping: false });
    }

    return true;
  }

  /** Stops each claimed instance with nothing in flight. True where one was stopped, whose row has now gone. */
  async stopDrained(instances: Instance[]): Promise<boolean> {
    const quiet = instances.filter(instance => this.isQuietAndUnstopped(instance));

    for (const instance of quiet) {
      await this.stop(instance);
    }

    return quiet.length > 0;
  }

  private isQuietAndUnstopped(instance: Instance): boolean {
    const eviction = this.evictions.get(instance.id);

    return eviction !== undefined && !eviction.stopping && this.instanceLeaseService.inFlightOn(instance) === 0;
  }

  /** Puts back into service whatever this deployment claimed and has not stopped yet. */
  abandon(requesterId: number): void {
    for (const [instanceId, eviction] of this.evictions) {
      if (eviction.requester.id === requesterId && !eviction.stopping) {
        this.instanceLeaseService.releaseClaim([eviction.victim.instance]);
        this.evictions.delete(instanceId);
      }
    }
  }

  /** Puts back into service the victims of plans that lost to another for the same requester. */
  releasePlans(plans: IEvictionPlan[]): void {
    for (const victim of plans.flatMap(plan => plan.victims)) {
      this.instanceLeaseService.releaseClaim([victim.instance]);
      this.evictions.delete(victim.instance.id);
    }
  }

  forget(deploymentId: number): void {
    this.abandon(deploymentId);

    for (const key of this.swaps.keys()) {
      if (key.split(':').includes(`${deploymentId}`)) {
        this.swaps.delete(key);
      }
    }
  }

  private async stop(instance: Instance): Promise<void> {
    const eviction = this.evictions.get(instance.id);

    if (eviction === undefined || eviction.stopping) {
      return;
    }

    eviction.stopping = true;

    const { victim, requester, plan } = eviction;

    try {
      await this.instanceService.takeDown([instance], {
        actorId: null,
        reason: InstanceChangeReason.EVICTED,
        note: ` to make room for **${requester.name}** after ${ms(victim.idleMs)} idle`,
        detail: {
          evictedFor: requester.name,
          idleMs: victim.idleMs,
          releasedBytes: victim.releasedBytes,
          ...this.instanceAdmissionService.capacityDetail(plan.refused),
        },
      });

      await this.countSwap(eviction);
    } catch (error: unknown) {
      this.logger.error({ error, instanceKey: instance.instanceKey }, 'stop(): Evicting an instance failed');
    } finally {
      this.instanceLeaseService.releaseClaim([instance]);
      this.evictions.delete(instance.id);
    }
  }

  private async countSwap(eviction: IEviction): Promise<void> {
    const { requester, victim, plan } = eviction;
    const victimDeployment = victim.instance.deployment;
    const key = [requester.id, victim.instance.deploymentId].sort((left, right) => left - right).join(':');
    const now = Date.now();

    const history = this.swaps.get(key) ?? { dates: [], warnedAt: null, lastPlan: null };

    this.swaps.set(key, history);

    if (history.lastPlan === plan) {
      return;
    }

    history.lastPlan = plan;
    history.dates = [...history.dates.filter(date => now - date <= SWAP_WINDOW_MS), now];

    const warnedRecently = history.warnedAt !== null && now - history.warnedAt < SWAP_WINDOW_MS;

    if (history.dates.length < SWAPS_TO_WARN || warnedRecently || victimDeployment === undefined) {
      return;
    }

    history.warnedAt = now;

    await this.saySwapping(requester, victimDeployment, history.dates.length);
  }

  private async saySwapping(first: Deployment, second: Deployment, swaps: number): Promise<void> {
    try {
      await this.eventService.recordEvent(EventType.DEPLOYMENT_SWAPPING, EventSeverity.WARNING, {
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${first.id}`,
        message:
          `**${first.name}** and **${second.name}** have evicted each other ${swaps} times in ` +
          `${ms(SWAP_WINDOW_MS)}. Raise \`SCHEDULER_MIN_RESIDENCY\` or give them separate cards`,
        detail: { name: first.name, otherName: second.name, swaps, windowMs: SWAP_WINDOW_MS },
      });
    } catch (error: unknown) {
      this.logger.error({ error, deploymentId: first.id }, 'saySwapping(): Recording a swap warning failed');
    }
  }
}
