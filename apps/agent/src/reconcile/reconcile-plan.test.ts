import { describe, expect, it } from 'vitest';

import { DesiredInstance, InstanceState, ObservedInstance } from '@libs/agent-protocol';

import { isEmptyPlan, planReconciliation } from '@/reconcile/reconcile-plan';
import { buildDesiredInstance } from '@/test/instance.factory';

const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';

const desired = (instanceKey: string, revision = 1): DesiredInstance => buildDesiredInstance({ instanceKey, revision });

const actual = (instanceKey: string, revision = 1): ObservedInstance => ({
  instanceKey,
  revision,
  instanceState: InstanceState.READY,
  message: null,
  uptimeMs: null,
  exitCode: null,
});

describe('planReconciliation', () => {
  it('starts an instance the node does not hold', () => {
    const plan = planReconciliation([desired(KEY_A)], []);

    expect(plan.start).toEqual([desired(KEY_A)]);
    expect(plan.replace).toEqual([]);
    expect(plan.stop).toEqual([]);
  });

  it('stops an instance that has left desired state', () => {
    const plan = planReconciliation([], [actual(KEY_A)]);

    expect(plan.stop).toEqual([KEY_A]);
    expect(plan.start).toEqual([]);
  });

  it('replaces an instance the server has moved to a new revision', () => {
    const plan = planReconciliation([desired(KEY_A, 2)], [actual(KEY_A, 1)]);

    expect(plan.replace).toEqual([desired(KEY_A, 2)]);
    expect(plan.start).toEqual([]);
    expect(plan.stop).toEqual([]);
  });

  it('plans nothing where the node already matches desired state', () => {
    const plan = planReconciliation([desired(KEY_A), desired(KEY_B)], [actual(KEY_A), actual(KEY_B)]);

    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('plans nothing for two empty sets', () => {
    expect(isEmptyPlan(planReconciliation([], []))).toBe(true);
  });

  it('separates each instance by what it needs, within one comparison', () => {
    const plan = planReconciliation([desired(KEY_A, 3), desired(KEY_B)], [actual(KEY_A, 1)]);

    expect(plan.replace).toEqual([desired(KEY_A, 3)]);
    expect(plan.start).toEqual([desired(KEY_B)]);
    expect(plan.stop).toEqual([]);
  });
});
