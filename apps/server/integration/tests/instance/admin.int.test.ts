import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { BackendId } from '@libs/backends';
import {
  ActivationPolicy,
  EventType,
  ExpectedUsageSource,
  InstanceListResponseDto,
  InstanceState,
  NodeState,
  UserRoleId,
} from '@libs/dto';

import { createDeployment } from '../../clients/deployment.client';
import { getEventList } from '../../clients/event.client';
import {
  getDeploymentInstances,
  getInstances,
  getNodeInstances,
  startDeployment,
  stopDeployment,
} from '../../clients/instance.client';
import { registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';
import { ESTIMABLE_METADATA, reportCard } from '../../utils/ledger';
import { openSse } from '../../utils/sse';

const DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';
const DEVICE_NAME = 'NVIDIA A100-SXM4-80GB';
const WEIGHTS_PATH = '/srv/models/llama-3-8b.gguf';

interface IPlacedDeployment {
  deploymentId: number;
  nodeId: number;
}

interface ISpreadDeployment {
  deploymentId: number;
  nodeIds: number[];
}

describe('Instance admin routes (integration)', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let userToken: string;

  const insertModel = async (): Promise<number> => {
    const rows = await dbQuery<{ id: number }>(
      app,
      `INSERT INTO "model" ("fingerprint", "format", "type", "sizeBytes", "shardCount", "name", "ggufMetadata")
       VALUES ($1, 'gguf', 'model', 1000, 1, 'Llama 3 8B', $2) RETURNING id`,
      [randomUUID().replaceAll('-', '').padEnd(64, '0'), JSON.stringify(ESTIMABLE_METADATA)]
    );

    return rows[0].id;
  };

  /** An online node holding the model, since a start passes over anything less. */
  const registerOnlineNode = async (): Promise<number> => {
    const response = await registerNode(app, adminToken, { name: `node-${randomUUID()}` }).expect(201);
    const nodeId: number = response.body.id;

    await dbQuery(
      app,
      `INSERT INTO "gpu" ("nodeId", "deviceKey", "vendor", "name", "lastReportedDate")
       VALUES ($1, $2, 'nvidia', $3, now())`,
      [nodeId, DEVICE_KEY, DEVICE_NAME]
    );

    await dbQuery(app, 'UPDATE "node" SET "lastSeenDate" = now() WHERE id = $1', [nodeId]);
    await reportCard(app, nodeId, DEVICE_KEY);

    return nodeId;
  };

  /** `onDemand` unless asked, so the supervisor starts nothing a case does not ask for. */
  const place = async (
    options: { onCpu?: boolean; holdsModel?: boolean; activationPolicy?: ActivationPolicy } = {}
  ): Promise<IPlacedDeployment> => {
    const nodeId = await registerOnlineNode();
    const modelId = await insertModel();

    if (options.holdsModel !== false) {
      await dbQuery(
        app,
        `INSERT INTO "availability" ("modelId", "nodeId", "path", "lastConfirmedDate") VALUES ($1, $2, $3, now())`,
        [modelId, nodeId, WEIGHTS_PATH]
      );
    }

    const placement =
      options.onCpu === true
        ? `placement:\n  nodeIds:\n    - ${nodeId}\n`
        : `placement:\n  gpus:\n    - nodeId: ${nodeId}\n      deviceKey: ${DEVICE_KEY}\n`;

    const deployment = await createDeployment(app, adminToken, {
      name: `deployment-${randomUUID()}`,
      modelId,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: options.activationPolicy ?? ActivationPolicy.ON_DEMAND,
      document: `image: ghcr.io/ggml-org/llama.cpp:server-cuda\ncontextSize: 4096\n${placement}`,
    }).expect(201);

    return { deploymentId: deployment.body.id, nodeId };
  };

  const placeOnTwoNodes = async (): Promise<ISpreadDeployment> => {
    const nodeIds = [await registerOnlineNode(), await registerOnlineNode()];
    const modelId = await insertModel();

    for (const nodeId of nodeIds) {
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
      activationPolicy: ActivationPolicy.ON_DEMAND,
      document: `image: ghcr.io/ggml-org/llama.cpp:server\ncontextSize: 4096\nplacement:\n  nodeIds:\n${nodeIds
        .map(nodeId => `    - ${nodeId}\n`)
        .join('')}`,
    }).expect(201);

    return { deploymentId: deployment.body.id, nodeIds };
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);

    const user = await createTestUser(app);
    userToken = await login(app, user.email);
  });

  it('refuses a caller who is not a system administrator', async () => {
    const placed = await place();

    const response = await getDeploymentInstances(app, userToken, placed.deploymentId).expect(403);

    await startDeployment(app, userToken, placed.deploymentId).expect(403);

    expect(response.body.message).toBe('You do not have permission to do this');
  });

  it('lists an instance with its node, its device and its state', async () => {
    const placed = await place();

    await startDeployment(app, adminToken, placed.deploymentId).expect(201);

    const response = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);

    expect(response.body.instances).toEqual([
      expect.objectContaining({
        nodeId: placed.nodeId,
        nodeState: NodeState.ONLINE,
        state: InstanceState.STARTING,
        devices: [{ deviceKey: DEVICE_KEY, name: DEVICE_NAME }],
        exitCode: null,
      }),
    ]);
  });

  it('names the devices a start would take before one is asked for', async () => {
    const placed = await place();

    const response = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);

    expect(response.body.placement).toEqual({
      nodes: [
        {
          nodeId: placed.nodeId,
          nodeName: expect.any(String),
          devices: [{ deviceKey: DEVICE_KEY, name: DEVICE_NAME }],
          replicas: 1,
          running: 0,
          problem: null,
          expectedUsage: {
            bytes: expect.any(Number),
            source: ExpectedUsageSource.ESTIMATED,
            hostWeightsBytes: 0,
            hostResidentBytes: 0,
          },
          capacity: expect.objectContaining({ cards: [expect.objectContaining({ deviceKey: DEVICE_KEY })] }),
        },
      ],
      problem: null,
    });
  });

  it('reads an instance on the CPU as taking no devices', async () => {
    const placed = await place({ onCpu: true });

    await startDeployment(app, adminToken, placed.deploymentId).expect(201);

    const response = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);

    expect(response.body.instances[0].devices).toEqual([]);
    expect(response.body.placement.nodes[0].devices).toEqual([]);
  });

  it('carries the constraint that stops a node beside that node', async () => {
    const placed = await place({ holdsModel: false });

    const response = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);

    expect(response.body.placement.nodes[0].problem).toContain('does not hold');
  });

  it('passes over a node the placement cannot proceed with, creating nothing', async () => {
    const placed = await place({ holdsModel: false });

    const response = await startDeployment(app, adminToken, placed.deploymentId).expect(201);

    expect(response.body.started).toBe(0);
    expect(response.body.refused[0].problem).toContain('does not hold');
  });

  it('gives every node the placement names an instance of its own', async () => {
    const placed = await placeOnTwoNodes();

    const started = await startDeployment(app, adminToken, placed.deploymentId).expect(201);
    const response = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);

    expect(started.body.started).toBe(2);
    expect(response.body.instances.map((instance: { nodeId: number }) => instance.nodeId).sort()).toEqual(
      [...placed.nodeIds].sort()
    );
  });

  it('tops up rather than doubling where a start is asked for twice', async () => {
    const placed = await place();

    await startDeployment(app, adminToken, placed.deploymentId).expect(201);

    const again = await startDeployment(app, adminToken, placed.deploymentId).expect(201);
    const response = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);

    expect(again.body.started).toBe(0);
    expect(response.body.instances).toHaveLength(1);
  });

  it('lists the instances resident on a node, each naming its deployment', async () => {
    const placed = await place();

    await startDeployment(app, adminToken, placed.deploymentId).expect(201);

    const response = await getNodeInstances(app, adminToken, placed.nodeId).expect(200);

    expect(response.body.instances).toEqual([
      expect.objectContaining({ deploymentId: placed.deploymentId, deploymentName: expect.any(String) }),
    ]);
  });

  it('brings an always deployment back on a fresh instance after a stop, since a stop is not a hold', async () => {
    const placed = await place({ activationPolicy: ActivationPolicy.ALWAYS });

    await startDeployment(app, adminToken, placed.deploymentId).expect(201);

    const before = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);
    const stoppedKey: string = before.body.instances[0].instanceKey;

    await stopDeployment(app, adminToken, placed.deploymentId).expect(200);

    await vi.waitFor(async () => {
      const response = await getDeploymentInstances(app, adminToken, placed.deploymentId).expect(200);

      expect(response.body.instances).toHaveLength(1);
      expect(response.body.instances[0].instanceKey).not.toBe(stoppedKey);
    }, 10_000);
  });

  it('records the start and the stop against the deployment in the event log', async () => {
    const placed = await place();

    await startDeployment(app, adminToken, placed.deploymentId).expect(201);
    await stopDeployment(app, adminToken, placed.deploymentId).expect(200);

    const response = await getEventList(app, adminToken, {
      subjectType: 'deployment',
      subjectId: `${placed.deploymentId}`,
    }).expect(200);

    const types = response.body.eventList.map((event: { type: string }) => event.type);

    expect(types).toContain(EventType.INSTANCE_STARTED);
    expect(types).toContain(EventType.INSTANCE_STOPPED);
  });

  it('refuses a stop where the deployment is running nothing', async () => {
    const placed = await place();

    const response = await stopDeployment(app, adminToken, placed.deploymentId).expect(400);

    expect(response.body.message).toBe('This deployment has no running instances to stop');
  });

  describe('fleet', () => {
    it('refuses a caller who is not a system administrator', async () => {
      const response = await getInstances(app, userToken).expect(403);

      expect(response.body.message).toBe('You do not have permission to do this');
    });

    it('lists the instances of every node in one read', async () => {
      const placed = await placeOnTwoNodes();

      await startDeployment(app, adminToken, placed.deploymentId).expect(201);

      const response = await getInstances(app, adminToken).expect(200);
      const listed = response.body.instances.filter(
        (instance: { deploymentId: number }) => instance.deploymentId === placed.deploymentId
      );

      expect(listed.map((instance: { nodeId: number }) => instance.nodeId).sort()).toEqual([...placed.nodeIds].sort());
    });

    it('opens its stream with the fleet and sends it again on a start', async () => {
      const placed = await place();

      const stream = await openSse(app, '/api/v1/admin/instance/stream', authHeaders(adminToken));

      expect(await stream.status).toBe(200);

      await stream.take(1);
      await startDeployment(app, adminToken, placed.deploymentId).expect(201);

      const [, second] = await stream.take(2);
      const instances = (JSON.parse(second) as InstanceListResponseDto).instances;

      expect(instances.some(instance => instance.deploymentId === placed.deploymentId)).toBe(true);

      stream.close();
    });
  });
});
