import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { exhaustMap, groupBy, mergeMap, Subscription } from 'rxjs';
import { In, LessThan, Repository } from 'typeorm';

import { GpuDeviceMetrics, InstanceState, ProcessAttribution } from '@libs/agent-protocol';
import { IInstancePins, LaunchMode, launchModeOf } from '@libs/backends';

import { Instance } from './entities/instance.entity';
import { MeasuredVram } from './entities/measured-vram.entity';

import { TelemetryService } from '../telemetry/telemetry.service';

/** Readings and state reports travel apart, so the first reading after an instance reads ready may predate it. */
const READINGS_TO_MEASURE = 2;

interface IReadySighting {
  nodeId: number;
  readings: number;
}

/** Measures only ready GPU-only instances: a load in progress or one offloading to the CPU reads short. */
@Injectable()
export class MeasuredVramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeasuredVramService.name);

  private readonly stored = new Map<string, number>();

  private readonly sightings = new Map<string, IReadySighting>();

  private subscription: Subscription | null = null;

  constructor(
    private readonly telemetryService: TelemetryService,
    @InjectRepository(Instance) private readonly instanceRepository: Repository<Instance>,
    @InjectRepository(MeasuredVram) private readonly measuredVramRepository: Repository<MeasuredVram>
  ) {}

  onModuleInit(): void {
    this.subscription = this.telemetryService
      .telemetryChanged()
      .pipe(
        groupBy(nodeId => nodeId),
        // Each pass reads the node's latest reading, so one arriving mid-pass is covered by the next.
        mergeMap(byNode => byNode.pipe(exhaustMap(nodeId => this.measured(nodeId))))
      )
      .subscribe();
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  async rememberedFor(configurationRevision: string, pins: IInstancePins): Promise<number | null> {
    if (launchModeOf(pins) !== LaunchMode.GPU_ONLY) {
      return null;
    }

    return this.rememberedBytes(configurationRevision, pins.gpus.length);
  }

  private measured(nodeId: number): Promise<void> {
    return this.measure(nodeId).catch((error: unknown) => {
      this.logger.error({ error, nodeId }, "measured(): Recording a node's measured VRAM failed");
    });
  }

  private async measure(nodeId: number): Promise<void> {
    const devices = this.telemetryService.getTelemetry(nodeId)?.devices ?? [];
    const instanceKeys = this.instanceKeysOn(devices);

    if (instanceKeys.length === 0) {
      return;
    }

    const instances = await this.instanceRepository.find({
      where: { nodeId, instanceKey: In(instanceKeys), instanceState: InstanceState.READY },
      relations: { deployment: true },
    });

    this.sight(nodeId, instances);

    for (const instance of instances) {
      const bytes = this.totalOf(instance, devices);

      if (bytes !== null) {
        await this.remember(instance.configurationRevision, instance.pins.gpus.length, bytes);
      }
    }
  }

  /** An instance absent from a reading starts counting again, so a gap in attribution cannot shorten the wait. */
  private sight(nodeId: number, instances: Instance[]): void {
    const seen = new Set(instances.map(instance => instance.instanceKey));

    for (const [instanceKey, sighting] of this.sightings) {
      if (sighting.nodeId === nodeId && !seen.has(instanceKey)) {
        this.sightings.delete(instanceKey);
      }
    }

    for (const instanceKey of seen) {
      const readings = (this.sightings.get(instanceKey)?.readings ?? 0) + 1;

      this.sightings.set(instanceKey, { nodeId, readings });
    }
  }

  private instanceKeysOn(devices: GpuDeviceMetrics[]): string[] {
    const instanceKeys = new Set<string>();

    for (const device of devices) {
      if (device.processAttribution !== ProcessAttribution.EXACT) {
        continue;
      }

      for (const process of device.processes) {
        if (process.instanceKey !== null && process.instanceKey !== undefined) {
          instanceKeys.add(process.instanceKey);
        }
      }
    }

    return [...instanceKeys];
  }

  private totalOf(instance: Instance, devices: GpuDeviceMetrics[]): number | null {
    if (launchModeOf(instance.pins) !== LaunchMode.GPU_ONLY) {
      return null;
    }

    if ((this.sightings.get(instance.instanceKey)?.readings ?? 0) < READINGS_TO_MEASURE) {
      return null;
    }

    // An unapplied edit may relaunch this instance on the new configuration under its old revision.
    if (instance.deployment?.configurationRevision !== instance.configurationRevision) {
      return null;
    }

    let total = 0;

    for (const deviceKey of instance.pins.gpus) {
      const device = devices.find(candidate => candidate.deviceKey === deviceKey);

      if (device === undefined || device.processAttribution !== ProcessAttribution.EXACT) {
        return null;
      }

      const held = this.telemetryService.heldBy(device, instance.instanceKey);

      if (held === null) {
        return null;
      }

      total += held;
    }

    return total;
  }

  private async remember(configurationRevision: string, gpuCount: number, bytes: number): Promise<void> {
    const key = `${configurationRevision}:${gpuCount}`;
    const stored = this.stored.get(key) ?? (await this.rememberedBytes(configurationRevision, gpuCount));

    if (stored !== null && bytes <= stored) {
      this.stored.set(key, stored);

      return;
    }

    if (stored === null) {
      await this.measuredVramRepository.insert(new MeasuredVram({ configurationRevision, gpuCount, bytes }));
    } else {
      // Guarded on the row too, so a figure another write raised meanwhile is never lowered.
      await this.measuredVramRepository.update({ configurationRevision, gpuCount, bytes: LessThan(bytes) }, { bytes });
    }

    this.stored.set(key, bytes);
  }

  private async rememberedBytes(configurationRevision: string, gpuCount: number): Promise<number | null> {
    const row = await this.measuredVramRepository.findOneBy({ configurationRevision, gpuCount });

    return row?.bytes ?? null;
  }
}
