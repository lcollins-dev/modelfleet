import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentObservedState, InstanceState } from '@libs/agent-protocol';

import { NodeStateService } from '@/core/node/node-state.service';

import { buildDesiredInstance } from '@/test/instance.factory';

const NODE_ID = 1;
const OTHER_NODE_ID = 2;
const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';

const report = (instanceKeys: string[], desiredGeneration: number | null = 1): AgentObservedState => ({
  desiredGeneration,
  instances: instanceKeys.map(instanceKey => ({
    instanceKey,
    revision: 1,
    instanceState: InstanceState.READY,
    endpoint: null,
    message: null,
    uptimeMs: null,
    exitCode: null,
  })),
});

describe('NodeStateService', () => {
  let nodeStateService: NodeStateService;

  beforeEach(() => {
    nodeStateService = new NodeStateService();
  });

  it('holds an empty desired set for a node nothing has been scheduled to', () => {
    expect(nodeStateService.getDesiredState(NODE_ID)).toEqual({ instances: [], generation: 0 });
  });

  it('raises the generation on each change, so a node can tell one push from the next', () => {
    nodeStateService.setDesiredInstances(NODE_ID, [buildDesiredInstance({ instanceKey: KEY_A })]);

    expect(nodeStateService.setDesiredInstances(NODE_ID, []).generation).toBe(2);
  });

  it('keeps the desired set of one node out of another', () => {
    nodeStateService.setDesiredInstances(NODE_ID, [buildDesiredInstance({ instanceKey: KEY_A })]);

    expect(nodeStateService.getDesiredState(OTHER_NODE_ID)).toEqual({ instances: [], generation: 0 });
  });

  it('announces the node whose desired state moved', () => {
    const onChange = vi.fn();
    nodeStateService.getDesiredStateChanges().subscribe(onChange);

    nodeStateService.setDesiredInstances(NODE_ID, []);

    expect(onChange).toHaveBeenCalledWith(NODE_ID);
  });

  it('reports a node that has never made contact as unknown', () => {
    expect(nodeStateService.getObserved(NODE_ID)).toBeNull();
  });

  it('replaces what it believed with the report, including instances it had given up on', () => {
    nodeStateService.replaceObserved(NODE_ID, report([KEY_A, KEY_B]));
    nodeStateService.replaceObserved(NODE_ID, report([KEY_B]));

    expect(nodeStateService.getObserved(NODE_ID)?.instances.map(instance => instance.instanceKey)).toEqual([KEY_B]);
  });

  it('makes a node out of contact unknown while leaving what it was told to run', () => {
    nodeStateService.setDesiredInstances(NODE_ID, [buildDesiredInstance({ instanceKey: KEY_A })]);
    nodeStateService.replaceObserved(NODE_ID, report([KEY_A]));

    nodeStateService.clearObserved(NODE_ID);

    expect(nodeStateService.getObserved(NODE_ID)).toBeNull();
    expect(nodeStateService.getDesiredState(NODE_ID).instances).toEqual([buildDesiredInstance({ instanceKey: KEY_A })]);
  });

  it('drops both states for a node that no longer exists', () => {
    nodeStateService.setDesiredInstances(NODE_ID, [buildDesiredInstance({ instanceKey: KEY_A })]);
    nodeStateService.replaceObserved(NODE_ID, report([KEY_A]));

    nodeStateService.forget(NODE_ID);

    expect(nodeStateService.getObserved(NODE_ID)).toBeNull();
    expect(nodeStateService.getDesiredState(NODE_ID)).toEqual({ instances: [], generation: 0 });
  });
});
