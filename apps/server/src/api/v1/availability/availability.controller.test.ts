import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';

import { AvailabilityController } from '@/api/v1/availability/availability.controller';

describe('AvailabilityController', () => {
  let controller: AvailabilityController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AvailabilityController],
    }).compile();

    controller = moduleRef.get(AvailabilityController);
  });

  it('reports the app as available', () => {
    expect(controller.getAvailability()).toEqual({ available: true });
  });

  it('is reachable without a session', () => {
    expect(Reflect.getMetadata(NO_AUTH_METADATA_KEY, AvailabilityController)).toBe(true);
  });
});
