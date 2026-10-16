import { describe, expect, it } from 'vitest';

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

import {
  GPU_PROCESS_ATTRIBUTIONS,
  GPU_TELEMETRY_ERROR_SCOPES,
  GPU_VENDORS,
  MODEL_DIRECTORY_WRITE_ACCESSES,
  NODE_TELEMETRY_STATES,
} from '@/api/v1/telemetry/types/mappings';

describe('GPU_VENDORS', () => {
  it.each([[ProtocolGpuVendor.NVIDIA, GpuVendor.NVIDIA]])('maps %s to %s', (reported, shown) => {
    expect(GPU_VENDORS[reported]).toBe(shown);
  });
});

describe('GPU_PROCESS_ATTRIBUTIONS', () => {
  it.each([
    [ProcessAttribution.EXACT, GpuProcessAttribution.EXACT],
    [ProcessAttribution.APPROXIMATE, GpuProcessAttribution.APPROXIMATE],
    [ProcessAttribution.UNAVAILABLE, GpuProcessAttribution.UNAVAILABLE],
  ])('maps %s to %s', (reported, shown) => {
    expect(GPU_PROCESS_ATTRIBUTIONS[reported]).toBe(shown);
  });
});

describe('NODE_TELEMETRY_STATES', () => {
  it.each([
    [TelemetryState.OK, NodeTelemetryState.OK],
    [TelemetryState.DEGRADED, NodeTelemetryState.DEGRADED],
  ])('maps %s to %s', (reported, shown) => {
    expect(NODE_TELEMETRY_STATES[reported]).toBe(shown);
  });
});

describe('GPU_TELEMETRY_ERROR_SCOPES', () => {
  it.each([
    [TelemetryErrorScope.PROVIDER, GpuTelemetryErrorScope.PROVIDER],
    [TelemetryErrorScope.DEVICE, GpuTelemetryErrorScope.DEVICE],
    [TelemetryErrorScope.METRIC, GpuTelemetryErrorScope.METRIC],
  ])('maps %s to %s', (reported, shown) => {
    expect(GPU_TELEMETRY_ERROR_SCOPES[reported]).toBe(shown);
  });
});

describe('MODEL_DIRECTORY_WRITE_ACCESSES', () => {
  it.each([
    [ProtocolModelDirectoryWriteAccess.WRITABLE, ModelDirectoryWriteAccess.WRITABLE],
    [ProtocolModelDirectoryWriteAccess.READ_ONLY, ModelDirectoryWriteAccess.READ_ONLY],
    [ProtocolModelDirectoryWriteAccess.DENIED, ModelDirectoryWriteAccess.DENIED],
  ])('maps %s to %s', (reported, shown) => {
    expect(MODEL_DIRECTORY_WRITE_ACCESSES[reported]).toBe(shown);
  });
});
