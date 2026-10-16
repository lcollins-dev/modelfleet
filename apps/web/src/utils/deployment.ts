import type {
  ConfigurationDocument,
  DeploymentResidencyDto,
  EffectiveConfigurationEntryDto,
  ListDeploymentDto,
  ListInstanceDto,
  PlacementNodeDto,
} from '@libs/dto';
import { ActivationPolicy, ConfigurationSource, ExpectedUsageSource, InstanceState, ResidencyRule } from '@libs/dto';

import { formatDuration, formatRelativeDate } from './format/date';
import { ICount, formatBytes, orderCounts } from './format/number';
import { describeCapacityNeed, hostShortBytes, pooledNeedBytes } from './gpu';
import { formatDevices } from './instance';

export type DeploymentRunState = 'ready' | 'starting' | 'failed' | 'idle';

export type DeploymentRunTone = 'success' | 'warning' | 'error' | 'default';

export interface IPlacementRow {
  nodeId: number;
  nodeName: string;
  source: ExpectedUsageSource | null;
  expected: string;
  free: string;
  offGpus: string;
  systemMemory: string;
  expectedShort: boolean;
  systemMemoryShort: boolean;
  fit: PlacementFit;
  reason: string | null;
  cards: IPlacementCardRow[];

  /** Null unless the pool takes in system memory. */
  poolSystemMemory: string | null;
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
}

