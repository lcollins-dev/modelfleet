import { beforeEach, describe, expect, it } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';

import { IInstanceReach, InstanceEndpointService } from '@/instance/instance-endpoint.service';
import { TEST_INSTANCE_KEY } from '@/test/instance.factory';

const OTHER_INSTANCE_KEY = '44444444-4444-4444-8444-444444444444';

const ready: IInstanceReach = {
  instanceState: InstanceState.READY,
  address: { host: '198.51.100.4', port: 8080 },
};

describe('InstanceEndpointService', () => {
  let instanceEndpointService: InstanceEndpointService;

  beforeEach(() => {
    instanceEndpointService = new InstanceEndpointService();
  });

  it('holds nothing until a sweep has reported', () => {
    expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toBeNull();
  });

  it('resolves an instance a sweep reported', () => {
    instanceEndpointService.replace(new Map([[TEST_INSTANCE_KEY, ready]]));

    expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toEqual(ready);
  });

  it('stops resolving an instance the next sweep no longer holds', () => {
    instanceEndpointService.replace(new Map([[TEST_INSTANCE_KEY, ready]]));
    instanceEndpointService.replace(new Map([[OTHER_INSTANCE_KEY, ready]]));

    expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toBeNull();
    expect(instanceEndpointService.resolve(OTHER_INSTANCE_KEY)).toEqual(ready);
  });

  it('drops a stopped instance without waiting for the next sweep, and leaves the rest', () => {
    instanceEndpointService.replace(
      new Map([
        [TEST_INSTANCE_KEY, ready],
        [OTHER_INSTANCE_KEY, ready],
      ])
    );

    instanceEndpointService.forget(TEST_INSTANCE_KEY);

    expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toBeNull();
    expect(instanceEndpointService.resolve(OTHER_INSTANCE_KEY)).toEqual(ready);
  });
});
