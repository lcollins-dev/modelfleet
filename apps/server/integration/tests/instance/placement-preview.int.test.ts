import { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it } from 'vitest';

import { BackendId, GIB } from '@libs/backends';
import { ActivationPolicy, ExpectedUsageSource, PlacementPreviewResponseDto, UserRoleId } from '@libs/dto';

import { InstanceService } from '@/core/instance/instance.service';

import { getDeploymentInstances, previewPlacement } from '../../clients/instance.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { deployOnCard, registerNodeWithCard, reportCard } from '../../utils/ledger';

const DEVICE_KEY = 'GPU-88888888-2222-3333-4444-555555555555';

interface ISavedDeployment {
  modelId: number;
  document: string;
  configurationRevision: string;
}

describe('Placement preview (integration)', () => {
  let app: NestExpressApplication;
  let adminId: number;
  let adminToken: string;
  let userToken: string;

  const saved = async (): Promise<ISavedDeployment & { nodeId: number; deploymentId: number }> => {
    const nodeId = await registerNodeWithCard(app, adminToken, DEVICE_KEY);
    const deploymentId = await deployOnCard(app, adminToken, nodeId, DEVICE_KEY);
    const [row] = await dbQuery<ISavedDeployment>(
      app,
      'SELECT "modelId", "document", "configurationRevision" FROM "deployment" WHERE id = $1',
      [deploymentId]
    );

    return { ...row, nodeId, deploymentId };
  };

  const draftOf = (deployment: ISavedDeployment, document = deployment.document) => ({
    deploymentId: null,
    modelId: deployment.modelId,
    presetId: null,
    backend: BackendId.LLAMA_CPP,
    activationPolicy: ActivationPolicy.ALWAYS,
    document,
  });

  const preview = async (body: object): Promise<PlacementPreviewResponseDto> =>
    (await previewPlacement(app, adminToken, body).expect(200)).body as PlacementPreviewResponseDto;

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminId = admin.id;
    adminToken = await login(app, admin.email);

    const user = await createTestUser(app);
    userToken = await login(app, user.email);
  });

  it('refuses a caller who is not a system administrator', async () => {
    const deployment = await saved();

    await previewPlacement(app, userToken, draftOf(deployment)).expect(403);
  });

  it('refuses a draft that names no model', async () => {
    const deployment = await saved();

    await previewPlacement(app, adminToken, { ...draftOf(deployment), modelId: undefined }).expect(400);
  });

  it('sizes a draft on its estimate and says where the ticked card cannot hold it, writing nothing', async () => {
    const deployment = await saved();

    await reportCard(app, deployment.nodeId, DEVICE_KEY, { totalBytes: GIB });

    const { placement } = await preview(draftOf(deployment, deployment.document.replace('4096', '8192')));
    const [node] = placement.nodes;

    expect(node.expectedUsage?.source).toBe(ExpectedUsageSource.ESTIMATED);
    expect(node.problem).toMatch(/^This deployment needs \d+\.\d GiB, more than the pinned GPUs have free$/);
    expect(node.capacity).toMatchObject({ expectedBytes: node.expectedUsage?.bytes, availableBytes: 0 });
    expect(await dbQuery(app, `SELECT id FROM "deployment" WHERE "name" = ''`)).toEqual([]);
  });

  it('carries the figures of a card that has room, beside no problem', async () => {
    const deployment = await saved();

    await reportCard(app, deployment.nodeId, DEVICE_KEY);

    const [node] = (await preview(draftOf(deployment))).placement.nodes;

    expect(node.problem).toBeNull();
    expect(node.capacity?.availableBytes).toBe(23 * GIB);
    expect(node.capacity?.cards).toEqual([expect.objectContaining({ deviceKey: DEVICE_KEY, totalBytes: 24 * GIB })]);
  });

  it('names a figure measured for the same configuration as measured', async () => {
    const deployment = await saved();

    await reportCard(app, deployment.nodeId, DEVICE_KEY);
    await dbQuery(
      app,
      'INSERT INTO "measured_vram" ("configurationRevision", "gpuCount", "bytes") VALUES ($1, 1, $2)',
      [deployment.configurationRevision, 5 * GIB]
    );

    const [node] = (await preview(draftOf(deployment))).placement.nodes;

    expect(node.expectedUsage).toEqual({
      bytes: 5 * GIB,
      source: ExpectedUsageSource.MEASURED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
    });
  });

  it('says the same of a saved deployment as it said of the draft that became it', async () => {
    const deployment = await saved();

    await reportCard(app, deployment.nodeId, DEVICE_KEY, { totalBytes: GIB });

    const drafted = await preview(draftOf(deployment));
    const onScreen = await getDeploymentInstances(app, adminToken, deployment.deploymentId).expect(200);

    expect(drafted.placement.nodes[0].problem).not.toBeNull();
    expect(onScreen.body.placement).toEqual(drafted.placement);
  });

  it('checks no room on a node where the deployment being edited already runs its share', async () => {
    const deployment = await saved();

    await reportCard(app, deployment.nodeId, DEVICE_KEY);
    await app.get(InstanceService).start(deployment.deploymentId, adminId);

    const [node] = (await preview({ ...draftOf(deployment), deploymentId: deployment.deploymentId })).placement.nodes;

    expect(node).toMatchObject({ running: 1, problem: null, capacity: null });
    expect(node.expectedUsage).not.toBeNull();
  });

  it('answers a document the backend will not accept with its problem rather than refusing', async () => {
    const deployment = await saved();

    const { placement } = await preview(draftOf(deployment, 'contextSize: many\n'));

    expect(placement).toEqual({
      nodes: [],
      problem: 'This configuration holds a value its backend will not accept, so it cannot be sized',
    });
  });
});
