import { Injectable, Logger } from '@nestjs/common';
import { EMPTY, Observable, auditTime, catchError, concat, concatMap, exhaustMap, filter, from, of } from 'rxjs';

import { GpuDeviceMetrics, GpuProcess, HostResources, ModelDirectorySpace, TelemetryError } from '@libs/agent-protocol';
import {
  FleetTelemetryResponseDto,
  GpuTelemetryDto,
  GpuProcessDto,
  GpuTelemetryErrorDto,
  ModelDirectorySpaceDto,
  NodeHostTelemetryDto,
  NodeTelemetryStatusDto,
} from '@libs/dto';

import { Gpu } from '@/core/gpu/entities/gpu.entity';
import { Instance } from '@/core/instance/entities/instance.entity';

import { GpuService } from '@/core/gpu/gpu.service';
import { InstanceService } from '@/core/instance/instance.service';
import { VramLedgerService } from '@/core/ledger/vram-ledger.service';
import { NodeService } from '@/core/node/node.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

import {
  GPU_PROCESS_ATTRIBUTIONS,
  GPU_TELEMETRY_ERROR_SCOPES,
  GPU_VENDORS,
  MODEL_DIRECTORY_WRITE_ACCESSES,
  NODE_TELEMETRY_STATES,
} from './types/mappings';

/** Short against the five-second cadence nodes report on. */
const FLEET_TELEMETRY_AUDIT_MS = 1000;

@Injectable()
export class TelemetryAdminService {
  private readonly logger = new Logger(TelemetryAdminService.name);

  constructor(
    private readonly gpuService: GpuService,
    private readonly telemetryService: TelemetryService,
    private readonly instanceService: InstanceService,
    private readonly nodeService: NodeService,
    private readonly vramLedgerService: VramLedgerService
  ) {}

  /** The node's device set, where a device the latest reading omits reports no live metrics. */
  async getNodeTelemetryStatus(nodeId: number): Promise<NodeTelemetryStatusDto> {
    await this.nodeService.findWithThrow(nodeId);

    const devices = await this.gpuService.findByNodeId(nodeId);
    const deploymentNames = this.deploymentNamesOf(await this.instanceService.findByNodeId(nodeId));

    return this.getINodeTelemetryStatus(nodeId, devices, deploymentNames);
  }

  async getFleetTelemetry(): Promise<FleetTelemetryResponseDto> {
    const nodes = await this.nodeService.findAll();
    const devicesByNodeId = Map.groupBy(await this.gpuService.findAll(), device => device.nodeId);
    const deploymentNames = this.deploymentNamesOf(await this.instanceService.findAll());

    return {
      nodes: nodes.map(node => ({
        nodeId: node.id,
        nodeName: node.name,
        nodeState: this.nodeService.getState(node),
        status: this.getINodeTelemetryStatus(node.id, devicesByNodeId.get(node.id) ?? [], deploymentNames),
      })),
      readAt: new Date(),
    };
  }

  /** Folds a burst of node readings into one read of the whole fleet. */
  async watchFleetTelemetry(): Promise<Observable<FleetTelemetryResponseDto>> {
    const opening = await this.getFleetTelemetry();

    return concat(
      of(opening),
      this.telemetryService.telemetryChanged().pipe(
        auditTime(FLEET_TELEMETRY_AUDIT_MS),
        exhaustMap(() => from(this.getFleetTelemetry()).pipe(catchError(error => this.skipFailedRead(error))))
      )
    );
  }

  /** Reads the opening status before returning, so an unknown node refuses rather than opening a stream. */
  async watchNodeTelemetryStatus(nodeId: number): Promise<Observable<NodeTelemetryStatusDto>> {
    const opening = await this.getNodeTelemetryStatus(nodeId);

    return concat(
      of(opening),
      this.telemetryService.telemetryChanged().pipe(
        filter(changedNodeId => changedNodeId === nodeId),
        concatMap(() => this.getNodeTelemetryStatus(nodeId))
      )
    );
  }

  /** One failed read leaves the stream open for the next reading, rather than closing every dashboard's. */
  private skipFailedRead(error: unknown): Observable<never> {
    this.logger.error({ error }, 'watchFleetTelemetry(): Failed to read the fleet');

    return EMPTY;
  }

  /** Keyed by instance key, so a process or a prediction can be named by the deployment it serves. */
  private deploymentNamesOf(instances: Instance[]): Map<string, string> {
    const names = new Map<string, string>();

    for (const instance of instances) {
      if (instance.deployment !== undefined) {
        names.set(instance.instanceKey, instance.deployment.name);
      }
    }

    return names;
  }

