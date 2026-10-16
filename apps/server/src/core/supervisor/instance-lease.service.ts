import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { AgentRelay, InstanceState } from '@libs/agent-protocol';

import { Instance } from '../instance/entities/instance.entity';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { DeploymentService } from '../deployment/deployment.service';

import { ILease, IReadyInstance } from './supervisor.types';

interface IRoutable {
  instance: Instance;
  relay: AgentRelay;
}

/**
 * What each instance is carrying, and leasing one to a request. The one tally the supervisor reads to tell an idle
 * deployment from a busy one, and drains an instance through. Only the supervisor uses it.
 */
@Injectable()
export class InstanceLeaseService {
  private readonly logger = new Logger(InstanceLeaseService.name);

  /** By instance id. */
  private readonly inFlight = new Map<number, number>();

  /** By instance id. Nothing is leased from a draining instance. */
  private readonly draining = new Set<number>();

  private readonly drained = new Subject<number>();

  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly deploymentService: DeploymentService
  ) {}

  /** The deployment of each instance the last request left while it was draining, so a stop waiting on it goes ahead. */
  drainedChanges(): Observable<number> {
    return this.drained.asObservable();
  }

  /**
   * The ready instance with the fewest requests in flight on a node holding a live agent session, the first on a tie.
   * Stamps the deployment as used, which is what its idleness is counted from. Null where no ready node is reachable.
   */
  async lease(deploymentId: number, instances: Instance[]): Promise<ILease | null> {
    let chosen: IRoutable | null = null;

    for (const candidate of this.routable(instances)) {
      if (chosen === null || this.inFlightFor(candidate.instance.id) < this.inFlightFor(chosen.instance.id)) {
        chosen = candidate;
      }
    }

    if (chosen === null) {
      return null;
    }

    // Counted before the stamp is awaited, so a reconcile in between reads the instance as busy.
    const release = this.carry(deploymentId, chosen.instance.id);

    await this.stampLastUsed(deploymentId);

    return { instanceKey: chosen.instance.instanceKey, nodeId: chosen.instance.nodeId, relay: chosen.relay, release };
  }

  /** Chooses as `lease` would, but holds and stamps nothing. */
  reachable(instances: Instance[]): IReadyInstance | null {
    const first = this.routable(instances).at(0);

    if (first === undefined) {
      return null;
    }

    return {
      instanceKey: first.instance.instanceKey,
      relay: first.relay,
      configurationRevision: first.instance.configurationRevision,
    };
  }

  serving(instance: Instance): boolean {
    return instance.instanceState === InstanceState.READY && !this.draining.has(instance.id);
  }

  /** An instance starting on a node out of contact reports nothing more, so it holds no idle stop off. */
  startingOnLiveNode(instance: Instance): boolean {
    return (
      instance.instanceState === InstanceState.STARTING &&
      this.agentConnectionService.relayFor(instance.nodeId) !== null
    );
  }

  inFlightAcross(instances: Instance[]): number {
    return instances.reduce((total, instance) => total + this.inFlightFor(instance.id), 0);
  }

  /**
   * Marks the instances draining before reading their count, which closes the window between the two: nothing is
   * leased from a draining instance, so a request arriving now waits the stop out rather than being cut off by it.
   */
  quietOnceDraining(instances: Instance[]): boolean {
    for (const instance of instances) {
      this.draining.add(instance.id);
    }

    return this.inFlightAcross(instances) === 0;
  }

  stopDraining(instances: Instance[]): void {
    for (const instance of instances) {
      this.draining.delete(instance.id);
    }
  }

  /** Answers the release that drops the request, once however often it is called. */
  private carry(deploymentId: number, instanceId: number): () => void {
    this.inFlight.set(instanceId, this.inFlightFor(instanceId) + 1);

    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;

      const remaining = this.inFlightFor(instanceId) - 1;

      if (remaining > 0) {
        this.inFlight.set(instanceId, remaining);

        return;
      }

      this.inFlight.delete(instanceId);

      if (this.draining.has(instanceId)) {
        this.drained.next(deploymentId);
      }
    };
  }

  /** Bookkeeping for idleness, so a stamp that fails costs a coarser idle clock and not the request. */
  private async stampLastUsed(deploymentId: number): Promise<void> {
    try {
      await this.deploymentService.stampLastUsed(deploymentId);
    } catch (error: unknown) {
      this.logger.error({ error, deploymentId }, 'stampLastUsed(): Stamping a deployment as used failed');
    }
  }

  private routable(instances: Instance[]): IRoutable[] {
    return instances.flatMap(instance => {
      const relay = this.serving(instance) ? this.agentConnectionService.relayFor(instance.nodeId) : null;

      return relay === null ? [] : [{ instance, relay }];
    });
  }

  private inFlightFor(instanceId: number): number {
    return this.inFlight.get(instanceId) ?? 0;
  }
}
