import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { BackendId, IInstancePins } from '@libs/backends';
import { ActivationPolicy, UserRoleId } from '@libs/dto';

import { InstanceService } from '@/core/instance/instance.service';
import { NodeStateService } from '@/core/node/node-state.service';

import { createDeployment } from '../../clients/deployment.client';
import { deleteNode, registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { ITestUser, createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { ESTIMABLE_METADATA, reportCard } from '../../utils/ledger';

const DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';
const OTHER_DEVICE_KEY = 'GPU-99999999-9999-9999-9999-999999999999';

const WEIGHTS_PATH = '/srv/models/llama-3-8b.gguf';

interface IPlacedDeployment {
  deploymentId: number;
  nodeId: number;
  modelId: number;
}

describe('Instance lifecycle (integration)', () => {
  let app: NestExpressApplication;
  let admin: ITestUser;
  let adminToken: string;
  let instanceService: InstanceService;
  let nodeStateService: NodeStateService;

  const documentPinning = (nodeId: number, deviceKey: string): string =>
    `image: ghcr.io/ggml-org/llama.cpp:server-cuda
contextSize: 4096
placement:
  gpus:
    - nodeId: ${nodeId}
      deviceKey: ${deviceKey}
`;

  const documentOffloading = (nodeId: number, deviceKey: string): string =>
    `image: ghcr.io/ggml-org/llama.cpp:server-cuda
contextSize: 4096
placement:
  nodeIds:
    - ${nodeId}
  gpus:
    - nodeId: ${nodeId}
      deviceKey: ${deviceKey}
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

  const registerWithDevice = async (): Promise<number> => {
    const response = await registerNode(app, adminToken, { name: `node-${randomUUID()}` }).expect(201);
    const nodeId: number = response.body.id;

    await dbQuery(
      app,
      `INSERT INTO "gpu" ("nodeId", "deviceKey", "vendor", "lastReportedDate") VALUES ($1, $2, 'nvidia', now())`,
      [nodeId, DEVICE_KEY]
    );

    await dbQuery(app, 'UPDATE "node" SET "lastSeenDate" = now() WHERE id = $1', [nodeId]);
    await reportCard(app, nodeId, DEVICE_KEY);

    return nodeId;
  };

  const holdModel = (nodeId: number, modelId: number): Promise<unknown[]> =>
    dbQuery(
      app,
      `INSERT INTO "availability" ("modelId", "nodeId", "path", "lastConfirmedDate") VALUES ($1, $2, $3, now())`,
      [modelId, nodeId, WEIGHTS_PATH]
    );

  /** `onDemand`, so the supervisor starts nothing a case does not ask for. */
  const place = async (options: { holdsModel?: boolean; deviceKey?: string } = {}): Promise<IPlacedDeployment> => {
    const nodeId = await registerWithDevice();
    const modelId = await insertModel();

    if (options.holdsModel !== false) {
      await holdModel(nodeId, modelId);
    }

    const deployment = await createDeployment(app, adminToken, {
      name: `deployment-${randomUUID()}`,
      modelId,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ON_DEMAND,
      document: documentPinning(nodeId, options.deviceKey ?? DEVICE_KEY),
    }).expect(201);

    return { deploymentId: deployment.body.id, nodeId, modelId };
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    instanceService = app.get(InstanceService);
    nodeStateService = app.get(NodeStateService);
  });

  it('records the instance against the node and the hardware the deployment pins', async () => {
    const placed = await place();

    const [instance] = (await instanceService.start(placed.deploymentId, admin.id)).started;

    const rows = await dbQuery<{ nodeId: number; pins: IInstancePins; instanceState: string }>(
      app,
      'SELECT "nodeId", "pins", "instanceState" FROM "instance" WHERE "instanceKey" = $1',
      [instance.instanceKey]
    );

    expect(rows).toEqual([
      { nodeId: placed.nodeId, pins: { cpu: false, gpus: [DEVICE_KEY] }, instanceState: 'starting' },
    ]);
  });

  it("carries the node's own weights path and the backend's configuration to that node", async () => {
    const placed = await place();

    await instanceService.start(placed.deploymentId, admin.id);

    const [desired] = nodeStateService.getDesiredState(placed.nodeId).instances;

    expect(desired).toMatchObject({
      backend: BackendId.LLAMA_CPP,
      weightsPath: WEIGHTS_PATH,
      pins: { cpu: false, gpus: [DEVICE_KEY] },
      configuration: { contextSize: 4096 },
      image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
    });
  });

  it('passes over a node that does not hold the model, and records nothing', async () => {
    const placed = await place({ holdsModel: false });

    const outcome = await instanceService.start(placed.deploymentId, admin.id);

    expect(outcome.started).toEqual([]);
    expect(outcome.refused[0].problem).toMatch(/does not hold/);

    const rows = await dbQuery(app, 'SELECT id FROM "instance" WHERE "deploymentId" = $1', [placed.deploymentId]);

    expect(rows).toEqual([]);
  });

  it('places an instance naming a node but no device on that node, with no devices', async () => {
    const nodeId = await registerWithDevice();
    const modelId = await insertModel();

    await holdModel(nodeId, modelId);

    const deployment = await createDeployment(app, adminToken, {
      name: `deployment-${randomUUID()}`,
      modelId,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ON_DEMAND,
      document: `image: ghcr.io/ggml-org/llama.cpp:server\ncontextSize: 2048\nplacement:\n  nodeIds:\n    - ${nodeId}\n`,
    }).expect(201);

    const [instance] = (await instanceService.start(deployment.body.id, admin.id)).started;

    const [desired] = nodeStateService.getDesiredState(nodeId).instances;

    expect(instance.pins).toEqual({ cpu: true, gpus: [] });
    expect(desired).toMatchObject({ pins: { cpu: true, gpus: [] }, image: 'ghcr.io/ggml-org/llama.cpp:server' });
  });

  it('passes over a device the node has never reported', async () => {
    const placed = await place({ deviceKey: OTHER_DEVICE_KEY });

    const outcome = await instanceService.start(placed.deploymentId, admin.id);

    expect(outcome.started).toEqual([]);
    expect(outcome.refused[0].problem).toContain(OTHER_DEVICE_KEY);
  });

  it("drops the row and the node's set on a stop", async () => {
    const placed = await place();
    const [instance] = (await instanceService.start(placed.deploymentId, admin.id)).started;

    await instanceService.stop(placed.deploymentId, admin.id);

    const rows = await dbQuery(app, 'SELECT id FROM "instance" WHERE "instanceKey" = $1', [instance.instanceKey]);

    expect(rows).toEqual([]);
    expect(nodeStateService.getDesiredState(placed.nodeId).instances).toEqual([]);
  });

  it('drops the instances of a node that is deleted, since nothing on it survives', async () => {
    const placed = await place();
    const [instance] = (await instanceService.start(placed.deploymentId, admin.id)).started;

    await deleteNode(app, adminToken, placed.nodeId).expect(200);

    const rows = await dbQuery(app, 'SELECT id FROM "instance" WHERE "instanceKey" = $1', [instance.instanceKey]);

    expect(rows).toEqual([]);
  });

  it('writes the pins the document asked for onto the row, against a real column', async () => {
    const nodeId = await registerWithDevice();
    const modelId = await insertModel();

    await holdModel(nodeId, modelId);

    const deployment = await createDeployment(app, adminToken, {
      name: `deployment-${randomUUID()}`,
      modelId,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ON_DEMAND,
      document: documentOffloading(nodeId, DEVICE_KEY),
    }).expect(201);

    const [instance] = (await instanceService.start(deployment.body.id, admin.id)).started;

    const rows = await dbQuery<{ pins: IInstancePins }>(app, 'SELECT "pins" FROM "instance" WHERE "instanceKey" = $1', [
      instance.instanceKey,
    ]);

    expect(rows).toEqual([{ pins: { cpu: true, gpus: [DEVICE_KEY] } }]);
  });

  it('writes a GPU-only placement with the CPU left unpinned', async () => {
    const placed = await place();

    const [instance] = (await instanceService.start(placed.deploymentId, admin.id)).started;

    const rows = await dbQuery<{ pins: IInstancePins }>(app, 'SELECT "pins" FROM "instance" WHERE "instanceKey" = $1', [
      instance.instanceKey,
    ]);

    expect(rows).toEqual([{ pins: { cpu: false, gpus: [DEVICE_KEY] } }]);
  });

  it('refuses a second instance under a key another already holds', async () => {
    const placed = await place();
    const [instance] = (await instanceService.start(placed.deploymentId, admin.id)).started;

    await expect(
      dbQuery(
        app,
        `INSERT INTO "instance"
           ("instanceKey", "deploymentId", "nodeId", "revision", "configurationRevision", "pins", "instanceState")
         VALUES ($1, $2, $3, 1, 'abc', $4::jsonb, 'starting')`,
        [instance.instanceKey, placed.deploymentId, placed.nodeId, JSON.stringify({ cpu: true, gpus: [] })]
      )
    ).rejects.toThrow();
  });
});
