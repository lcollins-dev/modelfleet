import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListInstanceDto } from '@libs/dto';
import { InstanceState, NodeState } from '@libs/dto';

import {
  countInstanceStates,
  formatDevices,
  formatInstanceFailure,
  formatInstanceKey,
  formatInstanceState,
  formatUptime,
  instanceStateTone,
} from './instance';

const instance = (overrides: Partial<ListInstanceDto> = {}): ListInstanceDto => ({
  instanceKey: 'a',
  deploymentId: 1,
  deploymentName: 'llama-70b-chat',
  nodeId: 1,
  nodeName: 'gpu-1',
  nodeState: NodeState.ONLINE,
  devices: [{ deviceKey: 'GPU-4f2c', name: 'NVIDIA A100-SXM4-80GB' }],
  state: InstanceState.READY,
  message: null,
  exitCode: null,
  startedDate: null,
  reportedDate: null,
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
  ...overrides,
});

describe('formatInstanceKey', () => {
  it('shortens the key to its random tail, which replicas started together do not share', () => {
    expect(formatInstanceKey('0199a3f2-6c1e-7b4a-9f00-3d2e1c0b9a87')).toBe('1c0b9a87');
  });
});

describe('instanceStatePresentation', () => {
  it('reads a starting instance as in progress rather than as broken', () => {
    expect(formatInstanceState(InstanceState.STARTING)).toBe('Starting');
    expect(instanceStateTone(InstanceState.STARTING)).toBe('warning');
  });

  it('separates a ready instance from a failed one', () => {
    expect(instanceStateTone(InstanceState.READY)).toBe('success');
    expect(instanceStateTone(InstanceState.FAILED)).toBe('error');
  });
});

describe('formatInstanceFailure', () => {
  it('names the exit code of a backend that exited, and a launch that never ran one', () => {
    expect(formatInstanceFailure(instance({ state: InstanceState.FAILED, exitCode: 1 }))).toBe('The backend exited 1');
    expect(formatInstanceFailure(instance({ state: InstanceState.FAILED }))).toBe('The launch failed');
  });

  it('gives nothing for an instance that has not failed', () => {
    expect(formatInstanceFailure(instance())).toBeNull();
  });
});

describe('formatDevices', () => {
  it('reads an instance taking no device as running on the CPU', () => {
    expect(formatDevices([])).toBe('CPU');
  });

  it('names each device the node reported', () => {
    expect(
      formatDevices([
        { deviceKey: 'GPU-1111', name: 'NVIDIA A100-SXM4-80GB' },
        { deviceKey: 'GPU-2222', name: 'NVIDIA H100' },
      ])
    ).toBe('NVIDIA A100-SXM4-80GB, NVIDIA H100');
  });

  it('falls back to the device key where the node has stopped reporting the device', () => {
    expect(formatDevices([{ deviceKey: 'GPU-1111', name: null }])).toBe('GPU-1111');
  });
});

describe('formatUptime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads how long the container has been running', () => {
    expect(formatUptime(new Date('2026-08-20T10:45:30.000Z'))).toBe('1h 14m 30s');
  });

  it('reads nothing while the node has reported no uptime', () => {
    expect(formatUptime(null)).toBeNull();
  });
});

describe('countInstanceStates', () => {
  it('counts instances by state', () => {
    expect(countInstanceStates([instance({ state: InstanceState.FAILED }), instance({ instanceKey: 'b' })])).toEqual([
      { key: InstanceState.READY, count: 1 },
      { key: InstanceState.FAILED, count: 1 },
    ]);
  });

  it('counts nothing without instances', () => {
    expect(countInstanceStates([])).toEqual([]);
  });
});
