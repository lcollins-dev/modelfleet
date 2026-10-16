import { z } from 'zod';

export const RELAY_INSTANCES_PREFIX = '/instances/';

export const RELAY_LOGS_PREFIX = '/logs/';

export const RELAY_MAX_LOG_TAIL = 10_000;

/** `true` where the tail reaches back to the container's first line, `false` otherwise. */
export const RELAY_TAIL_COMPLETE_HEADER = 'x-modelfleet-tail-complete';

const instanceKeySchema = z.uuid();

/** Everything llhttp allows in a request target, which excludes the control characters a smuggled request needs. */
const PRINTABLE_TARGET = /^[\u0021-\u00ff]+$/;

const KEY_END = /[/?]/;

const TAIL_DIGITS = /^\d{1,5}$/;

export interface IRelayRoute {
  instanceKey: string;
  path: string;
}

export interface IRelayLogsRoute {
  instanceKey: string;

  /** Null where the query carries no single integer from 0 to `RELAY_MAX_LOG_TAIL`. */
  tail: number | null;
}

interface IKeyedTarget {
  instanceKey: string;

  /** From the `/` or `?` that ends the key, or empty. */
  rest: string;
}

/** `path` is the backend's, leading slash included. */
export function relayPath(instanceKey: string, path: string): string {
  return `${RELAY_INSTANCES_PREFIX}${instanceKey}${path}`;
}

export function relayLogsPath(instanceKey: string, tail: number): string {
  return `${RELAY_LOGS_PREFIX}${instanceKey}?tail=${tail}`;
}

/** Null unless the target is `/instances/<instance key>/<backend path>`. */
export function readRelayRoute(target: string): IRelayRoute | null {
  const keyed = readKeyedTarget(target, RELAY_INSTANCES_PREFIX);

  if (keyed === null || !keyed.rest.startsWith('/')) {
    return null;
  }

  return { instanceKey: keyed.instanceKey, path: keyed.rest };
}

/** Null unless the target is `/logs/<instance key>`, with or without a query. */
export function readRelayLogsRoute(target: string): IRelayLogsRoute | null {
  const keyed = readKeyedTarget(target, RELAY_LOGS_PREFIX);

  if (keyed === null || (keyed.rest.length > 0 && !keyed.rest.startsWith('?'))) {
    return null;
  }

  const tails = new URLSearchParams(keyed.rest.slice(1)).getAll('tail');
  const tail = tails.length === 1 && TAIL_DIGITS.test(tails[0]) ? Number(tails[0]) : null;

  return { instanceKey: keyed.instanceKey, tail: tail !== null && tail <= RELAY_MAX_LOG_TAIL ? tail : null };
}

/** Null unless the target is printable and opens with `prefix` and an instance key. */
function readKeyedTarget(target: string, prefix: string): IKeyedTarget | null {
  if (!target.startsWith(prefix) || !PRINTABLE_TARGET.test(target)) {
    return null;
  }

  const afterPrefix = target.slice(prefix.length);
  const keyEnd = afterPrefix.search(KEY_END);
  const instanceKey = keyEnd < 0 ? afterPrefix : afterPrefix.slice(0, keyEnd);

  if (!instanceKeySchema.safeParse(instanceKey).success) {
    return null;
  }

  return { instanceKey, rest: keyEnd < 0 ? '' : afterPrefix.slice(keyEnd) };
}