  private getINodeTelemetryStatus(
    nodeId: number,
    devices: Gpu[],
    deploymentNames: Map<string, string>
  ): NodeTelemetryStatusDto {
    const telemetry = this.telemetryService.getTelemetry(nodeId);
    const headroomBytes = this.vramLedgerService.headroomFor(nodeId);

    if (telemetry === null) {
      return {
        telemetryState: null,
        capturedAt: null,
        receivedAt: null,
        host: null,
        devices: devices.map(device => this.getIGpuTelemetry(nodeId, device, null, deploymentNames)),
        errors: [],
        headroomBytes,
      };
    }

    const metricsByDeviceKey = new Map(telemetry.devices.map(metrics => [metrics.deviceKey, metrics]));

    return {
      telemetryState: NODE_TELEMETRY_STATES[telemetry.telemetryState],
      capturedAt: new Date(telemetry.capturedAt),
      receivedAt: telemetry.receivedDate,
      host: this.getINodeHostTelemetry(telemetry.host),
      devices: devices.map(device =>
        this.getIGpuTelemetry(nodeId, device, metricsByDeviceKey.get(device.deviceKey) ?? null, deploymentNames)
      ),
      errors: telemetry.errors.map(error => this.getIGpuTelemetryError(error)),
      headroomBytes,
    };
  }

  private getIGpuTelemetry(
    nodeId: number,
    device: Gpu,
    metrics: GpuDeviceMetrics | null,
    deploymentNames: Map<string, string>
  ): GpuTelemetryDto {
    return {
      deviceKey: device.deviceKey,
      vendor: GPU_VENDORS[device.vendor],
      name: device.name,
      pciBusId: device.pciBusId,
      memoryTotalBytes: device.memoryTotalBytes,
      lastReportedDate: device.lastReportedDate,

      index: device.index ?? metrics?.index ?? null,
      memoryUsedBytes: metrics?.memoryUsedBytes ?? null,
      utilisationPercent: metrics?.utilisationPercent ?? null,
      temperatureC: metrics?.temperatureC ?? null,
      powerDrawWatts: metrics?.powerDrawWatts ?? null,
      processAttribution: metrics === null ? null : GPU_PROCESS_ATTRIBUTIONS[metrics.processAttribution],
      processes:
        metrics === null ? [] : metrics.processes.map(process => this.getIGpuProcess(process, deploymentNames)),
      predictions: this.vramLedgerService.predictionsOn(nodeId, device.deviceKey).map(prediction => ({
        instanceKey: prediction.instanceKey,
        deploymentName: deploymentNames.get(prediction.instanceKey) ?? null,
        bytes: prediction.bytes,
      })),
    };
  }

  private getINodeHostTelemetry(host: HostResources): NodeHostTelemetryDto {
    return {
      cpuModel: host.cpuModel,
      cpuCount: host.cpuCount,
      loadAverage1m: host.loadAverage1m,
      memoryTotalBytes: host.memoryTotalBytes,
      memoryFreeBytes: host.memoryFreeBytes,
      modelDirectories: (host.modelDirectories ?? []).map(directory => this.getIModelDirectorySpace(directory)),
    };
  }

  private getIModelDirectorySpace(directory: ModelDirectorySpace): ModelDirectorySpaceDto {
    const writeAccess = directory.writeAccess ?? null;

    return {
      path: directory.path,
      freeBytes: directory.freeBytes,
      totalBytes: directory.totalBytes,
      writeAccess: writeAccess === null ? null : MODEL_DIRECTORY_WRITE_ACCESSES[writeAccess],
    };
  }

  private getIGpuProcess(process: GpuProcess, deploymentNames: Map<string, string>): GpuProcessDto {
    const instanceKey = process.instanceKey ?? null;

    return {
      pid: process.pid,
      usedBytes: process.usedBytes,
      name: process.name,
      containerId: process.containerId,
      containerName: process.containerName,
      instanceKey,
      deploymentName: instanceKey === null ? null : (deploymentNames.get(instanceKey) ?? null),
    };
  }

  private getIGpuTelemetryError(error: TelemetryError): GpuTelemetryErrorDto {
    return {
      scope: GPU_TELEMETRY_ERROR_SCOPES[error.scope],
      deviceKey: error.deviceKey,
      metric: error.metric,
      message: error.message,
    };
  }
}
