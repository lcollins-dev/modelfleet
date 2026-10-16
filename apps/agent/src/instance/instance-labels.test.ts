import { describe, expect, it } from 'vitest';

import { BackendId } from '@libs/backends';
import { ProbeMethod } from '@libs/backends';
import { BACKEND_LABEL, INSTANCE_LABEL } from '@libs/backends/runtime';

import {
  adoptionLabels,
  PORT_LABEL,
  PROBE_LABEL,
  readAdoption,
  readBackend,
  readInstanceKey,
  readRevision,
  REVISION_LABEL,
  START_TIMEOUT_LABEL,
} from '@/instance/instance-labels';
import { TEST_INSTANCE_KEY } from '@/test/instance.factory';

const ADOPTION = {
  revision: 2,
  probe: { method: ProbeMethod.GET, path: '/health', passStatuses: [200] },
  startTimeoutMs: 120_000,
  port: 8080,
};

const labelled = (overrides: Record<string, string> = {}) => ({
  [INSTANCE_LABEL]: TEST_INSTANCE_KEY,
  [BACKEND_LABEL]: BackendId.LLAMA_CPP,
  ...adoptionLabels(ADOPTION),
  ...overrides,
});

describe('instance labels', () => {
  it('reads back what it wrote, so a restarted agent supervises from the container alone', () => {
    expect(readInstanceKey(labelled())).toBe(TEST_INSTANCE_KEY);
    expect(readBackend(labelled())).toBe(BackendId.LLAMA_CPP);
    expect(readRevision(labelled())).toBe(2);
    expect(readAdoption(labelled())).toEqual({
      probe: ADOPTION.probe,
      startTimeoutMs: ADOPTION.startTimeoutMs,
      port: ADOPTION.port,
    });
  });

  it('reads no key from a container carrying none', () => {
    expect(readInstanceKey({})).toBeNull();
  });

  it('reads no key from a label that is not a uuid, which observed state could never carry', () => {
    expect(readInstanceKey(labelled({ [INSTANCE_LABEL]: 'someone-elses-container' }))).toBeNull();
  });

  it('reads no backend from a label naming one this agent does not know', () => {
    expect(readBackend(labelled({ [BACKEND_LABEL]: 'sglang' }))).toBeNull();
  });

  it('reads revision zero where the label is absent or unreadable', () => {
    expect(readRevision({})).toBe(0);
    expect(readRevision(labelled({ [REVISION_LABEL]: 'later' }))).toBe(0);
  });

  it('adopts nothing from a container missing any of what supervision needs', () => {
    expect(readAdoption(labelled({ [PROBE_LABEL]: 'not json' }))).toBeNull();
    expect(readAdoption(labelled({ [START_TIMEOUT_LABEL]: '0' }))).toBeNull();
    expect(readAdoption(labelled({ [PORT_LABEL]: 'eighty-eighty' }))).toBeNull();
  });
});
