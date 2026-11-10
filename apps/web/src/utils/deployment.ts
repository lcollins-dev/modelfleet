import type {
  ConfigurationDocument,
  DeploymentResidencyDto,
  EffectiveConfigurationEntryDto,
  ListDeploymentDto,
  ListInstanceDto,
  PlacementEvictionDto,
  PlacementMeasuredDto,
  PlacementNodeDto,
} from '@libs/dto';
import {
  ActivationPolicy,
  ConfigurationSource,
  ExpectedUsageSource,
  InstanceState,
  PlacementProblemReason,
} from '@libs/dto';

import { formatDuration } from './format/date';
import { ICount, formatBytes, orderCounts } from './format/number';
import { capacityFigures, type IMemoryCell, type IMemoryFigures, memoryCells, UNKNOWN_MEMORY } from './gpu';
import { formatDevices } from './instance';

export type DeploymentRunState = 'ready' | 'starting' | 'failed' | 'idle';

export type DeploymentRunTone = 'success' | 'warning' | 'error' | 'default';

export interface IPlacementMemoryCell extends IMemoryCell {
  label: 'VRAM' | 'RAM';
  title: string | null;
}

export interface IPlacementMemory {
  vram: IPlacementMemoryCell;
  ram: IPlacementMemoryCell;
}

export interface IPlacementRow extends IPlacementMemory {
  nodeId: number;
  nodeName: string;
  fit: PlacementFit;
  reason: string | null;
  expandable: boolean;
  cards: IPlacementCardRow[];

  /** Null unless the pool takes in RAM. */
  poolRam: string | null;
}

export interface IPlacementCardRow {
  deviceKey: string;
  name: string | null;
  total: string;
  used: string;
  starting: string;
  headroom: string;

  /** Before headroom. */
  free: string;

  short: boolean;
}

export enum PlacementFit {
  FITS = 'fits',
  EVICTS = 'evicts',
  MAKING_ROOM = 'makingRoom',
  NOT_ENOUGH_VRAM = 'notEnoughVram',
  NOT_ENOUGH_RAM = 'notEnoughRam',
  MODEL_NOT_ON_NODE = 'modelNotOnNode',
  NO_READINGS = 'noReadings',
  GPU_NOT_MEASURED = 'gpuNotMeasured',
  CANNOT_RUN = 'cannotRun',
  HELD = 'held',
  CPU_ONLY = 'cpuOnly',
}

const RUN_STATE_ORDER: DeploymentRunState[] = ['ready', 'starting', 'failed', 'idle'];

const RUN_LABELS: Record<DeploymentRunState, string> = {
  ready: 'Ready',
  starting: 'Starting',
  failed: 'Failed',
  idle: 'Idle',
};

const RUN_TONES: Record<DeploymentRunState, DeploymentRunTone> = {
  ready: 'success',
  starting: 'warning',
  failed: 'error',
  idle: 'default',
};

const MAKING_ROOM_REASON = 'Waiting for the node to report freed memory.';

const FIT_LABELS: Record<PlacementFit, string> = {
  [PlacementFit.FITS]: 'Fits',
  [PlacementFit.EVICTS]: 'Fits after evicting',
  [PlacementFit.MAKING_ROOM]: 'Making room',
  [PlacementFit.NOT_ENOUGH_VRAM]: 'Not enough VRAM',
  [PlacementFit.NOT_ENOUGH_RAM]: 'Not enough RAM',
  [PlacementFit.MODEL_NOT_ON_NODE]: 'Model not on node',
  [PlacementFit.NO_READINGS]: 'No readings',
  [PlacementFit.GPU_NOT_MEASURED]: 'GPU not measured',
  [PlacementFit.CANNOT_RUN]: 'Cannot run here',
  [PlacementFit.HELD]: 'Running',
  [PlacementFit.CPU_ONLY]: 'CPU only',
};

