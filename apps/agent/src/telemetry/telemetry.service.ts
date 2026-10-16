import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, Subscription } from 'rxjs';

import {
  AgentGpuInventory,
  AgentTelemetry,
  GpuDevice,
  GpuDeviceMetrics,
  GpuProcess,
  MAX_CONTAINER_ID_LENGTH,
  MAX_CONTAINER_NAME_LENGTH,
  MAX_DEVICE_KEY_LENGTH,
  MAX_DEVICE_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_PCI_BUS_ID_LENGTH,
  MAX_PROCESS_NAME_LENGTH,
  MAX_TELEMETRY_ERRORS,
  MAX_TELEMETRY_METRIC_LENGTH,
  TelemetryError,
  TelemetryErrorScope,
  TelemetryState,
} from '@libs/agent-protocol';

import { ConfigService } from '../config/config.service';
import { ContainerLookupService, IContainerRef } from '../docker/container-lookup.service';
import { DeviceReaderService } from './device-reader/device-reader.service';
import { GpuSnapshot, SnapshotDevice, SnapshotProcess, deviceKeyOf } from './device-reader/gpu-snapshot';
import { HostResourcesService } from './host-resources.service';

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);

  private readonly telemetry = new Subject<AgentTelemetry>();
  private readonly inventories = new Subject<AgentGpuInventory>();
  private readonly subscriptions: Subscription[] = [];

  private readonly degradedAfter: number;

  private inventory: AgentGpuInventory | null = null;
  private consecutiveFailures = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly deviceReader: DeviceReaderService,
    private readonly containerLookupService: ContainerLookupService,
    private readonly hostResourcesService: HostResourcesService
  ) {
    this.degradedAfter = this.configService.telemetryDegradedAfter;
  }

  onModuleInit(): void {
    this.subscriptions.push(
      this.deviceReader.snapshotStream().subscribe(snapshot => {
        this.readSnapshot(snapshot).catch((error: unknown) => {
          this.logger.error({ error }, 'onModuleInit(): Reading a device snapshot failed');
        });
      })
    );

    this.subscriptions.push(
      this.deviceReader.failureStream().subscribe(reason => {
        this.readFailure(reason);
      })
    );

    // Subscribing first: the reader publishes as soon as it starts.
    this.deviceReader.start();
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions.length = 0;
  }

  changes(): Observable<AgentTelemetry> {
    return this.telemetry.asObservable();
  }

  inventoryChanges(): Observable<AgentGpuInventory> {
    return this.inventories.asObservable();
  }

  currentInventory(): AgentGpuInventory | null {
    return this.inventory;
  }

  requestSnapshot(): void {
    this.deviceReader.requestSnapshot();
  }

  private async readSnapshot(snapshot: GpuSnapshot): Promise<void> {
    this.consecutiveFailures = 0;

    const errors = snapshot.errors.map(error => ({
      scope: error.scope,
      deviceKey: this.clamp(error.device, MAX_DEVICE_KEY_LENGTH),
      metric: this.clamp(error.metric, MAX_TELEMETRY_METRIC_LENGTH),
      message: this.clamp(error.message, MAX_MESSAGE_LENGTH) ?? 'The device reader gave no detail',
    }));

    const devices: GpuDevice[] = [];
    const metrics: GpuDeviceMetrics[] = [];
    const pids = snapshot.devices.flatMap(device => device.processes.map(usage => usage.pid));
    const containers = await this.containerLookupService.resolve(pids);

    for (const device of snapshot.devices) {
      const deviceKey = deviceKeyOf(device);

      if (deviceKey === null) {
        errors.push({
          scope: TelemetryErrorScope.DEVICE,
          deviceKey: null,
          metric: null,
          message: `The device at index ${device.index} reported no uuid`,
        });

        continue;
      }

      devices.push(this.inventoryOf(device, deviceKey));

      metrics.push({
        deviceKey,
        index: device.index,
        memoryUsedBytes: device.memoryUsedBytes ?? null,
        utilisationPercent: device.utilisationPercent ?? null,
        temperatureC: device.temperatureC ?? null,
        powerDrawWatts: device.powerDrawWatts ?? null,
        processAttribution: device.processAttribution,
        processes: device.processes.map(usage => this.processOf(usage, containers.get(usage.pid))),
      });
    }

    this.publishInventory({ devices });

    this.telemetry.next({
      capturedAt: snapshot.capturedAt,
      telemetryState: TelemetryState.OK,
      devices: metrics,
      host: await this.hostResourcesService.read(),
      errors: errors.slice(0, MAX_TELEMETRY_ERRORS),
    });
  }

  private readFailure(reason: string): void {
    this.consecutiveFailures += 1;

    if (this.consecutiveFailures < this.degradedAfter) {
      return;
    }

    if (this.consecutiveFailures === this.degradedAfter) {
      this.logger.error(
        { attempts: this.consecutiveFailures },
        `readFailure(): Device telemetry is degraded: ${reason}`
      );
    }

    this.publishDegraded(reason).catch((error: unknown) => {
      this.logger.error({ error }, 'readFailure(): Publishing degraded telemetry failed');
    });
  }

  private async publishDegraded(reason: string): Promise<void> {
    const capturedAt = new Date().toISOString();
    const host = await this.hostResourcesService.read();

    // A snapshot that arrived while the host was read has reported the devices since, and reset the count.
    if (this.consecutiveFailures < this.degradedAfter) {
      return;
    }

    this.telemetry.next({
      capturedAt,
      telemetryState: TelemetryState.DEGRADED,
      devices: [],
      host,
      errors: [
        {
          scope: TelemetryErrorScope.PROVIDER,
          deviceKey: null,
          metric: null,
          message: this.clamp(reason, MAX_MESSAGE_LENGTH) ?? 'The device reader gave no detail',
        } satisfies TelemetryError,
      ],
    });
  }

  private publishInventory(inventory: AgentGpuInventory): void {
    if (this.inventory !== null && this.inventoryKey(this.inventory) === this.inventoryKey(inventory)) {
      return;
    }

    this.inventory = inventory;
    this.inventories.next(inventory);
  }

  private inventoryOf(device: SnapshotDevice, deviceKey: string): GpuDevice {
    return {
      deviceKey,
      vendor: device.vendor,
      name: this.clamp(device.name, MAX_DEVICE_NAME_LENGTH),
      pciBusId: this.clamp(device.pciBusId, MAX_PCI_BUS_ID_LENGTH),
      memoryTotalBytes: device.memoryTotalBytes ?? null,
      index: device.index,
    };
  }

  private processOf(usage: SnapshotProcess, container: IContainerRef | undefined): GpuProcess {
    return {
      pid: usage.pid,
      usedBytes: usage.usedBytes ?? null,
      name: this.clamp(usage.name, MAX_PROCESS_NAME_LENGTH),
      containerId: container === undefined ? null : this.clamp(container.id, MAX_CONTAINER_ID_LENGTH),
      containerName: container === undefined ? null : this.clamp(container.name, MAX_CONTAINER_NAME_LENGTH),
      instanceKey: container === undefined ? null : container.instanceKey,
    };
  }

  private inventoryKey(inventory: AgentGpuInventory): string {
    const devices = [...inventory.devices].sort((left, right) => left.deviceKey.localeCompare(right.deviceKey));

    return JSON.stringify(devices);
  }

  private clamp(value: string | undefined, limit: number): string | null {
    const trimmed = value?.trim();

    if (trimmed === undefined || trimmed.length === 0) {
      return null;
    }

    return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
  }
}
