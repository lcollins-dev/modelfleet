import {
  GpuVendor as ProtocolGpuVendor,
  ModelDirectoryWriteAccess as ProtocolModelDirectoryWriteAccess,
  ProcessAttribution,
  TelemetryErrorScope,
  TelemetryState,
} from '@libs/agent-protocol';
import {
  GpuProcessAttribution,
  GpuTelemetryErrorScope,
  GpuVendor,
  ModelDirectoryWriteAccess,
  NodeTelemetryState,
} from '@libs/dto';

export const GPU_VENDORS: Record<ProtocolGpuVendor, GpuVendor> = {
  [ProtocolGpuVendor.NVIDIA]: GpuVendor.NVIDIA,
};

export const GPU_PROCESS_ATTRIBUTIONS: Record<ProcessAttribution, GpuProcessAttribution> = {
  [ProcessAttribution.EXACT]: GpuProcessAttribution.EXACT,
  [ProcessAttribution.APPROXIMATE]: GpuProcessAttribution.APPROXIMATE,
  [ProcessAttribution.UNAVAILABLE]: GpuProcessAttribution.UNAVAILABLE,
};

export const NODE_TELEMETRY_STATES: Record<TelemetryState, NodeTelemetryState> = {
  [TelemetryState.OK]: NodeTelemetryState.OK,
  [TelemetryState.DEGRADED]: NodeTelemetryState.DEGRADED,
};

export const GPU_TELEMETRY_ERROR_SCOPES: Record<TelemetryErrorScope, GpuTelemetryErrorScope> = {
  [TelemetryErrorScope.PROVIDER]: GpuTelemetryErrorScope.PROVIDER,
  [TelemetryErrorScope.DEVICE]: GpuTelemetryErrorScope.DEVICE,
  [TelemetryErrorScope.METRIC]: GpuTelemetryErrorScope.METRIC,
};

export const MODEL_DIRECTORY_WRITE_ACCESSES: Record<ProtocolModelDirectoryWriteAccess, ModelDirectoryWriteAccess> = {
  [ProtocolModelDirectoryWriteAccess.WRITABLE]: ModelDirectoryWriteAccess.WRITABLE,
  [ProtocolModelDirectoryWriteAccess.READ_ONLY]: ModelDirectoryWriteAccess.READ_ONLY,
  [ProtocolModelDirectoryWriteAccess.DENIED]: ModelDirectoryWriteAccess.DENIED,
};
