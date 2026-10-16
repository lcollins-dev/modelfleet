import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subscription } from 'rxjs';
import { Repository } from 'typeorm';

import { DesiredInstance } from '@libs/agent-protocol';

import { Instance } from './entities/instance.entity';

import { DeploymentService } from '../deployment/deployment.service';
import { NodeStateService } from '../node/node-state.service';
import { InstanceLaunchService } from './instance-launch.service';

@Injectable()
export class InstanceDesiredStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstanceDesiredStateService.name);

  private readonly subscriptions: Subscription[] = [];

  private publishing: Promise<void> = Promise.resolve();

  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly instanceLaunchService: InstanceLaunchService,
    private readonly nodeStateService: NodeStateService,
    @InjectRepository(Instance) private readonly instanceRepository: Repository<Instance>
  ) {}

  /** Desired state lives in memory, so a restarted server rebuilds every node's set before any agent reconnects. */
  async onModuleInit(): Promise<void> {
    const instances = await this.instanceRepository.find({ select: ['nodeId'] });
    const nodeIds = new Set(instances.map(instance => instance.nodeId));

    for (const nodeId of nodeIds) {
      await this.publishQuietly(nodeId);
    }

    // A deleted deployment takes its instance rows with it, and a node not told would hold the containers forever.
    this.subscriptions.push(
      this.deploymentService.deploymentRemoved().subscribe(deploymentId => {
        this.publishAll().catch((error: unknown) => {
          this.logger.error({ error, deploymentId }, 'onModuleInit(): Republishing after a deletion failed');
        });
      })
    );
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions.length = 0;
  }

  /** Every node the server has ever published to, since a cascade leaves no row saying which held what. */
  async publishAll(): Promise<void> {
    const held = await this.instanceRepository.find({ select: ['nodeId'] });
    const nodeIds = new Set([...held.map(instance => instance.nodeId), ...this.nodeStateService.getPublishedNodeIds()]);

    for (const nodeId of nodeIds) {
      await this.publishQuietly(nodeId);
    }
  }

  /** One node the server cannot describe must not stop every other node being told what it holds. */
  private publishQuietly(nodeId: number): Promise<void> {
    return this.publish(nodeId).catch((error: unknown) => {
      this.logger.error({ error, nodeId }, 'publishQuietly(): Building a desired set failed');
    });
  }

  /**
   * Sends the node its whole set, which is what makes deleting a row remove the container. Runs one node at a time,
   * since two overlapping publishes each read the rows before the other committed and the later write would drop
   * whichever instance it could not yet see.
   */
  async publish(nodeId: number): Promise<void> {
    this.publishing = this.publishing.then(() => this.buildAndSend(nodeId));

    return this.publishing;
  }

  private async buildAndSend(nodeId: number): Promise<void> {
    const instances = await this.instanceRepository.find({
      where: { nodeId },
      relations: { deployment: { model: true, preset: true } },
      order: { instanceKey: 'ASC' },
    });

    const desired: DesiredInstance[] = [];

    for (const instance of instances) {
      const described = await this.describe(instance);

      if (described !== null) {
        desired.push(described);
      }
    }

    this.nodeStateService.setDesiredInstances(nodeId, desired);
  }

  /**
   * Only a refusal drops an instance, because leaving one out is the instruction to remove its container. Anything
   * else raises, so a transient fault leaves the node the set it already has rather than tearing down a healthy one.
   */
  private async describe(instance: Instance): Promise<DesiredInstance | null> {
    const deployment = instance.deployment;

    if (deployment === undefined) {
      throw new InternalServerErrorException();
    }

    try {
      return await this.instanceLaunchService.describe(instance, deployment);
    } catch (error: unknown) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      this.logger.warn(
        { error, instanceKey: instance.instanceKey },
        'describe(): An instance can no longer be described, so its node is not asked for it'
      );

      return null;
    }
  }
}