export enum PlacementFit {
  FITS = 'fits',
  SHORT = 'short',
  BLOCKED = 'blocked',
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

const FIT_LABELS: Record<PlacementFit, string> = {
  [PlacementFit.FITS]: 'Fits',
  [PlacementFit.SHORT]: 'Does not fit',
  [PlacementFit.BLOCKED]: 'Cannot place',
  [PlacementFit.HELD]: 'Running',
  [PlacementFit.CPU_ONLY]: 'CPU only',
};

const FIT_TONES: Record<PlacementFit, DeploymentRunTone> = {
  [PlacementFit.FITS]: 'success',
  [PlacementFit.SHORT]: 'error',
  [PlacementFit.BLOCKED]: 'warning',
  [PlacementFit.HELD]: 'default',
  [PlacementFit.CPU_ONLY]: 'default',
};

const EXPECTED_USAGE_SOURCES: Record<ExpectedUsageSource, string> = {
  [ExpectedUsageSource.CONFIGURED]: 'the share of each GPU its backend is configured to take',
  [ExpectedUsageSource.DECLARED]: 'as declared on the deployment',
  [ExpectedUsageSource.MEASURED]: 'measured on an earlier run',
  [ExpectedUsageSource.ESTIMATED]: 'estimated from the model and configuration',
};

const EXPECTED_USAGE_LABELS: Record<ExpectedUsageSource, string> = {
  [ExpectedUsageSource.CONFIGURED]: 'Configured',
  [ExpectedUsageSource.DECLARED]: 'Declared',
  [ExpectedUsageSource.MEASURED]: 'Measured',
  [ExpectedUsageSource.ESTIMATED]: 'Estimated',
};

const EXPECTED_USAGE_TONES: Record<ExpectedUsageSource, DeploymentRunTone> = {
  [ExpectedUsageSource.CONFIGURED]: 'success',
  [ExpectedUsageSource.DECLARED]: 'default',
  [ExpectedUsageSource.MEASURED]: 'success',
  [ExpectedUsageSource.ESTIMATED]: 'default',
};

export const formatActivationPolicy = (policy: ActivationPolicy): string =>
  policy === ActivationPolicy.ALWAYS ? 'Always on' : 'On demand';

export const describeActivationPolicy = (policy: ActivationPolicy): string =>
  policy === ActivationPolicy.ALWAYS
    ? 'Start the deployment with the server and keep it running.'
    : 'Start the deployment when it receives a request. Stop it after its idle timeout.';

export const describeResidency = (residency: DeploymentResidencyDto, running: boolean): string => {
  if (residency.givenUp) {
    return (
      `Given up: the last ${residency.launchFailures} launches failed, so the scheduler will not start this ` +
      'deployment again until it is started by hand or its configuration changes.'
    );
  }

  const rule = describeResidencyRule(residency, running);
  const failures = describeLaunchFailures(residency);

  return failures === null ? rule : `${rule} ${failures}`;
};

/** Null unless failed launches are holding the next start back. */
export const describeLaunchFailures = (residency: DeploymentResidencyDto, now = new Date()): string | null => {
  if (residency.launchFailures === 0 || residency.retryDate === null) {
    return null;
  }

  const launches =
    residency.launchFailures === 1 ? 'Its last launch failed' : `Its last ${residency.launchFailures} launches failed`;
  const wait = formatDuration((residency.retryDate.getTime() - now.getTime()) / 1000);

  return `${launches}, so it is not started again for another ${wait}.`;
};

const describeResidencyRule = (residency: DeploymentResidencyDto, running: boolean): string => {
  const timeout = formatDuration((residency.idleTimeoutMs ?? 0) / 1000);

  if (residency.rule === ResidencyRule.DISABLED) {
    return running
      ? 'Disabled: the scheduler will stop this deployment after its current requests finish.'
      : 'Disabled: this deployment will not run until it is enabled.';
  }

  if (residency.rule === ResidencyRule.ALWAYS) {
    return running
      ? 'Always on: the scheduler keeps this deployment running and replaces any instance that exits.'
      : 'Always on: the scheduler will start this deployment during its next pass.';
  }

  if (!running) {
    return `On demand: the first request starts this deployment, and it stops after ${timeout} of inactivity.`;
  }

  if (residency.inFlight > 0) {
    const requests = residency.inFlight === 1 ? '1 request' : `${residency.inFlight} requests`;

    return `On demand: stops after ${timeout} of inactivity. It will remain running while serving ${requests}.`;
  }

  if (residency.lastUsedDate === null) {
    return `On demand: stops after ${timeout} of inactivity. It has not received a request yet.`;
  }

  return `On demand: stops after ${timeout} of inactivity. Last used ${formatRelativeDate(residency.lastUsedDate)}.`;
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

export const describeExpectedUsage = (node: PlacementNodeDto): string | null => {
  const usage = node.expectedUsage;

  if (usage === null) {
    return null;
  }

  const described =
    `Expected to take ${formatBytes(usage.bytes)} on ${node.nodeName}, ` + EXPECTED_USAGE_SOURCES[usage.source];

  return usage.hostWeightsBytes > 0
    ? `${described}, excluding ${formatBytes(usage.hostWeightsBytes)} kept off the GPUs`
    : described;
};

export const placementRows = (nodes: PlacementNodeDto[]): IPlacementRow[] =>
  nodes.map(node => {
    const usage = node.expectedUsage;
    const capacity = node.capacity;
    const availableBytes = capacity?.availableBytes ?? null;
    const hostWeights = capacity?.hostWeights ?? null;
    const hostFreeBytes = capacity?.hostFreeBytes ?? null;
    const fit = placementFit(node);

    const systemMemory =
      hostWeights === null
        ? nonZeroBytes(usage?.hostResidentBytes ?? 0)
        : `${formatBytes(hostWeights.neededBytes)} (${formatBytes(hostWeights.freeBytes)} free)`;

    return {
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      source: usage?.source ?? null,
      expected: usage === null ? '-' : formatBytes(usage.bytes),
      free: availableBytes === null ? '-' : formatBytes(availableBytes),
      offGpus: nonZeroBytes(usage?.hostWeightsBytes ?? 0),
      systemMemory,
      expectedShort: capacity !== null && availableBytes !== null && availableBytes < pooledNeedBytes(capacity),
      systemMemoryShort: capacity !== null && hostShortBytes(capacity) > 0,
      fit,
      reason: node.problem,
      cards: (capacity?.cards ?? []).map(card => ({
        deviceKey: card.deviceKey,
        name: card.name,
        total: nonZeroBytes(card.totalBytes ?? 0),
        used: nonZeroBytes(card.usedBytes ?? 0),
        starting: nonZeroBytes(card.predictedBytes),
        headroom: nonZeroBytes(card.headroomBytes),
        free: nonZeroBytes(card.freeBytes ?? 0),
      })),
      poolSystemMemory: hostFreeBytes === null ? null : formatBytes(hostFreeBytes),
    };
  });

export const formatExpectedUsageSource = (source: ExpectedUsageSource): string => EXPECTED_USAGE_LABELS[source];

export const expectedUsageSourceTone = (source: ExpectedUsageSource): DeploymentRunTone => EXPECTED_USAGE_TONES[source];

const nonZeroBytes = (bytes: number): string => (bytes > 0 ? formatBytes(bytes) : '-');

/** Reads the server's verdict rather than reaching its own, so the picker and the deployment screen agree. */
export const placementFit = (node: PlacementNodeDto): PlacementFit => {
  const capacity = node.capacity;

  if (node.problem !== null) {
    const short =
      capacity !== null &&
      ((capacity.availableBytes !== null && capacity.availableBytes < pooledNeedBytes(capacity)) ||
        hostShortBytes(capacity) > 0);

    return short ? PlacementFit.SHORT : PlacementFit.BLOCKED;
  }

  if (capacity !== null) {
    return PlacementFit.FITS;
  }

  return node.devices.length === 0 ? PlacementFit.CPU_ONLY : PlacementFit.HELD;
};

export const formatPlacementFit = (fit: PlacementFit): string => FIT_LABELS[fit];

export const placementFitTone = (fit: PlacementFit): DeploymentRunTone => FIT_TONES[fit];

/** A shortfall's refusal is left out, since the figures beside it already say it. */
export const describePlacementFit = (node: PlacementNodeDto): string[] => {
  const fit = placementFit(node);
  const lines = [describeExpectedUsage(node)];

  if (fit === PlacementFit.BLOCKED) {
    lines.push(node.problem);
  }

  if (node.capacity !== null) {
    lines.push(describeCapacityNeed(node.capacity));
  }

  return lines.filter(line => line !== null);
};
