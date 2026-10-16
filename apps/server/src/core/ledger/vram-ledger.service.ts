import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { GpuDeviceMetrics, InstanceState, ProcessAttribution } from '@libs/agent-protocol';
import { GIB, IInstancePins, LaunchMode, launchModeOf } from '@libs/backends';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { DeploymentService } from '../deployment/deployment.service';
import { GpuService } from '../gpu/gpu.service';
import { NodeStateService } from '../node/node-state.service';
import { INodeTelemetry, TelemetryService } from '../telemetry/telemetry.service';

/** For an agent that predates reporting its own, matching llama.cpp's `--fit-target` default. */
const DEFAULT_GPU_HEADROOM_BYTES = GIB;

export enum FitRefusal {
  NO_TELEMETRY = 'noTelemetry',
  UNMEASURED_CARD = 'unmeasuredCard',
  TOO_LARGE = 'tooLarge',
  HOST_MEMORY = 'hostMemory',
  CARD_TOO_SMALL = 'cardTooSmall',
  CARD_OUTGROWN = 'cardOutgrown',
}

export interface ICardFigures {
  deviceKey: string;
  totalBytes: number | null;
  usedBytes: number | null;
  predictedBytes: number;
  headroomBytes: number;

  /** Before headroom. Null where the total or the measured usage is unknown. */
  freeBytes: number | null;

  neededBytes: number | null;
}

export interface IHostFigures {
  neededBytes: number;

  /** What loading instances hold, which `freeBytes` already leaves out. */
  predictedBytes: number;

  freeBytes: number;
}

export interface IInstancePrediction {
  instanceKey: string;
  bytes: number;
}

export interface IFitReport {
  launchMode: LaunchMode;
  expectedBytes: number;
  cards: ICardFigures[];

  /** The system memory in the pool. Null where the launch mode takes none, or the node has not reported. */
  hostFreeBytes: number | null;

  /** The whole pool after headroom. Null where any part of it is unknown. */
  availableBytes: number | null;

  /** Null where the instance needs nothing resident in system memory, or a card or the node has not reported. */
  hostWeights: IHostFigures | null;

  shortCard: string | null;

  refusal: FitRefusal | null;
}

/**
 * Readings and state reports travel apart, so the first reading after a report may have been captured before it.
 * The second was captured an interval later, after the load it measures.
 */
const READINGS_TO_MEASURE = 2;

export interface IAdmittedUsage {
  expectedBytes: number;
  hostBytes: number;

  cardShares: number[] | null;
}

interface IAdmissionInputs {
  headroomBytes: number;
  totalBytes: Map<string, number | null>;
}

interface ILedgerEntry {
  nodeId: number;
  deploymentId: number;
  predictions: Map<string, number>;
  totalBytes: Map<string, number | null>;
  hostBytes: number;

  /** Null until the node reports the instance past starting. */
  readingsSinceSettled: number | null;

  stopping: boolean;
}

/**
 * Each card's usage, held in memory and never persisted. Checking and reserving run with no await between them, so
 * admission on one node is serialised without a lock.
 */
