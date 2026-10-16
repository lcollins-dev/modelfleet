import {
  GpuProcessAttribution,
  GpuTelemetryDto,
  GpuProcessDto,
  NodeTelemetryStatusDto,
  PlacementCapacityDto,
  NodeTelemetryState,
} from '@libs/dto';

import { Config } from '@/Config';

import { formatDuration } from './format/date';
import { formatBytes } from './format/number';

export type GpuTone = 'success' | 'warning' | 'error' | 'default';

export interface IVramUsage {
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
}

export interface IAttributionTag {
  label: string;
  note: string;
}

const UNAVAILABLE_TAG: IAttributionTag = {
  label: 'Per-process memory unavailable',
  note:
    'No per-process memory is reported, so only device totals are shown. Either the vendor does not report it, ' +
    "or the agent cannot see the host's processes - a containerised agent needs pid: host.",
};

const INCOMPLETE_TAG: IAttributionTag = {
  label: 'Per-process memory incomplete',
  note: 'Some processes did not report their memory, so not all of it is attributed.',
};

const TELEMETRY_LABELS: Record<NodeTelemetryState, string> = {
  [NodeTelemetryState.OK]: 'Live',
  [NodeTelemetryState.DEGRADED]: 'Degraded',
};

/**
 * Any device's gap read as the whole node's, the worst first. A reader that cannot see processes only shows it on a
 * card holding memory, so an idle card on the same node reads exact.
 */
export const attributionTag = (devices: GpuTelemetryDto[]): IAttributionTag | null => {
  const attributions = devices.map(device => device.processAttribution);

  if (attributions.includes(GpuProcessAttribution.UNAVAILABLE)) {
    return UNAVAILABLE_TAG;
  }

  return attributions.includes(GpuProcessAttribution.APPROXIMATE) ? INCOMPLETE_TAG : null;
};

export const formatTelemetryState = (state: NodeTelemetryState | null): string =>
  state === null ? 'No readings' : TELEMETRY_LABELS[state];

export const gpuName = (device: GpuTelemetryDto): string => device.name ?? device.deviceKey;

/** The container it belongs to where one is known, else the executable rather than its whole path. */
export const processLabel = (process: GpuProcessDto): string => {
  if (process.containerName !== null) {
    return process.containerName;
  }

  if (process.name === null) {
    return `PID ${process.pid}`;
  }

  return (
    process.name
      .split('/')
      .filter(part => part !== '')
      .pop() ?? process.name
  );
};

export const usageTone = (percent: number | null): GpuTone => {
  if (percent === null) {
    return 'default';
  }

  if (percent >= 90) {
    return 'error';
  }

  if (percent >= 75) {
    return 'warning';
  }

  return 'success';
};

/** Pools the devices given. One missing either figure is left out, so the total never outruns what is measured. */
export const vramUsage = (devices: GpuTelemetryDto[]): IVramUsage => {
  let usedBytes = 0;
  let totalBytes = 0;

  for (const device of devices) {
    if (device.memoryUsedBytes === null || device.memoryTotalBytes === null) {
      continue;
    }

    usedBytes += device.memoryUsedBytes;
    totalBytes += device.memoryTotalBytes;
  }

  return { usedBytes, totalBytes, freeBytes: Math.max(0, totalBytes - usedBytes) };
};

/** `nowMs` is on the server's clock, which `receivedAt` is read on. Null where nothing has been received. */
export const readingAgeSeconds = (status: NodeTelemetryStatusDto, nowMs: number): number | null => {
  if (status.receivedAt === null) {
    return null;
  }

  return Math.max(0, Math.floor((nowMs - status.receivedAt.getTime()) / 1000));
};

/** A node reports every few seconds, so a reading older than a stream's freshness window has stopped arriving. */
export const isReadingStale = (status: NodeTelemetryStatusDto, nowMs: number): boolean => {
  const ageSeconds = readingAgeSeconds(status, nowMs);

  return ageSeconds !== null && ageSeconds * 1000 >= Config.SSE_STALE_MS;
};

export const describeReading = (status: NodeTelemetryStatusDto, nowMs: number): string => {
  const ageSeconds = readingAgeSeconds(status, nowMs);

  if (ageSeconds === null) {
    return 'waiting for readings';
  }

  const age = formatDuration(ageSeconds);

  if (isReadingStale(status, nowMs)) {
    return `reading stale · ${age} old`;
  }

  return status.telemetryState === NodeTelemetryState.DEGRADED ? `degraded, read ${age} ago` : `read ${age} ago`;
};

/** A card as admission reads it: a refusal's card, or a device with the node's headroom beside it. */
export interface ICardFigures {
  totalBytes: number | null;
  usedBytes: number | null;
  predictedBytes: number;
  headroomBytes: number;
}