const FIT_TONES: Record<PlacementFit, DeploymentRunTone> = {
  [PlacementFit.FITS]: 'success',
  [PlacementFit.EVICTS]: 'warning',
  [PlacementFit.MAKING_ROOM]: 'warning',
  [PlacementFit.NOT_ENOUGH_VRAM]: 'error',
  [PlacementFit.NOT_ENOUGH_RAM]: 'error',
  [PlacementFit.MODEL_NOT_ON_NODE]: 'warning',
  [PlacementFit.NO_READINGS]: 'warning',
  [PlacementFit.GPU_NOT_MEASURED]: 'warning',
  [PlacementFit.CANNOT_RUN]: 'warning',
  [PlacementFit.HELD]: 'default',
  [PlacementFit.CPU_ONLY]: 'default',
};

const REASON_FITS: Record<PlacementProblemReason, PlacementFit> = {
  [PlacementProblemReason.NOT_ENOUGH_VRAM]: PlacementFit.NOT_ENOUGH_VRAM,
  [PlacementProblemReason.NOT_ENOUGH_RAM]: PlacementFit.NOT_ENOUGH_RAM,
  [PlacementProblemReason.MODEL_NOT_ON_NODE]: PlacementFit.MODEL_NOT_ON_NODE,
  [PlacementProblemReason.NO_READINGS]: PlacementFit.NO_READINGS,
  [PlacementProblemReason.GPU_NOT_MEASURED]: PlacementFit.GPU_NOT_MEASURED,
  [PlacementProblemReason.OTHER]: PlacementFit.CANNOT_RUN,
};

const EXPECTED_USAGE_LABELS: Record<ExpectedUsageSource, string> = {
  [ExpectedUsageSource.CONFIGURED]: 'Configured',
  [ExpectedUsageSource.DECLARED]: 'Declared',
  [ExpectedUsageSource.ESTIMATED]: 'Estimated',
};

export const formatActivationPolicy = (policy: ActivationPolicy): string =>
  policy === ActivationPolicy.ALWAYS ? 'Always on' : 'On demand';

export const describeActivationPolicy = (policy: ActivationPolicy): string =>
  policy === ActivationPolicy.ALWAYS
    ? 'Start the deployment with the server and keep it running.'
    : 'Start the deployment when it receives a request. Stop it after its idle timeout.';

/** Null unless failed launches are holding the next start back. */
export const describeLaunchFailures = (residency: DeploymentResidencyDto, now = new Date()): string | null => {
  if (residency.launchFailures === 0 || residency.retryDate === null) {
    return null;
  }

  const waitSecs = Math.ceil((residency.retryDate.getTime() - now.getTime()) / 1000);

  if (waitSecs <= 0) {
    return null;
  }

  const launches =
    residency.launchFailures === 1 ? 'Last start failed' : `Last ${residency.launchFailures} starts failed`;

  return `${launches}. Retry available in ${formatDuration(waitSecs)}.`;
};

/** Empty where the deployment names no preset, since every entry is then attributed to the deployment. */
export const presetLayer = (entries: EffectiveConfigurationEntryDto[]): ConfigurationDocument => {
  const layer: ConfigurationDocument = {};

  for (const entry of entries) {
    if (entry.source === ConfigurationSource.DECLARATION) {
      continue;
    }

    if (entry.source === ConfigurationSource.PRESET) {
      layer[entry.key] = entry.value;
    } else if (entry.presetValue !== undefined) {
      layer[entry.key] = entry.presetValue;
    }
  }

  return layer;
};

/** Failed outranks starting, which outranks ready, so one broken replica is what the deployment reports. */
export const deploymentRunState = (deploymentId: number, instances: ListInstanceDto[]): DeploymentRunState => {
  const states = instances.filter(instance => instance.deploymentId === deploymentId).map(instance => instance.state);

  if (states.includes(InstanceState.FAILED)) {
    return 'failed';
  }

  if (states.includes(InstanceState.STARTING)) {
    return 'starting';
  }

  return states.includes(InstanceState.READY) ? 'ready' : 'idle';
};

