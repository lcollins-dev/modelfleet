import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { GpuVendor } from '@libs/agent-protocol';
import { UserRoleId } from '@libs/dto';

import { GpuService } from '@/core/gpu/gpu.service';

import { deleteNode, registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const device = (deviceKey: string, overrides: Record<string, unknown> = {}) => ({
  deviceKey,
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA GeForce RTX 3090',
  pciBusId: '0000:01:00.0',
  memoryTotalBytes: 25_757_220_864,
  ...overrides,
});

describe('GPU inventory (integration)', () => {
  let app: NestExpressApplication;
  let gpuService: GpuService;
  let adminToken: string;

  const uniqueName = (): string => `rig-${randomUUID()}`;

  const register = async (): Promise<number> => {
    const response = await registerNode(app, adminToken, { name: uniqueName() }).expect(201);

    return response.body.id;
  };

  const rowsFor = (nodeId: number) =>
    dbQuery(app, 'SELECT "deviceKey", "name", "memoryTotalBytes" FROM "gpu" WHERE "nodeId" = $1 ORDER BY "deviceKey"', [
      nodeId,
    ]);

  beforeAll(async () => {
    app = await bootstrapApp();
    gpuService = app.get(GpuService);

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  it('stores the device set a node reported', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a'), device('GPU-b')] });

    expect(await rowsFor(nodeId)).toHaveLength(2);
  });

  it('reads back a total that is larger than a 32 bit integer', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });

    const [stored] = await gpuService.findByNodeId(nodeId);

    expect(stored.memoryTotalBytes).toBe(25_757_220_864);
  });

  it('keeps one device per node rather than growing on every report', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });
    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });
    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });

    expect(await rowsFor(nodeId)).toHaveLength(1);
  });

  it('lets two nodes hold the same device identity', async () => {
    const first = await register();
    const second = await register();

    await gpuService.replaceInventory(first, { devices: [device('GPU-shared')] });
    await gpuService.replaceInventory(second, { devices: [device('GPU-shared')] });

    expect(await rowsFor(first)).toHaveLength(1);
    expect(await rowsFor(second)).toHaveLength(1);
  });

  it('removes a device the node stopped reporting', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a'), device('GPU-b')] });
    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-b')] });

    const rows = await rowsFor(nodeId);

    expect(rows).toHaveLength(1);
    expect(rows[0].deviceKey).toBe('GPU-b');
  });

  it('rewrites a device whose card changed under the same identity', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });
    await gpuService.replaceInventory(nodeId, {
      devices: [device('GPU-a', { name: 'NVIDIA RTX A6000', memoryTotalBytes: 51_539_607_552 })],
    });

    const rows = await rowsFor(nodeId);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('NVIDIA RTX A6000');
  });

  it("lists a node's devices by index, not by device key", async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, {
      devices: [device('GPU-a', { index: 2 }), device('GPU-b', { index: 0 }), device('GPU-c', { index: 1 })],
    });

    const listed = await gpuService.findByNodeId(nodeId);

    expect(listed.map(gpu => gpu.deviceKey)).toEqual(['GPU-b', 'GPU-c', 'GPU-a']);
  });

  it('lists the devices whose index is not known after those whose index is, by device key', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, {
      devices: [device('GPU-d'), device('GPU-a'), device('GPU-b', { index: 1 }), device('GPU-c', { index: 0 })],
    });

    const listed = await gpuService.findByNodeId(nodeId);

    expect(listed.map(gpu => [gpu.deviceKey, gpu.index])).toEqual([
      ['GPU-c', 0],
      ['GPU-b', 1],
      ['GPU-a', null],
      ['GPU-d', null],
    ]);
  });

  it('lists every node by index within the node', async () => {
    const first = await register();
    const second = await register();

    await gpuService.replaceInventory(second, {
      devices: [device('GPU-a', { index: 1 }), device('GPU-b', { index: 0 })],
    });
    await gpuService.replaceInventory(first, {
      devices: [device('GPU-c', { index: 1 }), device('GPU-d', { index: 0 })],
    });

    const listed = (await gpuService.findAll()).filter(gpu => gpu.nodeId === first || gpu.nodeId === second);

    expect(listed.map(gpu => gpu.deviceKey)).toEqual(['GPU-d', 'GPU-c', 'GPU-b', 'GPU-a']);
  });

  it('lists a device renumbered after a reboot at its new index', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, {
      devices: [device('GPU-a', { index: 0 }), device('GPU-b', { index: 1 })],
    });

    await gpuService.replaceInventory(nodeId, {
      devices: [device('GPU-a', { index: 1 }), device('GPU-b', { index: 0 })],
    });

    const after = await gpuService.findByNodeId(nodeId);

    expect(after.map(gpu => gpu.deviceKey)).toEqual(['GPU-b', 'GPU-a']);
  });

  it('takes a node with no devices as a valid report', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, { devices: [] });

    expect(await rowsFor(nodeId)).toHaveLength(0);
  });

  it('drops the devices of a node when that node is deleted', async () => {
    const nodeId = await register();

    await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });
    await deleteNode(app, adminToken, nodeId).expect(200);

    expect(await rowsFor(nodeId)).toHaveLength(0);
  });
});