export interface ICapacityShares {
  totalBytes: number;
  usedBytes: number | null;
  startingBytes: number;

  /** What used and starting leave of the configured headroom. */
  headroomBytes: number;

  /** After headroom, and never negative. */
  availableBytes: number | null;

  /** How far used and starting together run past the total. */
  overBytes: number;
}

/**
 * The card's total split in the order admission takes from it. Used and starting keep their true values, eating into
 * free and then headroom, so an over-committed card runs past its total rather than either being cut down. Null where
 * the total is unknown.
 */
export const capacityShares = (card: ICardFigures): ICapacityShares | null => {
  if (card.totalBytes === null) {
    return null;
  }

  const usedBytes = card.usedBytes === null ? null : Math.max(card.usedBytes, 0);
  const unheldBytes = card.totalBytes - (usedBytes ?? 0) - card.predictedBytes;

  return {
    totalBytes: card.totalBytes,
    usedBytes,
    startingBytes: card.predictedBytes,
    headroomBytes: Math.min(Math.max(unheldBytes, 0), card.headroomBytes),
    availableBytes: usedBytes === null ? null : Math.max(unheldBytes - card.headroomBytes, 0),
    overBytes: usedBytes === null ? 0 : Math.max(-unheldBytes, 0),
  };
};

export interface IStartingShare {
  /** Null where the instance has gone while its container stops. */
  deploymentName: string | null;

  bytes: number;
}

export interface IPooledCapacity {
  /** One per deployment, in the order first seen. */
  starting: IStartingShare[];

  headroomBytes: number;
  availableBytes: number;

  /** Summed per card, so one card's free never offsets another's overrun. */
  overBytes: number;
}

export const cardFigures = (device: GpuTelemetryDto, headroomBytes: number): ICardFigures => ({
  totalBytes: device.memoryTotalBytes,
  usedBytes: device.memoryUsedBytes,
  predictedBytes: device.predictions.reduce((sum, prediction) => sum + prediction.bytes, 0),
  headroomBytes,
});

/** Leaves out a device with nothing measured, as `vramUsage` does, so the two pool the same devices. */
export const pooledCapacity = (devices: GpuTelemetryDto[], headroomBytes: number): IPooledCapacity => {
  const starting = new Map<string | null, number>();
  let pooledHeadroomBytes = 0;
  let availableBytes = 0;
  let overBytes = 0;

  for (const device of devices) {
    const shares = capacityShares(cardFigures(device, headroomBytes));

    if (shares === null || shares.availableBytes === null) {
      continue;
    }

    for (const prediction of device.predictions) {
      starting.set(prediction.deploymentName, (starting.get(prediction.deploymentName) ?? 0) + prediction.bytes);
    }

    pooledHeadroomBytes += shares.headroomBytes;
    availableBytes += shares.availableBytes;
    overBytes += shares.overBytes;
  }

  return {
    starting: [...starting]
      .filter(([, bytes]) => bytes > 0)
      .map(([deploymentName, bytes]) => ({ deploymentName, bytes })),
    headroomBytes: pooledHeadroomBytes,
    availableBytes,
    overBytes,
  };
};

const bytesOrDash = (bytes: number | null): string => (bytes === null ? '-' : formatBytes(bytes));

/** Where the placement offloads, the pool holds the host weights too. */
export const pooledNeedBytes = (capacity: PlacementCapacityDto): number =>
  capacity.expectedBytes + (capacity.hostFreeBytes === null ? 0 : (capacity.hostWeights?.neededBytes ?? 0));

export const hostShortBytes = (capacity: PlacementCapacityDto): number =>
  capacity.hostWeights === null ? 0 : Math.max(capacity.hostWeights.neededBytes - capacity.hostWeights.freeBytes, 0);

export const describeCapacityNeed = (capacity: PlacementCapacityDto): string => {
  const needed = pooledNeedBytes(capacity);

  const pool =
    capacity.hostFreeBytes === null || capacity.availableBytes === null
      ? ''
      : `, including ${formatBytes(capacity.hostFreeBytes)} of system memory`;

  const lines = [`Needs ${formatBytes(needed)}`, `Free after headroom: ${bytesOrDash(capacity.availableBytes)}${pool}`];

  if (capacity.hostWeights !== null) {
    lines.push(
      `Weights kept in system memory: ${formatBytes(capacity.hostWeights.neededBytes)}, ` +
        `with ${formatBytes(capacity.hostWeights.freeBytes)} free`
    );
  }

  if (capacity.availableBytes !== null && capacity.availableBytes < needed) {
    lines.push(`Short by ${formatBytes(needed - capacity.availableBytes)}`);
  } else if (hostShortBytes(capacity) > 0) {
    lines.push(`Short by ${formatBytes(hostShortBytes(capacity))} of system memory`);
  }

  return lines.join('. ');
};
