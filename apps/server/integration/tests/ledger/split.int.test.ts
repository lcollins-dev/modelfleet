import { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it } from 'vitest';

import { GIB } from '@libs/backends';
import { UserRoleId } from '@libs/dto';

import { InstanceService } from '@/core/instance/instance.service';

import { login } from '../../clients/user.client';
import { ITestUser, createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import {
  ESTIMABLE_METADATA,
  IDeployedModel,
  deployOnCards,
  registerNodeWithCards,
  reportCards,
} from '../../utils/ledger';

const CARD_A = 'GPU-aaaaaaaa-2222-3333-4444-555555555555';
const CARD_B = 'GPU-bbbbbbbb-2222-3333-4444-555555555555';

const MODEL: IDeployedModel = { sizeBytes: 10 * GIB, metadata: ESTIMABLE_METADATA };

describe('A split across cards (integration)', () => {
  let app: NestExpressApplication;
  let admin: ITestUser;
  let adminToken: string;
  let instanceService: InstanceService;

  beforeAll(async () => {
    app = await bootstrapApp();

    admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    instanceService = app.get(InstanceService);
  });

  it("refuses an operator's split that overruns one card though the cards together have room, naming it", async () => {
    const nodeId = await registerNodeWithCards(app, adminToken, [CARD_A, CARD_B]);
    const deploymentId = await deployOnCards(app, adminToken, nodeId, [CARD_A, CARD_B], {
      ...MODEL,
      document: 'tensorSplit: [1, 0]',
    });

    await reportCards(app, nodeId, [
      { deviceKey: CARD_A, usedBytes: 16 * GIB },
      { deviceKey: CARD_B, usedBytes: 0 },
    ]);

    const outcome = await instanceService.start(deploymentId, admin.id);

    expect(outcome.started).toHaveLength(0);
    expect(outcome.refused[0].problem).toMatch(
      new RegExp(`^This deployment needs \\d+\\.\\d GiB on ${CARD_A}, more than it has free$`)
    );
  });
});
