import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, Subscription } from 'rxjs';

import { AgentObservedState, DesiredInstance, ServerDesiredState } from '@libs/agent-protocol';

import { ConfigService } from '../config/config.service';
import { DockerUnavailableError } from '../docker/api/errors';
import { InstanceRuntimeService } from '../instance/instance-runtime.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { IReconcilePlan, isEmptyPlan, planReconciliation } from './reconcile-plan';

/** The generation a server sends for a node it holds nothing for, which is not an instruction to remove anything. */
const UNRECORDED_GENERATION = 0;

@Injectable()
export class ReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcilerService.name);

  private readonly observed = new Subject<AgentObservedState>();

  private desiredInstances: readonly DesiredInstance[] = [];
  private desiredGeneration: number | null = null;

  private converging = false;
  private timer: NodeJS.Timeout | null = null;
  private subscription: Subscription | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly instanceRuntime: InstanceRuntimeService,
    private readonly telemetryService: TelemetryService
  ) {}

  /** An instance that dies on its own announces nothing, so the node is re-examined on a timer. */
  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.converge().catch((error: unknown) => {
        this.logger.error({ error }, 'onModuleInit(): A scheduled convergence failed');
      });
    }, this.configService.reconcileIntervalMs);

    this.timer.unref();

    this.subscription = this.instanceRuntime.changes().subscribe(instanceKey => {
      this.report().catch((error: unknown) => {
        this.logger.error({ error, instanceKey }, 'onModuleInit(): Reporting a ready instance failed');
      });
    });
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /** What the node holds, announced after every convergence and every report. */
  changes(): Observable<AgentObservedState> {
    return this.observed.asObservable();
  }

  async applyDesiredState(desiredState: ServerDesiredState): Promise<void> {
    this.desiredInstances = desiredState.instances;
    this.desiredGeneration = desiredState.generation;

    await this.converge();
  }

  async report(): Promise<void> {
    this.observed.next(await this.readNode());
  }

  /**
   * The next timer sweep picks up whatever this one skipped. An agent takes no action against a set the server
   * never recorded, so neither a restart out of contact with it nor a set it failed to build empties the node.
   */
  async converge(): Promise<void> {
    if (this.converging || this.desiredGeneration === null || this.desiredGeneration === UNRECORDED_GENERATION) {
      return;
    }

    this.converging = true;

    try {
      const actual = await this.instanceRuntime.list();

      await this.execute(planReconciliation(this.desiredInstances, actual));
      await this.report();
    } catch (error: unknown) {
      if (!(error instanceof DockerUnavailableError)) {
        throw error;
      }

      this.logger.error({ error }, 'converge(): The Docker daemon could not be reached, so the node was left alone');
    } finally {
      this.converging = false;
    }
  }

  private async readNode(): Promise<AgentObservedState> {
    return {
      desiredGeneration: this.desiredGeneration,
      instances: await this.instanceRuntime.list(),
    };
  }

  private async execute(plan: IReconcilePlan): Promise<void> {
    if (isEmptyPlan(plan)) {
      return;
    }

    this.logger.log(
      { start: plan.start.length, replace: plan.replace.length, stop: plan.stop.length },
      'execute(): Reconciling the node against desired state'
    );

    const gpuTotalBytes = this.gpuTotalBytes();

    for (const instanceKey of plan.stop) {
      await this.attempt(instanceKey, () => this.instanceRuntime.stop(instanceKey));
    }

    // A replacement stops first, releasing the old instance's resources for the new one.
    for (const instance of plan.replace) {
      await this.attempt(instance.instanceKey, async () => {
        await this.instanceRuntime.stop(instance.instanceKey);
        await this.instanceRuntime.start(instance, gpuTotalBytes);
      });
    }

    for (const instance of plan.start) {
      await this.attempt(instance.instanceKey, () => this.instanceRuntime.start(instance, gpuTotalBytes));
    }
  }

  private gpuTotalBytes(): Map<string, number> {
    const devices = this.telemetryService.currentInventory()?.devices ?? [];

    return new Map(
      devices.flatMap((device): [string, number][] =>
        device.memoryTotalBytes === null ? [] : [[device.deviceKey, device.memoryTotalBytes]]
      )
    );
  }

  /** One instance the node cannot act on leaves the rest of the plan to run, and is tried again next sweep. */
  private async attempt(instanceKey: string, act: () => Promise<void>): Promise<void> {
    try {
      await act();
    } catch (error: unknown) {
      if (error instanceof DockerUnavailableError) {
        throw error;
      }

      this.logger.error({ error, instanceKey }, 'execute(): Acting on one instance failed');
    }
  }
}
