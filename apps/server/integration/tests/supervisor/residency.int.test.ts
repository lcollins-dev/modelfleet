import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentRelay } from '@libs/agent-protocol';
import { BackendId, GIB } from '@libs/backends';
import { ActivationPolicy, BatchJobId, EventType, InstanceChangeReason, UserRoleId } from '@libs/dto';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { BatchJobService } from '@/core/batch-job/batch-job.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { InstanceService } from '@/core/instance/instance.service';
import { DeploymentSupervisorService } from '@/core/supervisor/deployment-supervisor.service';

import {
  createDeployment,
  getOutOfDateDeployments,
  restartDeployment,
  restartDeployments,
  updateDeployment,
} from '../../clients/deployment.client';
import { getDeploymentInstances } from '../../clients/instance.client';
import { registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { ITestUser, createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { ESTIMABLE_METADATA, reportCard } from '../../utils/ledger';

const DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';

const WEIGHTS_PATH = '/srv/models/llama-3-8b.gguf';

/** `SCHEDULER_LAUNCH_FAILURE_LIMIT` as the suite boots, which sets none. */
const LAUNCH_FAILURE_LIMIT = 10;

interface IInstanceRow {
  id: number;
  instanceKey: string;
  instanceState: string;
}

interface IEventRow {
  type: string;
  message: string;
  detail: {
    name?: string;
    reason?: string;
    problem?: string;
    expectedBytes?: number;
    cards?: string;
    launchFailures?: number;
    output?: string;
  };
}

describe('Deployment supervisor residency (integration)', () => {
  let app: NestExpressApplication;
  let admin: ITestUser;
  let adminToken: string;
  let batchJobService: BatchJobService;
  let deploymentService: DeploymentService;
  let instanceService: InstanceService;
  let deploymentSupervisorService: DeploymentSupervisorService;

  const documentFor = (nodeId: number, keys = ''): string =>
    `image: ghcr.io/ggml-org/llama.cpp:server-cuda
contextSize: 4096
${keys}placement:
  gpus:
    - nodeId: ${nodeId}
      deviceKey: ${DEVICE_KEY}
`;

  const insertModel = async (): Promise<number> => {
    const rows = await dbQuery<{ id: number }>(
      app,
      `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name", "ggufMetadata")
       VALUES ($1, 'gguf', 'model', 1000, 1, 'Llama 3 8B', $2) RETURNING id`,
      [randomUUID().replaceAll('-', '').padEnd(64, '0'), JSON.stringify(ESTIMABLE_METADATA)]
    );

    return rows[0].id;
  };

  const registerWithDevice = async (totalBytes?: number): Promise<number> => {
    const response = await registerNode(app, adminToken, { name: `node-${randomUUID()}` }).expect(201);
    const nodeId: number = response.body.id;

    await dbQuery(
      app,
      `INSERT INTO "gpu" ("nodeId", "deviceKey", "vendor", "lastReportedDate") VALUES ($1, $2, 'nvidia', now())`,
      [nodeId, DEVICE_KEY]
    );

    await dbQuery(app, 'UPDATE "node" SET "lastSeenDate" = now() WHERE id = $1', [nodeId]);
    await reportCard(app, nodeId, DEVICE_KEY, { totalBytes });

    return nodeId;
  };

  const place = async (
    activationPolicy: ActivationPolicy,
    options: { holdsModel?: boolean; keys?: string; totalBytes?: number } = {}
  ): Promise<number> => {
    const nodeId = await registerWithDevice(options.totalBytes);
    const modelId = await insertModel();

    if (options.holdsModel !== false) {
      await dbQuery(
        app,
        `INSERT INTO "availability" ("modelId", "nodeId", "path", "lastConfirmedDate") VALUES ($1, $2, $3, now())`,
        [modelId, nodeId, WEIGHTS_PATH]
      );
    }

    const deployment = await createDeployment(app, adminToken, {
      name: `deployment-${randomUUID()}`,
      modelId,
      backend: BackendId.LLAMA_CPP,
      activationPolicy,
      document: documentFor(nodeId, options.keys ?? ''),
    }).expect(201);

    return deployment.body.id;
  };

  const instancesOf = (deploymentId: number): Promise<IInstanceRow[]> =>
    dbQuery<IInstanceRow>(
      app,
      'SELECT "id", "instanceKey", "instanceState" FROM "instance" WHERE "deploymentId" = $1 ORDER BY "instanceKey"',
      [deploymentId]
    );

  const eventsOf = (deploymentId: number, type: EventType): Promise<IEventRow[]> =>
    dbQuery<IEventRow>(
      app,
      `SELECT "type", "message", "detail" FROM "event"
       WHERE "subjectType" = 'deployment' AND "subjectId" = $1 AND "type" = $2 ORDER BY id`,
      [`${deploymentId}`, type]
    );

  const failuresOf = async (deploymentId: number): Promise<number> =>
    (
      await dbQuery<{ launchFailures: number }>(app, 'SELECT "launchFailures" FROM "deployment" WHERE id = $1', [
        deploymentId,
      ])
    )[0].launchFailures;

  /** A run at the limit whose last failure is an hour old, so no backoff is what holds a start back. */
  const givenUpOn = async (deploymentId: number): Promise<void> => {
    await dbQuery(
      app,
      `UPDATE "deployment"
       SET "launchFailures" = $2, "lastLaunchFailureDate" = now() - interval '1 hour', "lastLaunchFailure" = 'weights are corrupt'
       WHERE id = $1`,
      [deploymentId, LAUNCH_FAILURE_LIMIT]
    );
  };

  /** Puts the whole deployment behind its idle timeout: nothing has called it and its instances were ready an hour ago. */
  const idleForAnHour = async (deploymentId: number): Promise<void> => {
    await dbQuery(app, `UPDATE "deployment" SET "lastUsedDate" = now() - interval '1 hour' WHERE id = $1`, [
      deploymentId,
    ]);
    await dbQuery(
      app,
      `UPDATE "instance"
       SET "createdDate" = now() - interval '1 hour', "readyDate" = now() - interval '1 hour', "instanceState" = 'ready'
       WHERE "deploymentId" = $1`,
      [deploymentId]
    );
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    batchJobService = app.get(BatchJobService);
    deploymentService = app.get(DeploymentService);
    instanceService = app.get(InstanceService);
    // Cases reconcile their own deployment, not pass(): forks share one database, so a pass reaches other files' rows.
    deploymentSupervisorService = app.get(DeploymentSupervisorService);
  });

  it('starts an always deployment on the placement it declares', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toHaveLength(1);
  });

  it('takes no action on a second reconcile over unchanged state', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);
    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toHaveLength(1);
  });

  it('replaces an instance whose container exited, and says why in the event log', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);

    const [failed] = await instancesOf(deploymentId);
    await dbQuery(app, `UPDATE "instance" SET "instanceState" = 'failed' WHERE id = $1`, [failed.id]);

    await deploymentSupervisorService.reconcile(deploymentId);

    const replacements = await instancesOf(deploymentId);

    expect(replacements).toHaveLength(1);
    expect(replacements[0].instanceKey).not.toBe(failed.instanceKey);

    const stopped = await eventsOf(deploymentId, EventType.INSTANCE_STOPPED);

    expect(stopped.at(-1)?.detail.reason).toBe(InstanceChangeReason.INSTANCE_FAILED);
  });

  it('records the rule that started an instance, with no actor, since the loop acted', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);

    const started = await eventsOf(deploymentId, EventType.INSTANCE_STARTED);

    expect(started.at(-1)?.detail.reason).toBe(InstanceChangeReason.ALWAYS_POLICY);

    const rows = await dbQuery<{ actorType: string | null }>(
      app,
      `SELECT "actorType" FROM "event" WHERE "subjectId" = $1 AND "type" = $2 ORDER BY id DESC LIMIT 1`,
      [`${deploymentId}`, EventType.INSTANCE_STARTED]
    );

    expect(rows[0].actorType).toBeNull();
  });

  it('brings an always deployment back after a stop by hand, since a stop is not a hold', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);
    await instanceService.stop(deploymentId, admin.id);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toHaveLength(1);
  });

  it('leaves an onDemand deployment stopped after a stop by hand, since nothing is asking for it', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND);

    await instanceService.start(deploymentId, admin.id);
    await instanceService.stop(deploymentId, admin.id);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([]);
  });

  it('stops what a disabled deployment runs, and says why in the event log', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);
    await deploymentService.setEnabled(deploymentId, false, admin.id);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([]);

    const stopped = await eventsOf(deploymentId, EventType.INSTANCE_STOPPED);

    expect(stopped.at(-1)?.detail.reason).toBe(InstanceChangeReason.DEPLOYMENT_DISABLED);
  });

  it('starts nothing for a disabled always deployment', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentService.setEnabled(deploymentId, false, admin.id);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([]);
  });

  it('refuses a start by hand while the deployment is disabled', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentService.setEnabled(deploymentId, false, admin.id);

    await expect(instanceService.start(deploymentId, admin.id)).rejects.toThrow(/disabled/);
  });

  it('keeps an always deployment resident again once it is enabled', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentService.setEnabled(deploymentId, false, admin.id);
    await deploymentSupervisorService.reconcile(deploymentId);

    await deploymentService.setEnabled(deploymentId, true, admin.id);
    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toHaveLength(1);
  });

  it('stops an onDemand deployment idle past its timeout, and says so in the event log', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND);

    await instanceService.start(deploymentId, admin.id);
    await idleForAnHour(deploymentId);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([]);

    const stopped = await eventsOf(deploymentId, EventType.INSTANCE_STOPPED);

    expect(stopped.at(-1)?.detail.reason).toBe(InstanceChangeReason.IDLE_TIMEOUT);
  });

  it('stops an idle instance still starting on a node out of contact, which will report nothing more', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND);

    await instanceService.start(deploymentId, admin.id);
    await idleForAnHour(deploymentId);
    await dbQuery(
      app,
      `UPDATE "instance" SET "instanceState" = 'starting', "readyDate" = NULL WHERE "deploymentId" = $1`,
      [deploymentId]
    );

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([]);
  });

  it('counts idleness from when the newest instance became ready, not from when it was started', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND);

    await instanceService.start(deploymentId, admin.id);
    await idleForAnHour(deploymentId);
    await dbQuery(app, `UPDATE "instance" SET "readyDate" = now() WHERE "deploymentId" = $1`, [deploymentId]);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toHaveLength(1);
  });

  it('counts one failure per start however many of its replicas fail, and clears the run once one is ready', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND);
    const startedAt = new Date(Date.now() - 60_000);

    await deploymentService.recordLaunchFailure(deploymentId, startedAt, new Date(), 'first replica');
    await deploymentService.recordLaunchFailure(deploymentId, startedAt, new Date(), 'second replica');

    expect(await failuresOf(deploymentId)).toBe(1);

    await deploymentService.recordLaunchFailure(deploymentId, new Date(), new Date(Date.now() + 1000), 'next start');

    expect(await failuresOf(deploymentId)).toBe(2);

    await deploymentService.clearLaunchFailures(deploymentId);

    expect(await failuresOf(deploymentId)).toBe(0);
  });

  it('holds a failed always instance back from being replaced until its backoff has passed', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);
    await dbQuery(app, `UPDATE "instance" SET "instanceState" = 'failed' WHERE "deploymentId" = $1`, [deploymentId]);
    await deploymentService.recordLaunchFailure(deploymentId, new Date(0), new Date(), 'CUDA out of memory');

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([expect.objectContaining({ instanceState: 'failed' })]);

    await dbQuery(app, `UPDATE "deployment" SET "lastLaunchFailureDate" = now() - interval '1 hour' WHERE id = $1`, [
      deploymentId,
    ]);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([expect.objectContaining({ instanceState: 'starting' })]);
  });

  it('records giving up once, on the failed start that reaches the limit, naming the run and its output', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);
    const firstFailure = Date.now() - 3_600_000;

    for (let i = 0; i < LAUNCH_FAILURE_LIMIT; i++) {
      const failedAt = new Date(firstFailure + i * 60_000);

      await deploymentService.recordLaunchFailure(deploymentId, new Date(failedAt.getTime() - 1000), failedAt, 'bad');
    }

    // Another replica of the start that reached the limit, which moves the output on and counts nothing.
    await deploymentService.recordLaunchFailure(
      deploymentId,
      new Date(firstFailure),
      new Date(),
      'weights are corrupt'
    );

    await vi.waitFor(async () => expect(await eventsOf(deploymentId, EventType.DEPLOYMENT_GIVEN_UP)).toHaveLength(1));
    expect(await failuresOf(deploymentId)).toBe(LAUNCH_FAILURE_LIMIT);
    expect((await eventsOf(deploymentId, EventType.DEPLOYMENT_GIVEN_UP))[0].detail).toMatchObject({
      launchFailures: LAUNCH_FAILURE_LIMIT,
    });
  });

  it('clears the run on a start by hand and starts the deployment, whatever the run had reached', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS);

    await deploymentSupervisorService.reconcile(deploymentId);
    await dbQuery(app, `UPDATE "instance" SET "instanceState" = 'failed' WHERE "deploymentId" = $1`, [deploymentId]);
    await givenUpOn(deploymentId);

    await instanceService.start(deploymentId, admin.id);

    expect(await failuresOf(deploymentId)).toBe(0);
    expect(await instancesOf(deploymentId)).toEqual([expect.objectContaining({ instanceState: 'starting' })]);
  });

  it('leaves an onDemand deployment resident inside its timeout', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND);

    await instanceService.start(deploymentId, admin.id);
    await dbQuery(
      app,
      `UPDATE "instance" SET "instanceState" = 'ready', "readyDate" = now() - interval '5 minutes' WHERE "deploymentId" = $1`,
      [deploymentId]
    );

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toHaveLength(1);
  });

  it('honours the idle timeout the deployment names over the configured default', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND, { keys: 'idleTimeout: 2h\n' });

    await instanceService.start(deploymentId, admin.id);
    await idleForAnHour(deploymentId);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toHaveLength(1);
  });

  it('never starts an onDemand deployment, however long it has gone uncalled', async () => {
    const deploymentId = await place(ActivationPolicy.ON_DEMAND);

    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([]);
  });

  it('registers the batch job that schedules a pass, so nothing else has to hold a timer', async () => {
    const batchJob = await batchJobService.findWithThrow(BatchJobId.RESIDENCY);

    expect(batchJob.cronExpression).not.toBeNull();
  });

  it('leaves a deployment it cannot place alone, and says so once rather than on every reconcile', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS, { holdsModel: false });

    await deploymentSupervisorService.reconcile(deploymentId);
    await deploymentSupervisorService.reconcile(deploymentId);

    expect(await instancesOf(deploymentId)).toEqual([]);

    const refused = await eventsOf(deploymentId, EventType.INSTANCE_START_REFUSED);

    expect(refused).toHaveLength(1);
    expect(refused[0].detail.problem).toMatch(/is not stored on this node/);
  });

  it('records the figures the ledger refused a deployment on, once', async () => {
    const deploymentId = await place(ActivationPolicy.ALWAYS, { totalBytes: GIB });

    await deploymentSupervisorService.reconcile(deploymentId);
    await deploymentSupervisorService.reconcile(deploymentId);

    const refused = await eventsOf(deploymentId, EventType.INSTANCE_START_REFUSED);

    expect(refused).toHaveLength(1);
    expect(refused[0].detail.problem).toMatch(/Not enough GPU memory for/);
    expect(refused[0].detail.expectedBytes).toBeGreaterThan(0);
    expect(refused[0].detail.cards).toContain(`${DEVICE_KEY}: total 1.0 GiB`);
  });

  describe('restarting onto the latest settings', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** A relay is required to simulate a connected node in this suite. */
    const withRelay = () => {
      vi.spyOn(app.get(AgentConnectionService), 'relayFor').mockReturnValue({} as AgentRelay);
    };

    const edit = async (deploymentId: number, keys: string): Promise<void> => {
      const [deployment] = await dbQuery<{ name: string; modelId: number; nodeId: number; document: string }>(
        app,
        `SELECT d."name", d."modelId", i."nodeId", d."document"
         FROM "deployment" d JOIN "instance" i ON i."deploymentId" = d.id WHERE d.id = $1 LIMIT 1`,
        [deploymentId]
      );

      await updateDeployment(app, adminToken, deploymentId, {
        name: deployment.name,
        modelId: deployment.modelId,
        presetId: null,
        backend: BackendId.LLAMA_CPP,
        activationPolicy: ActivationPolicy.ALWAYS,
        description: '',
        document: documentFor(deployment.nodeId, keys),
      }).expect(200);
    };

    const running = async (): Promise<number> => {
      const deploymentId = await place(ActivationPolicy.ALWAYS);

      await deploymentSupervisorService.reconcile(deploymentId);
      await dbQuery(
        app,
        `UPDATE "instance" SET "instanceState" = 'ready', "readyDate" = now() WHERE "deploymentId" = $1`,
        [deploymentId]
      );

      return deploymentId;
    };

    const instancesRead = async (deploymentId: number) =>
      (await getDeploymentInstances(app, adminToken, deploymentId).expect(200)).body.instances as {
        onOlderSettings: boolean;
        restartRequested: boolean;
      }[];

    const outOfDate = async (): Promise<number> =>
      (await getOutOfDateDeployments(app, adminToken).expect(200)).body.outOfDate as number;

    it('flags instances on older settings and counts their deployments', async () => {
      const deploymentId = await running();
      const before = await outOfDate();

      await edit(deploymentId, 'threads: 4\n');

      const [instance] = await instancesRead(deploymentId);

      expect(instance.onOlderSettings).toBe(true);
      await expect(outOfDate()).resolves.toBe(before + 1);
    });

    it('keeps the instance revision current after hot-field changes', async () => {
      const deploymentId = await running();
      const [before] = await instancesOf(deploymentId);

      await edit(deploymentId, 'replicas: 1\nidleTimeout: 30m\nvramGib: 2\n');

      const [instance] = await instancesRead(deploymentId);

      expect(instance.onOlderSettings).toBe(false);
      expect((await instancesOf(deploymentId))[0].instanceKey).toBe(before.instanceKey);
    });

    it('restarts an idle instance with the latest settings and records the reason', async () => {
      withRelay();

      const deploymentId = await running();
      const [before] = await instancesOf(deploymentId);

      await edit(deploymentId, 'threads: 4\n');
      await restartDeployment(app, adminToken, deploymentId).expect(201);
      await deploymentSupervisorService.reconcile(deploymentId);

      const after = await dbQuery<{ instanceKey: string; configurationRevision: string; latest: string }>(
        app,
        `SELECT i."instanceKey", i."configurationRevision", d."configurationRevision" AS latest
         FROM "instance" i JOIN "deployment" d ON d.id = i."deploymentId" WHERE d.id = $1`,
        [deploymentId]
      );

      expect(after).toHaveLength(1);
      expect(after[0].instanceKey).not.toBe(before.instanceKey);
      expect(after[0].configurationRevision).toBe(after[0].latest);

      const [stopped] = await eventsOf(deploymentId, EventType.INSTANCE_STOPPED);

      expect(stopped.detail.reason).toBe(InstanceChangeReason.SETTINGS_CHANGED);
      expect(stopped.message).toContain('to restart it on the latest settings');
      expect(stopped.message).toContain(stopped.detail.name ?? 'a deployment name');
      expect(await eventsOf(deploymentId, EventType.DEPLOYMENT_RESTART_REQUESTED)).toHaveLength(1);
    });

    it('refuses before stopping anything when the latest settings would not fit', async () => {
      const deploymentId = await running();
      const [before] = await instancesOf(deploymentId);

      await edit(deploymentId, 'threads: 4\nvramGib: 4096\n');

      const response = await restartDeployment(app, adminToken, deploymentId).expect(400);

      expect(response.body.message).toContain('GPU memory');
      expect((await instancesOf(deploymentId))[0].instanceKey).toBe(before.instanceKey);
      expect((await instancesRead(deploymentId))[0].restartRequested).toBe(false);
    });

    it('leaves a failed instance out of the fleet count', async () => {
      const deploymentId = await running();

      await edit(deploymentId, 'threads: 4\n');

      const before = await outOfDate();

      await dbQuery(app, `UPDATE "instance" SET "instanceState" = 'failed' WHERE "deploymentId" = $1`, [deploymentId]);

      await expect(outOfDate()).resolves.toBe(before - 1);
    });

    it('requests fleet-wide restarts and reports capacity refusals', async () => {
      const fits = await running();
      const tooBig = await running();

      await edit(fits, 'threads: 4\n');
      await edit(tooBig, 'threads: 4\nvramGib: 4096\n');

      const response = await restartDeployments(app, adminToken).expect(201);

      expect(response.body.restarting).toBeGreaterThanOrEqual(1);
      expect(response.body.refused).toContainEqual(expect.objectContaining({ deploymentId: tooBig }));
      expect((await instancesRead(fits))[0].restartRequested).toBe(true);
      expect((await instancesRead(tooBig))[0].restartRequested).toBe(false);
    });

    describe('with the card nearly full', () => {
      const USED_BYTES = 20 * GIB;

      const nodeOf = async (deploymentId: number): Promise<number> =>
        (
          await dbQuery<{ nodeId: number }>(app, 'SELECT "nodeId" FROM "instance" WHERE "deploymentId" = $1', [
            deploymentId,
          ])
        )[0].nodeId;

      it('counts the instance memory as available for its replacement', async () => {
        const deploymentId = await running();
        const [instance] = await instancesOf(deploymentId);

        await reportCard(app, await nodeOf(deploymentId), DEVICE_KEY, {
          usedBytes: USED_BYTES,
          processes: [
            {
              pid: 4242,
              usedBytes: USED_BYTES,
              name: 'llama-server',
              containerId: null,
              containerName: null,
              instanceKey: instance.instanceKey,
            },
          ],
        });

        await edit(deploymentId, 'threads: 4\nvramGib: 16\n');

        await restartDeployment(app, adminToken, deploymentId).expect(201);
      });

      it('refuses when another instance holds the required memory', async () => {
        const deploymentId = await running();

        await reportCard(app, await nodeOf(deploymentId), DEVICE_KEY, { usedBytes: USED_BYTES });

        await edit(deploymentId, 'threads: 4\nvramGib: 16\n');

        await restartDeployment(app, adminToken, deploymentId).expect(400);
      });
    });
  });
});
