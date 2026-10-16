import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { InstanceState } from '@libs/agent-protocol';

import { Deployment } from '../deployment/entities/deployment.entity';
import { Instance } from '../instance/entities/instance.entity';

import { DeploymentService, ILaunchFailureCount } from '../deployment/deployment.service';
import { InstanceService } from '../instance/instance.service';
import { DeploymentActionsService } from './deployment-actions.service';
import { InstanceLeaseService } from './instance-lease.service';
import { ISupervisorFacts, SupervisorAction, SupervisorPolicyService } from './supervisor-policy.service';
import { ConfigService } from '@/config/config.service';

import { AcquireRefusal, IAcquireOptions, IAcquireResult, IReadyInstance, IStartRefusal } from './supervisor.types';
import { WaitingRequests } from './waiting-requests';

const DISABLED_MESSAGE = 'This deployment is disabled. Enable it before starting an instance';

interface IRun {
  /** Something changed while this run was reconciling, so it reconciles once more before it ends. */
  again: boolean;

  done: Promise<void>;
}

/**
 * Decides what each deployment does next - start, stop or leave it - and answers the requests waiting on it. Every
 * change to a deployment reconciles it: a request waiting on it, a write to one of its instance rows, an edit, enable
 * or disable, the last request leaving a draining instance, and the periodic tick. One reconcile runs at a time per
 * deployment, so no two decisions about one deployment interleave.
 */
