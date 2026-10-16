import { describe, expect, it } from 'vitest';

import { InstanceState as ProtocolInstanceState } from '@libs/agent-protocol';
import { InstanceState } from '@libs/dto';

import { INSTANCE_STATES } from '@/api/v1/instance/types/mappings';

describe('INSTANCE_STATES', () => {
  it.each([
    [ProtocolInstanceState.STARTING, InstanceState.STARTING],
    [ProtocolInstanceState.READY, InstanceState.READY],
    [ProtocolInstanceState.FAILED, InstanceState.FAILED],
  ])('maps %s to %s', (reported, shown) => {
    expect(INSTANCE_STATES[reported]).toBe(shown);
  });
});