export const formatDeploymentRunState = (state: DeploymentRunState): string => RUN_LABELS[state];

export const deploymentRunTone = (state: DeploymentRunState): DeploymentRunTone => RUN_TONES[state];

/** Idle is what the total leaves, since a deployment running nothing has no instance to count. */
export const countDeploymentRunStates = (total: number, instances: ListInstanceDto[]): ICount<DeploymentRunState>[] => {
  const running = new Set(instances.map(instance => instance.deploymentId));
  const counts = new Map<DeploymentRunState, number>();

  for (const deploymentId of running) {
    const state = deploymentRunState(deploymentId, instances);

    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  counts.set('idle', Math.max(0, total - running.size));

  return orderCounts(RUN_STATE_ORDER, counts);
};

/** A failure outranks the deployment being disabled, since it is what needs attention. */
export const describeDeploymentPlacement = (deployment: ListDeploymentDto, instances: ListInstanceDto[]): string => {
  const policy = formatActivationPolicy(deployment.activationPolicy);
  const own = instances.filter(instance => instance.deploymentId === deployment.id);
  const failed = own.find(instance => instance.state === InstanceState.FAILED);

  if (failed !== undefined) {
    const exit = failed.exitCode === null ? 'failed' : `exited ${failed.exitCode}`;

    return `${policy} · ${exit} on ${failed.nodeName}`;
  }

  if (!deployment.enabled) {
    return `${policy} · disabled`;
  }

  if (own.length === 0) {
    return `${policy} · not running`;
  }

  const placements = own.map(instance => `${instance.nodeName} (${formatDevices(instance.devices)})`);

  return `${policy} · on ${placements.join(', ')}`;
};

export const placementRows = (nodes: PlacementNodeDto[], makingRoomNodeIds: number[] = []): IPlacementRow[] =>
  nodes.map(node => {
    const capacity = node.capacity;
    const hostFreeBytes = capacity?.hostFreeBytes ?? null;
    const reason = placementReason(node, makingRoomNodeIds);
    const cards = (capacity?.cards ?? []).map(card => ({
      deviceKey: card.deviceKey,
      name: card.name,
      total: nonZeroBytes(card.totalBytes ?? 0),
      used: nonZeroBytes(card.usedBytes ?? 0),
      starting: nonZeroBytes(card.predictedBytes),
      headroom: nonZeroBytes(card.headroomBytes),
      free: nonZeroBytes(card.freeBytes ?? 0),
      short: card.short,
    }));

    return {
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      ...placementMemory(node, makingRoomNodeIds),
      fit: placementFit(node, makingRoomNodeIds),
      reason,
      expandable: reason !== null && (cards.length > 0 || hostFreeBytes !== null),
      cards,
      poolRam: hostFreeBytes === null ? null : formatBytes(hostFreeBytes),
    };
  });

export const placementReason = (node: PlacementNodeDto, makingRoomNodeIds: number[] = []): string | null => {
  if (placementFit(node, makingRoomNodeIds) === PlacementFit.MAKING_ROOM) {
    return MAKING_ROOM_REASON;
  }

  return node.evictions.length > 0 ? describeEvictions(node.evictions) : node.problem;
};

const nonZeroBytes = (bytes: number): string => (bytes > 0 ? formatBytes(bytes) : '-');

/** Reads the server's verdict rather than reaching its own, so the picker and the deployment screen agree. */
export const placementFit = (node: PlacementNodeDto, makingRoomNodeIds: number[] = []): PlacementFit => {
  const capacity = node.capacity;

  if (capacity !== null && makingRoomNodeIds.includes(node.nodeId) && node.running < node.replicas) {
    return PlacementFit.MAKING_ROOM;
  }

  if (node.evictions.length > 0) {
    return PlacementFit.EVICTS;
  }

  if (node.problem !== null) {
    return REASON_FITS[node.problemReason ?? PlacementProblemReason.OTHER];
  }

  if (capacity !== null) {
    return PlacementFit.FITS;
  }

  return node.devices.length === 0 ? PlacementFit.CPU_ONLY : PlacementFit.HELD;
};

export const formatPlacementFit = (fit: PlacementFit): string => FIT_LABELS[fit];

export const describeEviction = (eviction: PlacementEvictionDto): string =>
  `${eviction.deploymentName} (idle ${formatDuration(eviction.idleMs / 1000)}, ` +
  `frees ${formatBytes(eviction.releasedBytes)})`;

export const describeEvictions = (evictions: PlacementEvictionDto[]): string =>
  `Fits after evicting ${evictions.map(eviction => describeEviction(eviction)).join(', ')}`;

export const placementFitTone = (fit: PlacementFit): DeploymentRunTone => FIT_TONES[fit];

/** A refusal for one card marks VRAM short even where the pooled figure fits. */
export const placementMemory = (node: PlacementNodeDto, makingRoomNodeIds: number[] = []): IPlacementMemory => {
  if (node.measured !== null) {
    return measuredMemory(node.measured);
  }

  const figures = placementFigures(node);
  const { vram, ram } = figures === null ? { vram: UNKNOWN_MEMORY, ram: UNKNOWN_MEMORY } : memoryCells(figures);
  const fit = placementFit(node, makingRoomNodeIds);
  const marked = fit !== PlacementFit.MAKING_ROOM;

  return {
    vram: {
      ...vram,
      label: 'VRAM',
      short: marked && (vram.short || fit === PlacementFit.NOT_ENOUGH_VRAM),
      title: node.expectedUsage === null ? null : EXPECTED_USAGE_LABELS[node.expectedUsage.source],
    },
    ram: {
      ...ram,
      label: 'RAM',
      short: marked && (ram.short || fit === PlacementFit.NOT_ENOUGH_RAM),
      title: ramBreakdown(figures),
    },
  };
};

const measuredMemory = (measured: PlacementMeasuredDto): IPlacementMemory => ({
  vram: { ...measuredCell(measured.vramBytes), label: 'VRAM', title: null },
  ram: { ...measuredCell(measured.ramBytes), label: 'RAM', title: null },
});

const measuredCell = (bytes: number | null): IMemoryCell =>
  bytes === null || bytes === 0 ? UNKNOWN_MEMORY : { text: formatBytes(bytes), short: false };

const ramBreakdown = (figures: IMemoryFigures | null): string | null => {
  if (figures === null) {
    return null;
  }

  const pinnedBytes = figures.ramUsedBytes - figures.ramOverflowBytes - figures.ramCacheBytes;
  const parts = [
    ...(pinnedBytes > 0 ? [`CPU pinned ${formatBytes(pinnedBytes)}`] : []),
    ...(figures.ramOverflowBytes > 0 ? [`VRAM overflow ${formatBytes(figures.ramOverflowBytes)}`] : []),
    ...(figures.ramCacheBytes > 0 ? [`Prompt cache ≤${formatBytes(figures.ramCacheBytes)}`] : []),
  ];

  return parts.length === 0 ? null : parts.join(' · ');
};

export const describePlacementFit = (node: PlacementNodeDto): IPlacementMemoryCell[] => {
  const { vram, ram } = placementMemory(node);

  return [vram, ram].filter(cell => cell.text !== UNKNOWN_MEMORY.text);
};

const placementFigures = (node: PlacementNodeDto): IMemoryFigures | null => {
  if (node.capacity !== null) {
    return capacityFigures(node.capacity);
  }

  if (node.expectedUsage === null) {
    return null;
  }

  return {
    vramUsedBytes: node.expectedUsage.bytes,
    vramFreeBytes: null,
    ramUsedBytes: node.expectedUsage.hostResidentBytes + node.expectedUsage.hostCacheBytes,
    ramFreeBytes: null,
    ramOverflowBytes: 0,
    ramCacheBytes: node.expectedUsage.hostCacheBytes,
  };
};
