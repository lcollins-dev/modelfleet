import { Injectable } from '@nestjs/common';

import { GIB, LaunchMode, launchModeOf } from '@libs/backends';
import { EstimateInputSource, IMissingEstimateInput } from '@libs/backends/runtime';

import { Deployment } from '../deployment/entities/deployment.entity';

import { FitRefusal, IAdmittedUsage, IFitReport, VramLedgerService } from '../ledger/vram-ledger.service';
import { ExpectedUsageService, IExpectedUsage, IKnownUsage } from './expected-usage.service';
import { INodePlacement } from './instance-launch.service';

const NO_TELEMETRY_MESSAGE = 'This node has not reported its GPU memory since it connected';
const UNMEASURED_CARD_MESSAGE = 'A pinned GPU has not reported its total or used memory';
const UNKNOWN_USAGE_MESSAGE = "This deployment's memory use cannot be estimated without";
const DECLARE_VRAM_HINT = 'declare its VRAM as `vramGib` to start it';

export interface IAdmission {
  problem: string | null;

  /** Present where the ledger refused the node, and on every node a preview put to it. */
  capacity?: IFitReport;

  expected?: IKnownUsage;
}

export interface ICapacityDetail {
  expectedBytes: number;
  availableBytes?: number;
  cards?: string;
  hostNeededBytes?: number;
  hostHeldBytes?: number;
  hostAvailableBytes?: number;
}

@Injectable()
export class InstanceAdmissionService {
  constructor(
    private readonly expectedUsageService: ExpectedUsageService,
    private readonly vramLedgerService: VramLedgerService
  ) {}

  async preview(deployment: Deployment, placement: INodePlacement): Promise<IAdmission> {
    const usage = await this.usageOf(deployment, placement);

    if (usage === null) {
      return { problem: null };
    }

    if (!usage.known) {
      return { problem: this.unknownUsageMessage(usage.missing) };
    }

    const report = await this.vramLedgerService.check(placement.nodeId, placement.pins, this.admittedOf(usage));

    return { ...this.admissionOf(report), capacity: report, expected: usage };
  }

  /** Null where the placement takes no card, or no source can size the deployment. */
  async expectedFor(deployment: Deployment, placement: INodePlacement): Promise<IKnownUsage | null> {
    const usage = await this.usageOf(deployment, placement);

    return usage?.known === true ? usage : null;
  }

  /** Holds a prediction in the ledger where it fits. The caller releases it if the row is not written. */
  async admit(deployment: Deployment, placement: INodePlacement, instanceKey: string): Promise<IAdmission> {
    const usage = await this.usageOf(deployment, placement);

    if (usage === null) {
      return { problem: null };
    }

    if (!usage.known) {
      return { problem: this.unknownUsageMessage(usage.missing) };
    }

    const report = await this.vramLedgerService.admit(
      instanceKey,
      deployment.id,
      placement.nodeId,
      placement.pins,
      this.admittedOf(usage)
    );

    return { ...this.admissionOf(report), expected: usage };
  }

  private admittedOf(usage: IKnownUsage): IAdmittedUsage {
    return { expectedBytes: usage.bytes, hostBytes: usage.hostResidentBytes, cardShares: usage.cardShares };
  }

  /** Null for a placement on the CPU alone, which takes no card and is never sized. */
  private async usageOf(deployment: Deployment, placement: INodePlacement): Promise<IExpectedUsage | null> {
    if (launchModeOf(placement.pins) === LaunchMode.CPU_ONLY) {
      return null;
    }

    return this.expectedUsageService.expectedFor(deployment, placement.nodeId, placement.pins);
  }