@Injectable()
export class VramLedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly entries = new Map<string, ILedgerEntry>();

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly deploymentService: DeploymentService,
    private readonly gpuService: GpuService,
    private readonly nodeStateService: NodeStateService,
    private readonly telemetryService: TelemetryService
  ) {}

  onModuleInit(): void {
    this.subscriptions.add(this.nodeStateService.getObservedReports().subscribe(nodeId => this.settle(nodeId)));

    this.subscriptions.add(this.telemetryService.telemetryChanged().subscribe(nodeId => this.countReading(nodeId)));

    this.subscriptions.add(
      this.deploymentService.deploymentRemoved().subscribe(deploymentId => this.markDeploymentStopping(deploymentId))
    );
  }

  onModuleDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  async check(nodeId: number, pins: IInstancePins, usage: IAdmittedUsage): Promise<IFitReport> {
    const inputs = await this.readInputs(nodeId);

    return this.fit(nodeId, pins, usage, inputs);
  }

  headroomFor(nodeId: number): number {
    return this.agentConnectionService.gpuHeadroomFor(nodeId) ?? DEFAULT_GPU_HEADROOM_BYTES;
  }

  /** Holds a prediction on each pinned card and in system memory where the instance fits, until it is measured. */
  async admit(
    instanceKey: string,
    deploymentId: number,
    nodeId: number,
    pins: IInstancePins,
    usage: IAdmittedUsage
  ): Promise<IFitReport> {
    const inputs = await this.readInputs(nodeId);
    const report = this.fit(nodeId, pins, usage, inputs);

    if (report.refusal === null && report.launchMode !== LaunchMode.CPU_ONLY) {
      this.entries.set(instanceKey, {
        nodeId,
        deploymentId,
        predictions: this.predict(report),
        totalBytes: new Map(report.cards.map(card => [card.deviceKey, card.totalBytes])),
        hostBytes: usage.hostBytes,
        readingsSinceSettled: null,
        stopping: false,
      });
    }

    return report;
  }

  /** For an admission whose row was never written. */
  release(instanceKey: string): void {
    this.entries.delete(instanceKey);
  }

  /** Stays counted until the node stops reporting its container, since a stopping backend still holds its memory. */
  markStopping(instanceKeys: string[]): void {
    for (const instanceKey of instanceKeys) {
      const entry = this.entries.get(instanceKey);

      if (entry !== undefined) {
        entry.stopping = true;
      }
    }
  }

  private markDeploymentStopping(deploymentId: number): void {
    for (const entry of this.entries.values()) {
      if (entry.deploymentId === deploymentId) {
        entry.stopping = true;
      }
    }
  }

  private settle(nodeId: number): void {
    const observed = this.nodeStateService.getObserved(nodeId);

    if (observed === null) {
      return;
    }

    const reported = new Map(observed.instances.map(instance => [instance.instanceKey, instance.instanceState]));

    for (const [instanceKey, entry] of this.entries) {
      if (entry.nodeId !== nodeId) {
        continue;
      }

      const state = reported.get(instanceKey);

      if (state === undefined && entry.stopping) {
        this.entries.delete(instanceKey);

        continue;
      }

      if (state !== undefined && state !== InstanceState.STARTING && entry.readingsSinceSettled === null) {
        entry.readingsSinceSettled = 0;
      }
    }
  }

  /** A dropped session also emits here, and is no reading. */
  private countReading(nodeId: number): void {
    if (this.telemetryService.getTelemetry(nodeId) === null) {
      return;
    }

    for (const entry of this.entries.values()) {
      if (entry.nodeId === nodeId && entry.readingsSinceSettled !== null) {
        entry.readingsSinceSettled++;
      }
    }
  }

  private async readInputs(nodeId: number): Promise<IAdmissionInputs> {
    const gpus = await this.gpuService.findByNodeId(nodeId);

    return {
      headroomBytes: this.headroomFor(nodeId),
      totalBytes: new Map(gpus.map(gpu => [gpu.deviceKey, gpu.memoryTotalBytes])),
    };
  }

  /**
   * Reads only what is held in memory, so nothing can change between this and a reservation made on it. Where the
   * instance may offload, its host weights come out of the pool's system memory, so it is counted once.
   */
  private fit(nodeId: number, pins: IInstancePins, usage: IAdmittedUsage, inputs: IAdmissionInputs): IFitReport {
    const launchMode = launchModeOf(pins);
    const telemetry = this.telemetryService.getTelemetry(nodeId);

    const report: IFitReport = {
      launchMode,
      expectedBytes: usage.expectedBytes,
      cards: [],
      hostFreeBytes: null,
      availableBytes: null,
      hostWeights: null,
      shortCard: null,
      refusal: null,
    };

    if (launchMode === LaunchMode.CPU_ONLY) {
      return report;
    }

    if (telemetry === null) {
      return { ...report, refusal: FitRefusal.NO_TELEMETRY };
    }

    const offloads = launchMode === LaunchMode.CPU_OFFLOAD;
    const hostPredictedBytes = this.predictedOnHost(nodeId);
    const hostFreeBytes = Math.max(telemetry.host.memoryFreeBytes - hostPredictedBytes, 0);

    report.cards = pins.gpus.map(deviceKey => this.figuresFor(nodeId, deviceKey, telemetry, inputs));
    report.hostFreeBytes = offloads ? hostFreeBytes : null;

    const outgrown = offloads ? null : this.outgrownCard(report.cards, usage);

    if (outgrown !== null) {
      return { ...report, shortCard: outgrown, refusal: FitRefusal.CARD_OUTGROWN };
    }

    const available = this.availableOf(report.cards);

    if (available === null) {
      return { ...report, refusal: FitRefusal.UNMEASURED_CARD };
    }

    if (usage.hostBytes > 0) {
      report.hostWeights = {
        neededBytes: usage.hostBytes,
        predictedBytes: hostPredictedBytes,
        freeBytes: hostFreeBytes,
      };
    }

    report.availableBytes = available + (report.hostFreeBytes ?? 0);

    if (usage.expectedBytes + (offloads ? usage.hostBytes : 0) > report.availableBytes) {
      return { ...report, refusal: FitRefusal.TOO_LARGE };
    }

    if (!offloads) {
      this.placeOnCards(report, usage);
    }

    const shortCard = report.cards.find(card => card.neededBytes !== null && card.neededBytes > this.roomOf(card));

    if (shortCard !== undefined) {
      return { ...report, shortCard: shortCard.deviceKey, refusal: FitRefusal.CARD_TOO_SMALL };
    }

    return usage.hostBytes <= hostFreeBytes ? report : { ...report, refusal: FitRefusal.HOST_MEMORY };
  }

  private placeOnCards(report: IFitReport, usage: IAdmittedUsage): void {
    const needs = this.cardNeeds(report.cards, usage);

    report.cards.forEach((card, index) => {
      card.neededBytes = needs?.[index] ?? null;
    });
  }

  /** A card whose whole memory is short of its part can never take the instance, whatever is freed on it. */
  private outgrownCard(cards: readonly ICardFigures[], usage: IAdmittedUsage): string | null {
    const needs = this.cardNeeds(cards, usage);
    const outgrown = cards.find((card, index) => card.totalBytes !== null && (needs?.[index] ?? 0) > card.totalBytes);

    return outgrown?.deviceKey ?? null;
  }

  /** Null where the launch is held to no split. */
  private cardNeeds(cards: readonly ICardFigures[], usage: IAdmittedUsage): number[] | null {
    const shares = usage.cardShares;
    const sharesTotal = shares?.reduce((sum, share) => sum + share, 0) ?? 0;

    if (shares === null || sharesTotal <= 0 || shares.length !== cards.length) {
      return null;
    }

    return shares.map(share => Math.round((usage.expectedBytes * share) / sharesTotal));
  }

  private roomOf(card: ICardFigures): number {
    return Math.max((card.freeBytes ?? 0) - card.headroomBytes, 0);
  }

  private figuresFor(
    nodeId: number,
    deviceKey: string,
    telemetry: INodeTelemetry,
    inputs: IAdmissionInputs
  ): ICardFigures {
    const totalBytes = inputs.totalBytes.get(deviceKey) ?? null;
    const usedBytes = telemetry.devices.find(device => device.deviceKey === deviceKey)?.memoryUsedBytes ?? null;
    const predictedBytes = this.predictedOn(nodeId, deviceKey);

    return {
      deviceKey,
      totalBytes,
      usedBytes,
      predictedBytes,
      headroomBytes: inputs.headroomBytes,
      freeBytes: totalBytes === null || usedBytes === null ? null : totalBytes - usedBytes - predictedBytes,
      neededBytes: null,
    };
  }

  /**
   * What each loading instance has still to take on the card: its prediction there less what the card shows it holding,
   * capped at what its whole load has still to take. The split between cards is a guess, so a card that has outrun its
   * prediction may yet take all that remains, as far as its headroom. The card's used already counts what is attributed.
   */
  predictionsOn(nodeId: number, deviceKey: string): IInstancePrediction[] {
    const devices = this.telemetryService.getTelemetry(nodeId)?.devices ?? [];
    const device = devices.find(candidate => candidate.deviceKey === deviceKey);
    const predictions: IInstancePrediction[] = [];

    for (const [instanceKey, entry] of this.entries) {
      const predicted = entry.predictions.get(deviceKey) ?? 0;

      if (entry.nodeId !== nodeId || this.isMeasured(entry) || predicted === 0) {
        continue;
      }

      const remaining = this.remainingOf(instanceKey, entry, devices);
      const ownRemaining = predicted - this.attributedTo(instanceKey, device);
      const bytes =
        ownRemaining < 0
          ? Math.min(remaining, this.roomOn(nodeId, entry.totalBytes.get(deviceKey) ?? null, device))
          : Math.min(ownRemaining, remaining);

      if (bytes > 0) {
        predictions.push({ instanceKey, bytes });
      }
    }

    return predictions;
  }

  /** Unbounded where the card's total or used memory is unknown. */
  private roomOn(nodeId: number, totalBytes: number | null, device: GpuDeviceMetrics | undefined): number {
    const usedBytes = device?.memoryUsedBytes ?? null;

    if (totalBytes === null || usedBytes === null) {
      return Infinity;
    }

    return Math.max(totalBytes - usedBytes - this.headroomFor(nodeId), 0);
  }

  private isMeasured(entry: ILedgerEntry): boolean {
    return entry.readingsSinceSettled !== null && entry.readingsSinceSettled >= READINGS_TO_MEASURE;
  }

  private remainingOf(instanceKey: string, entry: ILedgerEntry, devices: GpuDeviceMetrics[]): number {
    let remaining = 0;

    for (const [deviceKey, predicted] of entry.predictions) {
      remaining +=
        predicted -
        this.attributedTo(
          instanceKey,
          devices.find(device => device.deviceKey === deviceKey)
        );
    }

    return Math.max(remaining, 0);
  }

  /**
   * Sound only because every per-process figure a reading carries is exact by contract (`approximate` means some went
   * unreported). A vendor that estimates needs an attribution value of its own, or this under-reserves. Capped at used,
   * since the reader takes the card's figure a moment before its processes'.
   */
  private attributedTo(instanceKey: string, device: GpuDeviceMetrics | undefined): number {
    if (
      device === undefined ||
      device.memoryUsedBytes === null ||
      device.processAttribution === ProcessAttribution.UNAVAILABLE
    ) {
      return 0;
    }

    return Math.min(this.telemetryService.heldBy(device, instanceKey) ?? 0, device.memoryUsedBytes);
  }

  /** Held whole until measured, since no reading attributes system memory to an instance. */
  private predictedOnHost(nodeId: number): number {
    let predicted = 0;

    for (const entry of this.entries.values()) {
      if (entry.nodeId === nodeId && !this.isMeasured(entry)) {
        predicted += entry.hostBytes;
      }
    }

    return predicted;
  }

  private predictedOn(nodeId: number, deviceKey: string): number {
    return this.predictionsOn(nodeId, deviceKey).reduce((sum, prediction) => sum + prediction.bytes, 0);
  }

  private availableOf(cards: ICardFigures[]): number | null {
    let available = 0;

    for (const card of cards) {
      if (card.freeBytes === null) {
        return null;
      }

      available += this.roomOf(card);
    }

    return available;
  }

  private predict(report: IFitReport): Map<string, number> {
    const predictions = new Map<string, number>();
    const free = report.cards.map(card => Math.max(card.freeBytes ?? 0, 0));
    const totalFree = free.reduce((sum, bytes) => sum + bytes, 0);

    report.cards.forEach((card, index) => {
      if (card.neededBytes !== null) {
        predictions.set(card.deviceKey, card.neededBytes);
      } else if (report.launchMode === LaunchMode.CPU_OFFLOAD) {
        predictions.set(card.deviceKey, free[index]);
      } else if (totalFree > 0) {
        predictions.set(card.deviceKey, Math.round((report.expectedBytes * free[index]) / totalFree));
      } else {
        predictions.set(card.deviceKey, Math.round(report.expectedBytes / report.cards.length));
      }
    });

    return predictions;
  }
}