@Injectable()
export class DeploymentSupervisorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeploymentSupervisorService.name);

  private readonly waiting = new WaitingRequests();

  /** By deployment id. */
  private readonly runs = new Map<number, IRun>();

  private subscriptions: Subscription[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly deploymentActionsService: DeploymentActionsService,
    private readonly deploymentService: DeploymentService,
    private readonly instanceLeaseService: InstanceLeaseService,
    private readonly instanceService: InstanceService,
    private readonly supervisorPolicyService: SupervisorPolicyService
  ) {}

  onModuleInit(): void {
    this.subscriptions = [
      this.instanceService.instanceChanges().subscribe(deploymentIds => {
        for (const deploymentId of deploymentIds) {
          void this.reconcile(deploymentId);
        }
      }),
      this.deploymentService.deploymentChanged().subscribe(deploymentId => void this.reconcile(deploymentId)),
      this.instanceLeaseService.drainedChanges().subscribe(deploymentId => void this.reconcile(deploymentId)),
      this.deploymentService.deploymentRemoved().subscribe(deploymentId => this.forget(deploymentId)),
      this.deploymentService.launchFailureCounted().subscribe(count => void this.sayIfGivenUp(count)),
    ];
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions = [];
  }

  /**
   * Leases an instance to serve a request: at once where one is ready, or once one is, starting the deployment where
   * nothing is on its way. The caller leaving or waiting `maxWaitMs` ends only its own wait.
   */
  async acquire(deploymentId: number, options: IAcquireOptions): Promise<IAcquireResult> {
    if (options.signal.aborted) {
      return this.resultOf({ waitedMs: 0 });
    }

    const ready = await this.instanceService.findForRouting(deploymentId);

    if (ready.some(instance => this.instanceLeaseService.serving(instance))) {
      const lease = await this.instanceLeaseService.lease(deploymentId, ready);

      return lease === null
        ? this.notAvailable(deploymentId, 'acquire(): A ready instance is on a node out of contact')
        : this.resultOf({ lease });
    }

    return this.waiting.wait(deploymentId, options, () => this.reconcile(deploymentId));
  }

  /** Starts no instance and counts no use. */
  async findReady(deploymentId: number): Promise<IReadyInstance | null> {
    return this.instanceLeaseService.reachable(await this.instanceService.findForRouting(deploymentId));
  }

  /** One reconcile of every deployment, which the residency batch job runs every thirty seconds. */
  async pass(): Promise<void> {
    const deployments = await this.deploymentService.findAll();

    await Promise.all(deployments.map(deployment => this.reconcile(deployment.id)));
  }

  /**
   * Resolves once the deployment has settled, acting on no other. A call while a reconcile runs joins it and has it run
   * once more, so it sees what the caller changed. Never raises: a fault answers the deployment's waiters rather than
   * leaving them to time out.
   */
  reconcile(deploymentId: number): Promise<void> {
    const running = this.runs.get(deploymentId);

    if (running !== undefined) {
      running.again = true;

      return running.done;
    }

    const run: IRun = { again: false, done: Promise.resolve() };

    this.runs.set(deploymentId, run);
    run.done = this.runUntilSettled(deploymentId, run);

    return run.done;
  }

  /** The facts a reconcile decides on, which the deployment screen explains its residency from. */
  factsFor(deployment: Deployment, instances: Instance[]): ISupervisorFacts {
    const configuration = this.deploymentService.resolveConfiguration(deployment).configuration;
    const newest = instances.map(instance => (instance.readyDate ?? instance.createdDate).getTime());

    return {
      activationPolicy: deployment.activationPolicy,
      enabled: deployment.enabled,
      resident: instances.length,
      live: instances.filter(instance => this.live(instance)).length,
      starting: instances.filter(instance => this.instanceLeaseService.startingOnLiveNode(instance)).length,
      inFlight: this.instanceLeaseService.inFlightAcross(instances),
      waiting: this.waiting.open(deployment.id).length,
      idleTimeoutMs: this.supervisorPolicyService.idleTimeoutMsFor(
        configuration,
        this.configService.schedulerIdleTimeoutMs
      ),
      idleSince: this.supervisorPolicyService.idleSince(
        deployment.lastUsedDate,
        newest.length === 0 ? null : new Date(Math.max(...newest))
      ),
      backoffUntil: this.supervisorPolicyService.backoffUntil(
        deployment.launchFailures,
        deployment.lastLaunchFailureDate
      ),
      givenUp: this.supervisorPolicyService.givenUp(
        deployment.launchFailures,
        this.configService.schedulerLaunchFailureLimit
      ),
      now: new Date(),
    };
  }

  private async runUntilSettled(deploymentId: number, run: IRun): Promise<void> {
    try {
      do {
        run.again = false;

        try {
          await this.reconcileNow(deploymentId);
        } catch (error: unknown) {
          this.logger.error({ error, deploymentId }, 'runUntilSettled(): Reconciling a deployment failed');

          this.waiting.settleAll(deploymentId, this.resultOf({ refusal: AcquireRefusal.NOT_AVAILABLE }));
        }
      } while (this.dueAgain(run));
    } finally {
      this.runs.delete(deploymentId);
    }
  }

  /** Read through a call, since a change announced during the last reconcile set it after the loop read it. */
  private dueAgain(run: IRun): boolean {
    return run.again;
  }

  private async reconcileNow(deploymentId: number): Promise<void> {
    // Rows first: a failure is recorded on the deployment before its row moves, so a failed row read here has its
    // failure on the deployment read next.
    const instances = await this.instanceService.findByDeploymentId(deploymentId);
    const deployment = await this.findDeployment(deploymentId);

    if (deployment === null) {
      this.forget(deploymentId);

      return;
    }

    const facts = this.factsFor(deployment, instances);
    const action = this.supervisorPolicyService.decide(facts);
    let refused: IStartRefusal | null = null;

    switch (action) {
      case SupervisorAction.START:
        this.instanceLeaseService.stopDraining(instances);
        refused = await this.deploymentActionsService.start(deployment, instances, facts.live);
        break;

      case SupervisorAction.BACK_OFF:
      case SupervisorAction.GIVEN_UP:
      case SupervisorAction.NONE:
        this.instanceLeaseService.stopDraining(instances);
        break;

      case SupervisorAction.STOP_IDLE:
        // A request arriving mid-stop is answered by the reconcile the stop's own write sets off, from fresh rows.
        await this.stopIdle(instances, facts);

        return;

      case SupervisorAction.STOP_DISABLED:
        await this.stopDisabled(instances);
        break;
    }

    await this.answerWaiters(deployment, instances, facts, action === SupervisorAction.START, refused);
  }

  /**
   * Leases a ready instance to each waiter where there is one. Where nothing is live, a waiter is refused with the
   * failure recorded since it began waiting, the start that was refused, or the backoff holding a start off; otherwise
   * it waits on, for the instance starting or the start the next change makes.
   */
  private async answerWaiters(
    deployment: Deployment,
    instances: Instance[],
    facts: ISupervisorFacts,
    started: boolean,
    refused: IStartRefusal | null
  ): Promise<void> {
    const waiters = this.waiting.open(deployment.id);

    if (waiters.length === 0) {
      return;
    }

    if (!deployment.enabled) {
      this.waiting.settleAll(
        deployment.id,
        this.resultOf({ refusal: AcquireRefusal.CANNOT_START, problem: DISABLED_MESSAGE })
      );

      return;
    }

    if (instances.some(instance => this.instanceLeaseService.serving(instance))) {
      for (const waiter of waiters) {
        const lease = await this.instanceLeaseService.lease(deployment.id, instances);

        if (lease === null) {
          waiter.settle(
            this.notAvailable(deployment.id, 'answerWaiters(): A ready instance is on a node out of contact')
          );
        } else if (!waiter.settle(this.resultOf({ lease }))) {
          lease.release();
        }
      }

      return;
    }

    if ((facts.live > 0 || started) && refused === null) {
      return;
    }

    for (const waiter of waiters) {
      const failure = this.failureSince(deployment, waiter.since);

      if (failure !== null) {
        waiter.settle(failure);
      } else if (refused !== null) {
        waiter.settle(this.resultOf(refused));
      } else if (facts.givenUp) {
        waiter.settle(this.resultOf({ refusal: AcquireRefusal.GIVEN_UP, problem: deployment.lastLaunchFailure }));
      } else if (this.supervisorPolicyService.backingOff(facts)) {
        waiter.settle(
          this.resultOf({
            refusal: AcquireRefusal.BACKING_OFF,
            problem: deployment.lastLaunchFailure,
            retryInMs: (facts.backoffUntil?.getTime() ?? 0) - facts.now.getTime(),
          })
        );
      }
    }
  }

  /**
   * Said on the failed start that ends the run rather than on a reconcile finding it ended, so it is said once however
   * often the deployment is reconciled or the server restarted.
   */
  private async sayIfGivenUp(count: ILaunchFailureCount): Promise<void> {
    if (this.supervisorPolicyService.givesUpAt(count.launchFailures, this.configService.schedulerLaunchFailureLimit)) {
      await this.deploymentActionsService.sayGivenUp(count);
    }
  }

  /** Starting or ready, as opposed to failed or starting on a node out of contact, which will report nothing more. */
  private live(instance: Instance): boolean {
    return instance.instanceState === InstanceState.READY || this.instanceLeaseService.startingOnLiveNode(instance);
  }

  /** A failure is recorded before its row is written, so a waiter finding nothing live reads it here first. */
  private failureSince(deployment: Deployment, since: Date): IAcquireResult | null {
    const failed = deployment.lastLaunchFailureDate;

    return failed !== null && failed >= since
      ? this.resultOf({ refusal: AcquireRefusal.FAILED, problem: deployment.lastLaunchFailure })
      : null;
  }

  /** A request already in flight abandons an idle stop, since a deployment being called is not idle. */
  private async stopIdle(instances: Instance[], facts: ISupervisorFacts): Promise<void> {
    if (!this.instanceLeaseService.quietOnceDraining(instances)) {
      this.instanceLeaseService.stopDraining(instances);

      return;
    }

    const idleFor = facts.idleSince === null ? 0 : this.supervisorPolicyService.idleFor(facts.idleSince, facts.now);

    try {
      await this.deploymentActionsService.stopIdle(instances, idleFor);
    } finally {
      this.instanceLeaseService.stopDraining(instances);
    }
  }

  /** The drain holds until the last request finishes, since a disabled deployment is not to be served. */
  private async stopDisabled(instances: Instance[]): Promise<void> {
    if (!this.instanceLeaseService.quietOnceDraining(instances)) {
      return;
    }

    await this.deploymentActionsService.stopDisabled(instances);

    this.instanceLeaseService.stopDraining(instances);
  }

  /** Lets go of a deployment that has gone, answering whoever still waits on it. */
  private forget(deploymentId: number): void {
    this.waiting.settleAll(deploymentId, this.resultOf({ refusal: AcquireRefusal.NOT_AVAILABLE }));
    this.deploymentActionsService.forget(deploymentId);
  }

  private async findDeployment(deploymentId: number): Promise<Deployment | null> {
    try {
      return await this.deploymentService.findWithThrow(deploymentId);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  /** Logged rather than told, since a node out of contact is nothing the caller can act on. */
  private notAvailable(deploymentId: number, message: string): IAcquireResult {
    this.logger.warn({ deploymentId }, message);

    return this.resultOf({ refusal: AcquireRefusal.NOT_AVAILABLE });
  }

  private resultOf(fields: Partial<IAcquireResult>): IAcquireResult {
    return { lease: null, refusal: null, problem: null, retryInMs: null, waitedMs: null, ...fields };
  }
}
