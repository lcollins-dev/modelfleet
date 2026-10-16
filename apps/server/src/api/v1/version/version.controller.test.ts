import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';

import { ConfigService } from '@/config/config.service';

import { VersionController } from '@/api/v1/version/version.controller';

describe('VersionController', () => {
  let controller: VersionController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VersionController],
      providers: [{ provide: ConfigService, useValue: { version: '1.2.3' } }],
    }).compile();

    controller = moduleRef.get(VersionController);
  });

  it('reports the configured version', () => {
    expect(controller.getVersion()).toEqual({ version: '1.2.3' });
  });

  it('is reachable without a session', () => {
    expect(Reflect.getMetadata(NO_AUTH_METADATA_KEY, VersionController)).toBe(true);
  });
});
