import { Injectable } from '@nestjs/common';

import { InstanceState } from '@libs/agent-protocol';
import { IInstancePins } from '@libs/backends';
import { ActivationPolicy } from '@libs/dto';

import { Deployment } from '../deployment/entities/deployment.entity';
import { Instance } from '../instance/entities/instance.entity';

import { InstanceAdmissionService } from '../instance/instance-admission.service';
import { INodePlacement, IPlannedEviction } from '../instance/instance-launch.service';
import { InstanceService } from '../instance/instance.service';
import { FitRefusal, ICardFigures, IFitReport, VramLedgerService } from '../ledger/vram-ledger.service';
import { InstanceLeaseService } from './instance-lease.service';
import { SupervisorPolicyService } from './supervisor-policy.service';
import { ConfigService } from '@/config/config.service';

const EVICTABLE_REFUSALS: ReadonlySet<FitRefusal> = new Set([
  FitRefusal.TOO_LARGE,
  FitRefusal.CARD_TOO_SMALL,
  FitRefusal.HOST_MEMORY,
]);

export interface IEvictionFacts {
  instance: Instance;
  activationPolicy: ActivationPolicy;
  ready: boolean;
  draining: boolean;
  inFlight: number;
  waiting: number;
  readyDate: Date | null;
  idleSince: Date | null;
}

export interface IEvictionPlan {
  victims: IPlannedEviction[];

  refused: IFitReport;
}

@Injectable()
export class EvictionPlannerService {
  constructor(
    private readonly configService: ConfigService,
    private readonly instanceAdmissionService: InstanceAdmissionService,
    private readonly instanceLeaseService: InstanceLeaseService,
    private readonly instanceService: InstanceService,
    private readonly supervisorPolicyService: SupervisorPolicyService,
    private readonly vramLedgerService: VramLedgerService
  ) {}

  /** Null where the refusal is not for capacity, or the plan never fits. */
  async plan(
    deployment: Deployment,
    placement: INodePlacement,
    waitingOn: (deploymentId: number) => number
  ): Promise<IEvictionPlan | null> {
    const refused = placement.capacity;

    if (refused === undefined || refused.refusal === null || !EVICTABLE_REFUSALS.has(refused.refusal)) {
      return null;
    }

    const now = new Date();
    const fleet = await this.instanceService.findAll();

    const onNode = fleet.filter(
      instance => instance.nodeId === placement.nodeId && instance.deploymentId !== deployment.id
    );

    const candidates = this.candidatesFrom(
      onNode.map(instance => this.factsOf(instance, fleet, waitingOn)),
      refused.refusal,
      placement.pins,
      this.configService.schedulerMinResidencyMs,
      now
    );

    const chosen = await this.firstThatFits(deployment, placement, refused, candidates);

    if (chosen === null) {
      return null;
    }

    return {
      victims: chosen.map(facts => this.victimOf(facts, placement.nodeId, now)),
      refused,
    };
  }

  /** Least recently used first. */
  candidatesFrom(
    facts: IEvictionFacts[],
    refusal: FitRefusal,
    pins: IInstancePins,
    minResidencyMs: number,
    now: Date
  ): IEvictionFacts[] {
    return facts
      .filter(candidate => this.evictable(candidate, refusal, pins, minResidencyMs, now))
      .toSorted((left, right) => (left.idleSince?.getTime() ?? 0) - (right.idleSince?.getTime() ?? 0));
  }

  private evictable(
    candidate: IEvictionFacts,
    refusal: FitRefusal,
    pins: IInstancePins,
    minResidencyMs: number,
    now: Date
  ): boolean {
    if (
      candidate.activationPolicy !== ActivationPolicy.ON_DEMAND ||
      !candidate.ready ||
      candidate.draining ||
      candidate.inFlight > 0 ||
      candidate.waiting > 0 ||
      candidate.readyDate === null ||
      now.getTime() - candidate.readyDate.getTime() < minResidencyMs
    ) {
      return false;
    }

    return (
      refusal === FitRefusal.HOST_MEMORY || candidate.instance.pins.gpus.some(device => pins.gpus.includes(device))
    );
  }

  /** Passes over a candidate that frees nothing, so nothing is evicted for no gain. */
  private async firstThatFits(
    deployment: Deployment,
    placement: INodePlacement,
    refused: IFitReport,
    candidates: IEvictionFacts[]
  ): Promise<IEvictionFacts[] | null> {
    const chosen: IEvictionFacts[] = [];
    let previous = refused;

    for (const candidate of candidates) {
      const report = await this.instanceAdmissionService.checkReleasing(
        deployment,
        placement,
        [...chosen, candidate].map(facts => facts.instance.instanceKey)
      );

      if (report === null) {
        return null;
      }

      if (report.refusal === null || report.refusal === FitRefusal.LOAD_IN_PROGRESS) {
        return [...chosen, candidate];
      }

      if (this.gained(previous, report)) {
        chosen.push(candidate);
        previous = report;
      }
    }

    return null;
  }

  private gained(previous: IFitReport, report: IFitReport): boolean {
    if (previous.refusal === FitRefusal.HOST_MEMORY) {
      return (report.hostWeights?.freeBytes ?? 0) > (previous.hostWeights?.freeBytes ?? 0);
    }

    if (previous.refusal === FitRefusal.CARD_TOO_SMALL) {
      return previous.cards.some((card, index) => this.freedShortCard(card, report.cards.at(index)));
    }

    return (report.availableBytes ?? 0) > (previous.availableBytes ?? 0);
  }

  private freedShortCard(card: ICardFigures, after: ICardFigures | undefined): boolean {
    const free = card.freeBytes ?? 0;
    const short = card.neededBytes !== null && card.neededBytes > free - card.headroomBytes;

    return short && (after?.freeBytes ?? 0) > free;
  }

  private factsOf(instance: Instance, fleet: Instance[], waitingOn: (deploymentId: number) => number): IEvictionFacts {
    const deployment = instance.deployment;

    return {
      instance,
      activationPolicy: deployment?.activationPolicy ?? ActivationPolicy.ALWAYS,
      ready: instance.instanceState === InstanceState.READY,
      draining: this.instanceLeaseService.isDraining(instance),
      inFlight: this.instanceLeaseService.inFlightOn(instance),
      waiting: waitingOn(instance.deploymentId),
      readyDate: instance.readyDate,
      idleSince: this.supervisorPolicyService.idleSince(
        deployment?.lastUsedDate ?? null,
        this.supervisorPolicyService.newestInstanceDate(
          fleet.filter(other => other.deploymentId === instance.deploymentId)
        )
      ),
    };
  }

  private victimOf(facts: IEvictionFacts, nodeId: number, now: Date): IPlannedEviction {
    return {
      instance: facts.instance,
      idleMs: facts.idleSince === null ? 0 : this.supervisorPolicyService.idleFor(facts.idleSince, now),
      releasedBytes: this.vramLedgerService.attributedBytes(nodeId, facts.instance.instanceKey),
    };
  }
}
