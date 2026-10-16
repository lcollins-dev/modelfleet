import type { FleetNodeTelemetryDto, ListInstanceDto } from '@libs/dto';
import { NodeState } from '@libs/dto';

import { ICount, formatCount, orderCounts } from './format/number';
import { describeReading } from './gpu';

export type NodeStateTone = 'success' | 'warning' | 'error' | 'default';

const STATE_ORDER: NodeState[] = [NodeState.ONLINE, NodeState.OFFLINE, NodeState.REGISTERED, NodeState.DISABLED];

const LABELS: Record<NodeState, string> = {
  [NodeState.REGISTERED]: 'Awaiting first contact',
  [NodeState.ONLINE]: 'Online',
  [NodeState.OFFLINE]: 'Offline',
  [NodeState.DISABLED]: 'Disabled',
};

const TONES: Record<NodeState, NodeStateTone> = {
  [NodeState.REGISTERED]: 'default',
  [NodeState.ONLINE]: 'success',
  [NodeState.OFFLINE]: 'warning',
  [NodeState.DISABLED]: 'error',
};

export const formatNodeState = (state: NodeState): string => LABELS[state];

export const nodeStateTone = (state: NodeState): NodeStateTone => TONES[state];

export const countNodeStates = (states: NodeState[]): ICount<NodeState>[] => {
  const counts = new Map<NodeState, number>();

  for (const state of states) {
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  return orderCounts(STATE_ORDER, counts);
};

/** `nowMs` is on the server's clock, which a reading's `receivedAt` is read on. Null unless the node is online. */
export const describeFleetNode = (
  node: FleetNodeTelemetryDto,
  instances: ListInstanceDto[],
  nowMs: number
): string | null => {
  if (node.nodeState !== NodeState.ONLINE) {
    return null;
  }

  const gpus = node.status.devices.length;
  const running = instances.filter(instance => instance.nodeId === node.nodeId).length;
  const gpuLabel = gpus === 0 ? 'CPU only' : formatCount(gpus, 'GPU');

  return `${gpuLabel} · ${formatCount(running, 'instance')} · ${describeReading(node.status, nowMs)}`;
};
