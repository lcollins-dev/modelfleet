import { DesiredInstance, ObservedInstance } from '@libs/agent-protocol';

export interface IReconcilePlan {
  start: DesiredInstance[];
  replace: DesiredInstance[];
  stop: string[];
}

export function isEmptyPlan(plan: IReconcilePlan): boolean {
  return plan.start.length === 0 && plan.replace.length === 0 && plan.stop.length === 0;
}

export function planReconciliation(
  desired: readonly DesiredInstance[],
  actual: readonly ObservedInstance[]
): IReconcilePlan {
  const actualByKey = new Map(actual.map(instance => [instance.instanceKey, instance]));
  const desiredKeys = new Set(desired.map(instance => instance.instanceKey));

  const start: DesiredInstance[] = [];
  const replace: DesiredInstance[] = [];

  for (const instance of desired) {
    const held = actualByKey.get(instance.instanceKey);

    if (held === undefined) {
      start.push(instance);
    } else if (held.revision !== instance.revision) {
      replace.push(instance);
    }
  }

  const stop = actual.filter(instance => !desiredKeys.has(instance.instanceKey)).map(({ instanceKey }) => instanceKey);

  return { start, replace, stop };
}
