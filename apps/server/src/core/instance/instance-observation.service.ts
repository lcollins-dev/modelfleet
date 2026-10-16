import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { concatMap, groupBy, mergeMap, Subscription } from 'rxjs';
import { Repository } from 'typeorm';

import { InstanceState, ObservedInstance } from '@libs/agent-protocol';
import { InstanceChangeReason } from '@libs/dto';

import { Instance } from './entities/instance.entity';

import { DeploymentService } from '../deployment/deployment.service';
import { NodeStateService } from '../node/node-state.service';
import { InstanceService } from './instance.service';

const OVERRAN_NOTE = ' because its launch overran its timeout';

@Injectable()
export class InstanceObservationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstanceObservationService.name);

  private subscription: Subscription | null = null;

  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly nodeStateService: NodeStateService,
    private readonly instanceService: InstanceService,
    @InjectRepository(Instance) private readonly instanceRepository: Repository<Instance>
  ) {}

  onModuleInit(): void {
    // Reports for one node are recorded in the order they arrived, so an older one cannot overwrite a newer.
    this.subscription = this.nodeStateService
      .getObservedReports()
      .pipe(
        groupBy(nodeId => nodeId),
        mergeMap(byNode => byNode.pipe(concatMap(nodeId => this.recorded(nodeId))))
      )
      .subscribe();
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  private recorded(nodeId: number): Promise<void> {
    return this.record(nodeId).catch((error: unknown) => {
      this.logger.error({ error, nodeId }, "recorded(): Recording a node's report against its instances failed");
    });
  }

  /** An instance the node reports and the server holds no row for is one it is about to remove, so none is created. */
  private async record(nodeId: number): Promise<void> {
    const observed = this.nodeStateService.getObserved(nodeId);

    if (observed === null) {
      return;
    }

    const instances = await this.instanceRepository.find({ where: { nodeId } });
    const reported = new Map(observed.instances.map(instance => [instance.instanceKey, instance]));

    const moved = new Set<number>();

    for (const instance of instances) {
      const report = reported.get(instance.instanceKey);

      if (report !== undefined && this.hasMoved(instance, report)) {
        // Counted before the state is written, so whatever reads the failed row reads the backoff it set.
        await this.recordLaunchOutcome(instance, report, observed.reportedDate);
        await this.instanceRepository.update(
          { id: instance.id },
          this.observationOf(instance, report, observed.reportedDate)
        );

        moved.add(instance.deploymentId);
      }
    }

    if (moved.size > 0) {
      this.instanceService.announceChanged([...moved]);
    }

    await this.stopOverrun(nodeId, observed.instances);
  }

  private async stopOverrun(nodeId: number, reports: ObservedInstance[]): Promise<void> {
    const overran = new Set(reports.filter(report => report.overran === true).map(report => report.instanceKey));

    if (overran.size === 0) {
      return;
    }

    const instances = await this.instanceService.findByNodeId(nodeId);

    await this.instanceService.takeDown(
      instances.filter(instance => overran.has(instance.instanceKey)),
      { actorId: null, reason: InstanceChangeReason.LAUNCH_OVERRAN, note: OVERRAN_NOTE }
    );
  }

  /** The first report of ready is stamped, since that is what the deployment's idleness is counted from. */
  private observationOf(instance: Instance, report: ObservedInstance, reportedDate: Date): Partial<Instance> {
    const ready = instance.readyDate === null && report.instanceState === InstanceState.READY;

    return {
      instanceState: report.instanceState,
      message: report.message,
      exitCode: report.exitCode,
      reportedDate,
      ...(ready ? { readyDate: reportedDate } : {}),
    };
  }

  /** Keeps the deployment's run of failed launches, which its backoff is counted from, on the move into each state. */
  private async recordLaunchOutcome(instance: Instance, report: ObservedInstance, reportedDate: Date): Promise<void> {
    if (instance.instanceState === report.instanceState) {
      return;
    }

    if (report.instanceState === InstanceState.READY) {
      await this.deploymentService.clearLaunchFailures(instance.deploymentId);
    }

    if (instance.instanceState === InstanceState.STARTING && report.instanceState === InstanceState.FAILED) {
      await this.deploymentService.recordLaunchFailure(
        instance.deploymentId,
        instance.createdDate,
        reportedDate,
        report.message
      );
    }
  }

  /** A node reports on every convergence, so a row is only written where something about the instance changed. */
  private hasMoved(instance: Instance, report: ObservedInstance): boolean {
    return (
      instance.instanceState !== report.instanceState ||
      instance.message !== report.message ||
      instance.exitCode !== report.exitCode
    );
  }
}
