import { describe, expect, it } from 'vitest';

import type { FleetNodeTelemetryDto, ListInstanceDto } from '@libs/dto';
import { GpuVendor, InstanceState, NodeState, NodeTelemetryState } from '@libs/dto';

import { countNodeStates, describeFleetNode, formatNodeState, nodeStateTone } from './node';

describe('nodeStatePresentation', () => {
  it('reads a node awaiting its agent as awaiting first contact', () => {
    expect(formatNodeState(NodeState.REGISTERED)).toBe('Awaiting first contact');
  });

  it('keeps a node awaiting first contact off the tones that read as broken', () => {
    expect(nodeStateTone(NodeState.REGISTERED)).toBe('default');
  });

  it('separates a node out of contact from one held back', () => {
    expect(nodeStateTone(NodeState.OFFLINE)).toBe('warning');
    expect(nodeStateTone(NodeState.DISABLED)).toBe('error');
  });

  it('marks a connected node as the one healthy state', () => {
    expect(nodeStateTone(NodeState.ONLINE)).toBe('success');
  });

  it('gives every state a label, a tone and an icon', () => {
    for (const state of Object.values(NodeState)) {
      expect(formatNodeState(state)).toBeTruthy();
      expect(nodeStateTone(state)).toBeTruthy();
    }
  });
});

describe('countNodeStates', () => {
  it('counts online nodes before offline ones, leaving out a state no node is in', () => {
    expect(countNodeStates([NodeState.OFFLINE, NodeState.ONLINE, NodeState.ONLINE])).toEqual([
      { key: NodeState.ONLINE, count: 2 },
      { key: NodeState.OFFLINE, count: 1 },
    ]);
  });

  it('counts nothing in an empty fleet', () => {
    expect(countNodeStates([])).toEqual([]);
  });
});

describe('describeFleetNode', () => {
  const NOW_MS = new Date('2026-09-22T12:00:20.000Z').getTime();

  const fleetNode = (nodeState = NodeState.ONLINE): FleetNodeTelemetryDto => ({
    nodeId: 1,
    nodeName: 'gpu-a-01',
    nodeState,
    status: {
      telemetryState: NodeTelemetryState.OK,
      capturedAt: new Date('2026-09-22T12:00:17.000Z'),
      receivedAt: new Date('2026-09-22T12:00:17.000Z'),
      host: null,
      devices: [
        {
          deviceKey: 'GPU-4f2c',
          vendor: GpuVendor.NVIDIA,
          name: 'NVIDIA A100-SXM4-80GB',
          pciBusId: null,
          memoryTotalBytes: null,
          lastReportedDate: new Date('2026-09-22T12:00:00.000Z'),
          index: 0,
          memoryUsedBytes: null,
          utilisationPercent: null,
          temperatureC: null,
          powerDrawWatts: null,
          processAttribution: null,
          processes: [],
          predictions: [],
        },
      ],
      errors: [],
      headroomBytes: 1024 ** 3,
    },
  });

  const resident = { nodeId: 1, state: InstanceState.READY } as ListInstanceDto;

  it('names its GPUs, its instances and how long ago it read', () => {
    expect(describeFleetNode(fleetNode(), [resident], NOW_MS)).toBe('1 GPU · 1 instance · read 3s ago');
  });

  it('describes nothing for a node that is not online, which its state tag covers', () => {
    expect(describeFleetNode(fleetNode(NodeState.OFFLINE), [], NOW_MS)).toBeNull();
  });
});
