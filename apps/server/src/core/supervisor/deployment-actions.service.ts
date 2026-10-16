import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ms from 'ms';

import { InstanceState } from '@libs/agent-protocol';
import { ActivationPolicy, EventPartyType, EventSeverity, EventType, InstanceChangeReason } from '@libs/dto';

import { Deployment } from '../deployment/entities/deployment.entity';
import { Instance } from '../instance/entities/instance.entity';

import { ILaunchFailureCount } from '../deployment/deployment.service';
import { EventService } from '../event/event.service';
import { InstanceAdmissionService } from '../instance/instance-admission.service';
import { INodePlacement } from '../instance/instance-launch.service';
import { InstanceService } from '../instance/instance.service';
import { NodeService } from '../node/node.service';

import { AcquireRefusal, IStartRefusal } from './supervisor.types';

const KEEPING_RESIDENT_NOTE = ' to keep it resident';
const SERVE_REQUEST_NOTE = ' to serve a request';
const REPLACING_FAILED_NOTE = ' because its container failed';
const DISABLED_NOTE = ' because the deployment is disabled';

/**
 * What the deployment supervisor does once it has decided: the rows it writes to start and stop a deployment, and the
 * event log's account of a start it could not make. It decides nothing.
 */
@Injectable()
export class DeploymentActionsService {
  /** The last start refusal recorded for each deployment, so one standing constraint is recorded once. */
  private readonly refusals = new Map<number, string>();

  private readonly logger = new Logger(DeploymentActionsService.name);

  constructor(
    private readonly eventService: EventService,
    private readonly instanceAdmissionService: InstanceAdmissionService,
    private readonly instanceService: InstanceService,
    private readonly nodeService: NodeService
  ) {}

  /**
   * Drops the failed instances first, so a replacement is created against a node that is short again, then brings the
   * deployment up. Null where something started, or `live` says something was already starting or ready.
   */
  async start(deployment: Deployment, instances: Instance[], live: number): Promise<IStartRefusal | null> {
    const always = deployment.activationPolicy === ActivationPolicy.ALWAYS;
    const failed = instances.filter(instance => instance.instanceState === InstanceState.FAILED);

    await this.instanceService.takeDown(failed, {
      actorId: null,
      reason: InstanceChangeReason.INSTANCE_FAILED,
      note: REPLACING_FAILED_NOTE,
    });

    try {
      const outcome = await this.instanceService.bringUp(deployment.id, {
        actorId: null,
        reason: always ? InstanceChangeReason.ALWAYS_POLICY : InstanceChangeReason.ON_REQUEST,
        note: always ? KEEPING_RESIDENT_NOTE : SERVE_REQUEST_NOTE,
      });

      await this.sayRefused(deployment, await this.describeRefusals(outcome.refused), outcome.refused);

      // Nothing refused means every node already holds its share, as when a start by hand got there first.
      return outcome.started.length === 0 && live === 0 && outcome.refused.length > 0
        ? this.refusalOf(outcome.refused)
        : null;
    } catch (error: unknown) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      await this.sayRefused(deployment, error.message);

      return { refusal: AcquireRefusal.CANNOT_START, problem: error.message };
    }
  }

  /** A refusal for capacity on any node outweighs the rest, since memory freeing is what would change the answer. */
  private refusalOf(refused: INodePlacement[]): IStartRefusal {
    const problems = new Set(refused.map(placement => placement.problem ?? '').filter(problem => problem.length > 0));

    return {
      refusal: refused.some(placement => placement.capacity !== undefined)
        ? AcquireRefusal.DOES_NOT_FIT
        : AcquireRefusal.CANNOT_START,
      problem: problems.size === 0 ? null : [...problems].join('. '),
    };
  }

  async stopIdle(instances: Instance[], idleForMs: number): Promise<void> {
    await this.instanceService.takeDown(instances, {
      actorId: null,
      reason: InstanceChangeReason.IDLE_TIMEOUT,
      note: ` after ${ms(idleForMs)} idle`,
    });
  }

  async stopDisabled(instances: Instance[]): Promise<void> {
    await this.instanceService.takeDown(instances, {
      actorId: null,
      reason: InstanceChangeReason.DEPLOYMENT_DISABLED,
      note: DISABLED_NOTE,
    });
  }

  /** The event is the log's account of giving up, so failing to write it costs the account and not the reconcile. */
  async sayGivenUp(count: ILaunchFailureCount): Promise<void> {
    try {
      await this.eventService.recordEvent(EventType.DEPLOYMENT_GIVEN_UP, EventSeverity.ERROR, {
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${count.deploymentId}`,
        message: `Gave up on **${count.name}** after ${count.launchFailures} failed starts in a row`,
        detail: {
          name: count.name,
          launchFailures: count.launchFailures,
          ...(count.output === null ? {} : { output: count.output }),
        },
      });
    } catch (error: unknown) {
      this.logger.error({ error, deploymentId: count.deploymentId }, 'sayGivenUp(): Recording a give-up failed');
    }
  }

  forget(deploymentId: number): void {
    this.refusals.delete(deploymentId);
  }

  private async describeRefusals(refused: INodePlacement[]): Promise<string> {
    const described: string[] = [];

    for (const refusal of refused) {
      const node = await this.nodeService.find(refusal.nodeId);

      described.push(`${node?.name ?? refusal.nodeId}: ${refusal.problem ?? ''}`);
    }

    return described.join('; ');
  }

  /**
   * Records a refusal once, and again only when the constraint changes, so one reconciled on every change says it
   * once. The figures are those of the first node refused for capacity.
   */
  private async sayRefused(deployment: Deployment, problem: string, refused: INodePlacement[] = []): Promise<void> {
    if (problem.length === 0) {
      this.refusals.delete(deployment.id);

      return;
    }

    if (this.refusals.get(deployment.id) === problem) {
      return;
    }

    this.refusals.set(deployment.id, problem);

    // The event is the log's account of the refusal, so failing to write it costs the account and not the start.
    try {
      await this.eventService.recordEvent(EventType.INSTANCE_START_REFUSED, EventSeverity.WARNING, {
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${deployment.id}`,
        message: `Left **${deployment.name}** alone, which cannot be started where it is placed`,
        detail: { name: deployment.name, problem, ...(await this.capacityDetail(refused)) },
      });
    } catch (error: unknown) {
      this.logger.error({ error, deploymentId: deployment.id }, 'sayRefused(): Recording a start refusal failed');
    }
  }

  private async capacityDetail(refused: INodePlacement[]): Promise<Record<string, string | number>> {
    const first = refused.find(placement => placement.capacity !== undefined);

    if (first?.capacity === undefined) {
      return {};
    }

    const node = await this.nodeService.find(first.nodeId);

    return {
      nodeName: node?.name ?? `${first.nodeId}`,
      ...this.instanceAdmissionService.capacityDetail(first.capacity),
    };
  }
}
