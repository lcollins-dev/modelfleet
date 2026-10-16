import { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it } from 'vitest';

import { GIB } from '@libs/backends';
import { EventType, NodeTelemetryStatusDto, UserRoleId } from '@libs/dto';

import { InstanceService } from '@/core/instance/instance.service';

import { getNodeTelemetryStatus } from '../../clients/telemetry.client';
import { login } from '../../clients/user.client';
import { ITestUser, createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { deployOnCard, registerNodeWithCard, reportCard } from '../../utils/ledger';

const DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';

/** Room for one of the deployments below after headroom, each estimated at a little over 1 GiB, and not for two. */
const ONE_FITS_BYTES = 2.5 * GIB;

interface IEventRow {
  detail: Record<string, string | number>;
}

describe('VRAM admission (integration)', () => {
  let app: NestExpressApplication;
  let admin: ITestUser;
  let adminToken: string;
  let instanceService: InstanceService;

  const refusalsOf = (deploymentId: number): Promise<IEventRow[]> =>
    dbQuery<IEventRow>(
      app,
      `SELECT "detail" FROM "event" WHERE "subjectType" = 'deployment' AND "subjectId" = $1 AND "type" = $2`,
      [`${deploymentId}`, EventType.INSTANCE_START_REFUSED]
    );

  beforeAll(async () => {
    app = await bootstrapApp();

    admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    instanceService = app.get(InstanceService);
  });

  it('admits only one of two starts against one card decided in the same instant, and records why', async () => {
    const nodeId = await registerNodeWithCard(app, adminToken, DEVICE_KEY);
    const first = await deployOnCard(app, adminToken, nodeId, DEVICE_KEY);
    const second = await deployOnCard(app, adminToken, nodeId, DEVICE_KEY);

    await reportCard(app, nodeId, DEVICE_KEY, { totalBytes: ONE_FITS_BYTES });

    const outcomes = await Promise.all([
      instanceService.start(first, admin.id),
      instanceService.start(second, admin.id),
    ]);

    expect(outcomes.map(outcome => outcome.started.length).sort()).toEqual([0, 1]);

    const refused = outcomes.find(outcome => outcome.started.length === 0);
    const refusedId = refused === outcomes[0] ? first : second;
    const [event] = await refusalsOf(refusedId);

    expect(refused?.refused[0].problem).toMatch(
      /^This deployment needs 1\.\d GiB, more than the pinned GPUs have free$/
    );
    expect(Number(event.detail.availableBytes)).toBe(1.5 * GIB - Number(event.detail.expectedBytes));
    expect(event.detail.cards).toContain(`${DEVICE_KEY}: total 2.5 GiB, used 0.0 GiB, predicted 1.`);
  });

  it("shows what a starting instance holds on its card under its deployment's name", async () => {
    const nodeId = await registerNodeWithCard(app, adminToken, DEVICE_KEY);
    const deploymentId = await deployOnCard(app, adminToken, nodeId, DEVICE_KEY);

    await reportCard(app, nodeId, DEVICE_KEY, { totalBytes: ONE_FITS_BYTES });
    await instanceService.start(deploymentId, admin.id);

    const [deployment] = await dbQuery<{ name: string }>(app, 'SELECT "name" FROM "deployment" WHERE id = $1', [
      deploymentId,
    ]);
    const status = (await getNodeTelemetryStatus(app, adminToken, nodeId).expect(200)).body as NodeTelemetryStatusDto;

    expect(status.devices[0].predictions).toEqual([
      { instanceKey: expect.any(String), deploymentName: deployment.name, bytes: expect.any(Number) },
    ]);
  });
});
