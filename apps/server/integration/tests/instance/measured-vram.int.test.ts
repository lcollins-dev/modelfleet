import { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { GpuProcess } from '@libs/agent-protocol';
import { GIB } from '@libs/backends';
import { UserRoleId } from '@libs/dto';

import { InstanceService } from '@/core/instance/instance.service';
import { MeasuredVramService } from '@/core/instance/measured-vram.service';

import { login } from '../../clients/user.client';
import { ITestUser, createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { deployOnCard, registerNodeWithCard, reportCard } from '../../utils/ledger';

const DEVICE_KEY = 'GPU-66666666-2222-3333-4444-555555555555';

interface IMeasuredRow {
  bytes: string;
}

describe('Measured VRAM (integration)', () => {
  let app: NestExpressApplication;
  let admin: ITestUser;
  let adminToken: string;
  let instanceService: InstanceService;

  const startReady = async (deploymentId: number): Promise<{ instanceKey: string; revision: string }> => {
    const outcome = await instanceService.start(deploymentId, admin.id);
    const instance = outcome.started[0];

    await dbQuery(app, `UPDATE "instance" SET "instanceState" = 'ready' WHERE "instanceKey" = $1`, [
      instance.instanceKey,
    ]);

    return { instanceKey: instance.instanceKey, revision: instance.configurationRevision };
  };

  const holding = (instanceKey: string, usedBytes: number): GpuProcess => ({
    pid: 4242,
    usedBytes,
    name: 'llama-server',
    containerId: null,
    containerName: null,
    instanceKey,
  });

  const measuredOf = async (revision: string): Promise<number | null> => {
    const rows = await dbQuery<IMeasuredRow>(
      app,
      `SELECT "bytes" FROM "measured_vram" WHERE "configurationRevision" = $1 AND "gpuCount" = 1`,
      [revision]
    );

    return rows.length === 0 ? null : Number(rows[0].bytes);
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    instanceService = app.get(InstanceService);
  });

  it('admits the next start of a configuration on the most it measured, not on its estimate', async () => {
    const nodeId = await registerNodeWithCard(app, adminToken, DEVICE_KEY);
    const deploymentId = await deployOnCard(app, adminToken, nodeId, DEVICE_KEY);

    await reportCard(app, nodeId, DEVICE_KEY);

    const { instanceKey, revision } = await startReady(deploymentId);

    await vi.waitFor(async () => {
      await reportCard(app, nodeId, DEVICE_KEY, { usedBytes: 6 * GIB, processes: [holding(instanceKey, 6 * GIB)] });

      expect(await measuredOf(revision)).toBe(6 * GIB);
    });

    const onTwoCards = { cpu: false, gpus: [DEVICE_KEY, 'GPU-77777777-2222-3333-4444-555555555555'] };

    expect(await app.get(MeasuredVramService).rememberedFor(revision, onTwoCards)).toBeNull();

    await dbQuery(app, 'DELETE FROM "instance" WHERE "instanceKey" = $1', [instanceKey]);
    await reportCard(app, nodeId, DEVICE_KEY, { totalBytes: 4 * GIB });

    const outcome = await instanceService.start(deploymentId, admin.id);

    expect(outcome.started).toHaveLength(0);
    expect(outcome.refused[0].problem).toBe('This deployment needs 6.0 GiB, more than the pinned GPUs have free');
  });

  it('keeps a stored figure higher than a later measurement, and measures no instance still starting', async () => {
    const nodeId = await registerNodeWithCard(app, adminToken, DEVICE_KEY);

    await reportCard(app, nodeId, DEVICE_KEY);

    const remembered = await startReady(await deployOnCard(app, adminToken, nodeId, DEVICE_KEY));
    const barrier = await startReady(await deployOnCard(app, adminToken, nodeId, DEVICE_KEY));
    const starting = (await instanceService.start(await deployOnCard(app, adminToken, nodeId, DEVICE_KEY), admin.id))
      .started[0];

    await dbQuery(
      app,
      `INSERT INTO "measured_vram" ("configurationRevision", "gpuCount", "bytes") VALUES ($1, 1, $2)`,
      [remembered.revision, 9 * GIB]
    );

    // Every instance in a reading is measured in one pass, so the barrier's row marks the others as measured too.
    await vi.waitFor(async () => {
      await reportCard(app, nodeId, DEVICE_KEY, {
        processes: [
          holding(remembered.instanceKey, 5 * GIB),
          holding(starting.instanceKey, 3 * GIB),
          holding(barrier.instanceKey, 2 * GIB),
        ],
      });

      expect(await measuredOf(barrier.revision)).toBe(2 * GIB);
    });

    expect(await measuredOf(remembered.revision)).toBe(9 * GIB);
    expect(await measuredOf(starting.configurationRevision)).toBeNull();
  });
});
