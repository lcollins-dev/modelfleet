import { Injectable } from '@nestjs/common';

import { GIB, LaunchMode, launchModeOf } from '@libs/backends';
import { EstimateInputSource, IMissingEstimateInput } from '@libs/backends/runtime';

import { Deployment } from '../deployment/entities/deployment.entity';

import { FitRefusal, IAdmittedUsage, IFitReport, VramLedgerService } from '../ledger/vram-ledger.service';
import { ExpectedUsageService, IExpectedUsage, IKnownUsage } from './expected-usage.service';
import { INodePlacement } from './instance-launch.service';

const NO_TELEMETRY_MESSAGE = 'No GPU memory readings received from this node';
const UNMEASURED_CARD_MESSAGE = 'Memory readings are missing for a selected GPU';
const UNKNOWN_USAGE_MESSAGE = 'Cannot estimate memory use. Missing:';
const DECLARE_VRAM_HINT = 'Set `vramGib` to specify GPU memory use';

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
  hostCacheBytes?: number;
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
  async checkReleasing(
    deployment: Deployment,
    placement: INodePlacement,
    releasing: readonly string[]
  ): Promise<IFitReport | null> {
    const usage = await this.usageOf(deployment, placement);

    return usage?.known === true
      ? this.vramLedgerService.checkReleasing(placement.nodeId, placement.pins, this.admittedOf(usage), releasing)
      : null;
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
    return {
      expectedBytes: usage.bytes,
      hostBytes: usage.hostResidentBytes,
      hostCacheBytes: usage.hostCacheBytes,
      cardShares: usage.cardShares,
      cardsOnlyReason: usage.cardsOnlyReason,
    };
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
            hostCacheBytes: report.hostWeights.cacheBytes,
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
        return { problem: this.withCardsOnlyReason(report, this.tooLargeMessage(report)), capacity: report };

      case FitRefusal.HOST_MEMORY:
        return { problem: this.hostMemoryMessage(report), capacity: report };

      case FitRefusal.CARD_TOO_SMALL:
        return { problem: this.withCardsOnlyReason(report, this.cardTooSmallMessage(report)), capacity: report };

      case FitRefusal.CARD_OUTGROWN:
        return { problem: this.withCardsOnlyReason(report, this.cardOutgrownMessage(report)), capacity: report };
    }
  }

  private withCardsOnlyReason(report: IFitReport, message: string): string {
    return report.cardsOnlyReason === undefined ? message : `${report.cardsOnlyReason}. ${message}`;
  }

  private tooLargeMessage(report: IFitReport): string {
    if (report.launchMode !== LaunchMode.CPU_OFFLOAD) {
      return `Not enough GPU memory for ${this.gib(report.expectedBytes)}`;
    }

    const needed = report.expectedBytes + (report.hostWeights?.neededBytes ?? 0);

    return `Not enough VRAM and RAM for ${this.gib(needed)}`;
  }

  private cardTooSmallMessage(report: IFitReport): string {
    const card = report.cards.find(candidate => candidate.deviceKey === report.shortCard);

    return `Not enough memory on ${report.shortCard} for ${this.gib(card?.neededBytes ?? 0)}`;
  }

  private cardOutgrownMessage(report: IFitReport): string {
    const total = report.cards.find(candidate => candidate.deviceKey === report.shortCard)?.totalBytes ?? 0;

    return `GPU memory requirement exceeds ${report.shortCard} capacity (${this.gib(total)})`;
  }

  private hostMemoryMessage(report: IFitReport): string {
    const cacheBytes = report.hostWeights?.cacheBytes ?? 0;
    const weightsBytes = (report.hostWeights?.neededBytes ?? 0) - cacheBytes;
    const parts = [
      ...(weightsBytes > 0 ? [`${this.gib(weightsBytes)} of model weights`] : []),
      ...(cacheBytes > 0 ? [`up to ${this.gib(cacheBytes)} of prompt cache`] : []),
    ];

    return `Not enough RAM for ${parts.join(' and ')}`;
  }

  private unknownUsageMessage(missing: IMissingEstimateInput[]): string {
    const named = `${UNKNOWN_USAGE_MESSAGE} ${missing.map(input => this.missingInputName(input)).join(', ')}`;

    return missing.some(input => input.source === EstimateInputSource.DEVICE)
      ? named
      : `${named}. ${DECLARE_VRAM_HINT}`;
  }

  private missingInputName(input: IMissingEstimateInput): string {
    switch (input.source) {
      case EstimateInputSource.MODEL_METADATA:
        return `the model's ${input.field}`;

      case EstimateInputSource.CONFIGURATION:
        return `\`${input.field}\``;

      case EstimateInputSource.DEVICE:
        return `total memory for ${input.field} (not reported)`;
    }
  }

  private bytesOrDash(bytes: number | null): string {
    return bytes === null ? '-' : this.gib(bytes);
  }

  private gib(bytes: number): string {
    return `${(bytes / GIB).toFixed(1)} GiB`;
  }
}
