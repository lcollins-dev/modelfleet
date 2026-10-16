import type { InstanceDeviceDto, ListInstanceDto } from '@libs/dto';
import { InstanceState } from '@libs/dto';

import { formatDuration } from './format/date';
import { ICount, orderCounts } from './format/number';

export type InstanceStateTone = 'success' | 'warning' | 'error';

const STATE_ORDER: InstanceState[] = [InstanceState.READY, InstanceState.STARTING, InstanceState.FAILED];

const LABELS: Record<InstanceState, string> = {
  [InstanceState.STARTING]: 'Starting',
  [InstanceState.READY]: 'Ready',
  [InstanceState.FAILED]: 'Failed',
};

/** A launch has its whole timeout to pass its probe, so starting reads as in progress rather than as a fault. */
const TONES: Record<InstanceState, InstanceStateTone> = {
  [InstanceState.STARTING]: 'warning',
  [InstanceState.READY]: 'success',
  [InstanceState.FAILED]: 'error',
};

/** A uuid v7 leads with its time, so replicas started together share a head and differ only in the tail. */
export const formatInstanceKey = (instanceKey: string): string => instanceKey.slice(-8);

export const formatInstanceState = (state: InstanceState): string => LABELS[state];

export const formatInstanceFailure = (instance: ListInstanceDto): string | null => {
  if (instance.state !== InstanceState.FAILED) {
    return null;
  }

  return instance.exitCode === null ? 'The launch failed' : `The backend exited ${instance.exitCode}`;
};

export const instanceStateTone = (state: InstanceState): InstanceStateTone => TONES[state];

/** An instance placed on the node's CPU takes no device, and reads as such rather than as an empty list. */
export const formatDevices = (devices: InstanceDeviceDto[]): string =>
  devices.length === 0 ? 'CPU' : devices.map(device => device.name ?? device.deviceKey).join(', ');

export const formatUptime = (startedDate: Date | null): string | null =>
  startedDate === null ? null : formatDuration((Date.now() - startedDate.getTime()) / 1000);

export const countInstanceStates = (instances: ListInstanceDto[]): ICount<InstanceState>[] => {
  const counts = new Map<InstanceState, number>();

  for (const instance of instances) {
    counts.set(instance.state, (counts.get(instance.state) ?? 0) + 1);
  }

  return orderCounts(STATE_ORDER, counts);
};