  capacityDetail(report: IFitReport): ICapacityDetail {
    const cards = report.cards.map(
      card =>
        `${card.deviceKey}: total ${this.bytesOrDash(card.totalBytes)}, used ${this.bytesOrDash(card.usedBytes)}, ` +
        `predicted ${this.gib(card.predictedBytes)}, headroom ${this.gib(card.headroomBytes)}, ` +
        `free ${this.bytesOrDash(card.freeBytes)}` +
        (card.neededBytes === null ? '' : `, needed ${this.gib(card.neededBytes)}`)
    );

    return {
      expectedBytes: report.expectedBytes,
      ...(report.availableBytes === null ? {} : { availableBytes: report.availableBytes }),
      ...(cards.length === 0 ? {} : { cards: cards.join('; ') }),
      ...(report.hostWeights === null
        ? {}
        : {
            hostNeededBytes: report.hostWeights.neededBytes,
            hostHeldBytes: report.hostWeights.predictedBytes,
            hostAvailableBytes: report.hostWeights.freeBytes,
          }),
    };
  }

  /** Names what the deployment needs and not what is free, so a refusal repeated as memory moves reads the same. */
  private admissionOf(report: IFitReport): IAdmission {
    switch (report.refusal) {
      case null:
        return { problem: null };

      case FitRefusal.NO_TELEMETRY:
        return { problem: NO_TELEMETRY_MESSAGE, capacity: report };

      case FitRefusal.UNMEASURED_CARD:
        return { problem: UNMEASURED_CARD_MESSAGE, capacity: report };

      case FitRefusal.TOO_LARGE:
        return { problem: this.tooLargeMessage(report), capacity: report };

      case FitRefusal.HOST_MEMORY:
        return { problem: this.hostMemoryMessage(report), capacity: report };

      case FitRefusal.CARD_TOO_SMALL:
        return { problem: this.cardTooSmallMessage(report), capacity: report };

      case FitRefusal.CARD_OUTGROWN:
        return { problem: this.cardOutgrownMessage(report), capacity: report };
    }
  }

  private tooLargeMessage(report: IFitReport): string {
    if (report.launchMode !== LaunchMode.CPU_OFFLOAD) {
      return `This deployment needs ${this.gib(report.expectedBytes)}, more than the pinned GPUs have free`;
    }

    const needed = report.expectedBytes + (report.hostWeights?.neededBytes ?? 0);

    return `This deployment needs ${this.gib(needed)}, more than the pinned GPUs and system memory have free`;
  }

  private cardTooSmallMessage(report: IFitReport): string {
    const card = report.cards.find(candidate => candidate.deviceKey === report.shortCard);

    return `This deployment needs ${this.gib(card?.neededBytes ?? 0)} on ${report.shortCard}, more than it has free`;
  }

  private cardOutgrownMessage(report: IFitReport): string {
    const total = report.cards.find(candidate => candidate.deviceKey === report.shortCard)?.totalBytes ?? 0;

    return `This deployment needs more than the ${this.gib(total)} ${report.shortCard} holds in all`;
  }

  private hostMemoryMessage(report: IFitReport): string {
    const needed = report.hostWeights?.neededBytes ?? 0;

    return `This deployment keeps ${this.gib(needed)} of weights in system memory, more than the node has free`;
  }

  private unknownUsageMessage(missing: IMissingEstimateInput[]): string {
    const named = `${UNKNOWN_USAGE_MESSAGE} ${missing.map(input => this.missingInputName(input)).join(', ')}`;

    return missing.some(input => input.source === EstimateInputSource.DEVICE)
      ? named
      : `${named}; ${DECLARE_VRAM_HINT}`;
  }

  private missingInputName(input: IMissingEstimateInput): string {
    switch (input.source) {
      case EstimateInputSource.MODEL_METADATA:
        return `the model's ${input.field}`;

      case EstimateInputSource.CONFIGURATION:
        return `\`${input.field}\``;

      case EstimateInputSource.DEVICE:
        return `the total memory of GPU ${input.field}, which it has not reported`;
    }
  }

  private bytesOrDash(bytes: number | null): string {
    return bytes === null ? '-' : this.gib(bytes);
  }

  private gib(bytes: number): string {
    return `${(bytes / GIB).toFixed(1)} GiB`;
  }
}
