import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import {
  AgentTelemetry,
  GpuDeviceMetrics,
  HostResources,
  ProcessAttribution,
  TelemetryError,
  TelemetryState,
} from '@libs/agent-protocol';

export interface INodeTelemetry {
  capturedAt: string;
  telemetryState: TelemetryState;
  devices: GpuDeviceMetrics[];
  host: HostResources;
  errors: TelemetryError[];
  receivedDate: Date;
}

export interface IMeasuredInstance {
  instanceKey: string;
  gpus: string[];
}

export interface IMeasuredUsage {
  vramBytes: number | null;
  ramBytes: number | null;
}

/** Readings live for the life of the process. */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  private readonly telemetry = new Map<number, INodeTelemetry>();

  private readonly changes = new Subject<number>();

  recordTelemetry(nodeId: number, telemetry: AgentTelemetry): void {
    this.telemetry.set(nodeId, {
      capturedAt: telemetry.capturedAt,
      telemetryState: telemetry.telemetryState,
      devices: telemetry.devices,
      host: telemetry.host,
      errors: telemetry.errors,
      receivedDate: new Date(),
    });

    if (telemetry.telemetryState === TelemetryState.DEGRADED) {
      this.logger.warn(
        { nodeId, errors: telemetry.errors.length },
        'recordTelemetry(): A node reported degraded telemetry'
      );
    }

    this.changes.next(nodeId);
  }

  /** Null where this node has reported nothing since the server started. */
  getTelemetry(nodeId: number): INodeTelemetry | null {
    return this.telemetry.get(nodeId) ?? null;
  }

  forget(nodeId: number): void {
    this.telemetry.delete(nodeId);

    this.changes.next(nodeId);
  }

  /**
   * What the processes the agent labelled with the instance hold on the card. Null where none of them is on it, or one
   * carries no figure, so the sum would read short.
   */
  heldBy(device: GpuDeviceMetrics, instanceKey: string): number | null {
    const held = device.processes.filter(process => process.instanceKey === instanceKey);
    let total = 0;

    if (held.length === 0) {
      return null;
    }

    for (const process of held) {
      if (process.usedBytes === null) {
        return null;
      }

      total += process.usedBytes;
    }

    return total;
  }

  measuredUsage(nodeId: number, instances: IMeasuredInstance[]): IMeasuredUsage {
    const telemetry = this.getTelemetry(nodeId);

    if (telemetry === null) {
      return { vramBytes: null, ramBytes: null };
    }

    return {
      vramBytes: this.sumOf(instances.map(instance => this.heldOnCards(telemetry.devices, instance))),
      ramBytes: this.sumOf(instances.map(instance => this.residentBytesOf(telemetry.host, instance.instanceKey))),
    };
  }

  private sumOf(readings: (number | null)[]): number | null {
    let total = 0;

    for (const reading of readings) {
      if (reading === null) {
        return null;
      }

      total += reading;
    }

    return total;
  }

  /** A backend need not use every card it is pinned to, so a card with none of its processes holds none of it. */
  private heldOnCards(devices: GpuDeviceMetrics[], instance: IMeasuredInstance): number | null {
    let total: number | null = null;

    for (const deviceKey of instance.gpus) {
      const device = devices.find(candidate => candidate.deviceKey === deviceKey);

      if (device === undefined || device.processAttribution !== ProcessAttribution.EXACT) {
        return null;
      }

      const held = this.heldBy(device, instance.instanceKey);

      if (held !== null) {
        total = (total ?? 0) + held;
      }
    }

    return total;
  }

  private residentBytesOf(host: HostResources, instanceKey: string): number | null {
    return host.instanceMemory?.find(reading => reading.instanceKey === instanceKey)?.residentBytes ?? null;
  }

  /** Emits the node whose readings changed, on both a new reading and a dropped session. */
  telemetryChanged(): Observable<number> {
    return this.changes.asObservable();
  }
}
