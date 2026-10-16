import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AgentTelemetry,
  GpuVendor,
  ProcessAttribution,
  TelemetryErrorScope,
  TelemetryState,
} from '@libs/agent-protocol';
import {
  GpuProcessAttribution,
  FleetTelemetryResponseDto,
  NodeTelemetryStatusDto,
  NodeTelemetryState,
  UserRoleId,
} from '@libs/dto';

import { GpuService } from '@/core/gpu/gpu.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

import { registerNode } from '../../clients/node.client';
import { getFleetTelemetry, getNodeTelemetryStatus } from '../../clients/telemetry.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { openSse } from '../../utils/sse';

const device = (deviceKey: string) => ({
  deviceKey,
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA GeForce RTX 3090',
  pciBusId: '0000:01:00.0',
  memoryTotalBytes: 25_757_220_864,
});

const telemetry = (deviceKeys: string[], overrides: Partial<AgentTelemetry> = {}): AgentTelemetry => ({
  capturedAt: '2026-08-20T12:00:00.000Z',
  telemetryState: TelemetryState.OK,
  devices: deviceKeys.map((deviceKey, index) => ({
    deviceKey,
    index,
    memoryUsedBytes: 21_474_836_480,
    utilisationPercent: 34,
    temperatureC: 61,
    powerDrawWatts: 220,
    processAttribution: ProcessAttribution.EXACT,
    processes: [
      { pid: 12_345, usedBytes: 21_340_618_752, name: '/usr/bin/python3.11', containerId: null, containerName: null },
    ],
  })),
  host: {
    cpuModel: 'AMD Ryzen 9 5950X',
    cpuCount: 32,
    loadAverage1m: 1.2,
    memoryTotalBytes: 67_386_753_024,
    memoryFreeBytes: 41_231_686_144,
  },
  errors: [],
  ...overrides,
});

describe('GPU status routes (integration)', () => {
  let app: NestExpressApplication;
  let gpuService: GpuService;
  let telemetryService: TelemetryService;
  let adminToken: string;

  const register = async (): Promise<number> => {
    const response = await registerNode(app, adminToken, { name: `rig-${randomUUID()}` }).expect(201);

    return response.body.id;
  };

  beforeAll(async () => {
    app = await bootstrapApp();
    gpuService = app.get(GpuService);
    telemetryService = app.get(TelemetryService);

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  describe('access', () => {
    it('rejects an unauthenticated read', async () => {
      const nodeId = await register();

      await request(app.getHttpServer()).get(`/api/v1/admin/node/${nodeId}/telemetry`).expect(401);
    });

    it('rejects an unauthenticated stream', async () => {
      const nodeId = await register();

      await request(app.getHttpServer()).get(`/api/v1/admin/node/${nodeId}/telemetry/stream`).expect(401);
    });

    it('rejects a caller who is not a system administrator', async () => {
      const nodeId = await register();
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      const response = await getNodeTelemetryStatus(app, userToken, nodeId).expect(403);

      expect(response.body.message).toBe('You do not have permission to do this');
    });

    it('refuses a node that does not exist', async () => {
      await getNodeTelemetryStatus(app, adminToken, 2_147_483_600).expect(400);
    });
  });

  describe('read', () => {
    it('carries the live reading onto the devices the node holds', async () => {
      const nodeId = await register();

      await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a'), device('GPU-b')] });
      telemetryService.recordTelemetry(nodeId, telemetry(['GPU-a', 'GPU-b']));

      const response = await getNodeTelemetryStatus(app, adminToken, nodeId).expect(200);
      const status = response.body as NodeTelemetryStatusDto;

      expect(status.telemetryState).toBe(NodeTelemetryState.OK);
      expect(status.capturedAt).toBe('2026-08-20T12:00:00.000Z');
      expect(status.devices).toHaveLength(2);
      expect(status.devices[0].memoryUsedBytes).toBe(21_474_836_480);
      expect(status.devices[0].memoryTotalBytes).toBe(25_757_220_864);
      expect(status.devices[0].processAttribution).toBe(GpuProcessAttribution.EXACT);
      expect(status.devices[0].processes).toHaveLength(1);
      expect(status.host).toMatchObject({ cpuCount: 32, memoryTotalBytes: 67_386_753_024 });
    });

    it('reports a device the reading omits without dropping it', async () => {
      const nodeId = await register();

      await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a'), device('GPU-b')] });
      telemetryService.recordTelemetry(nodeId, telemetry(['GPU-a']));

      const response = await getNodeTelemetryStatus(app, adminToken, nodeId).expect(200);
      const status = response.body as NodeTelemetryStatusDto;

      expect(status.devices).toHaveLength(2);
      expect(status.devices[1].deviceKey).toBe('GPU-b');
      expect(status.devices[1].memoryUsedBytes).toBeNull();
      expect(status.devices[1].processAttribution).toBeNull();
    });

    it('reads a node holding no devices as an empty set rather than an error', async () => {
      const nodeId = await register();

      const response = await getNodeTelemetryStatus(app, adminToken, nodeId).expect(200);
      const status = response.body as NodeTelemetryStatusDto;

      expect(status.devices).toEqual([]);
      expect(status.telemetryState).toBeNull();
      expect(status.host).toBeNull();
    });

    it('carries the reading errors through with a degraded state', async () => {
      const nodeId = await register();

      await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });
      telemetryService.recordTelemetry(
        nodeId,
        telemetry(['GPU-a'], {
          telemetryState: TelemetryState.DEGRADED,
          errors: [
            { scope: TelemetryErrorScope.METRIC, deviceKey: 'GPU-a', metric: 'powerDrawWatts', message: 'Unsupported' },
          ],
        })
      );

      const response = await getNodeTelemetryStatus(app, adminToken, nodeId).expect(200);
      const status = response.body as NodeTelemetryStatusDto;

      expect(status.telemetryState).toBe(NodeTelemetryState.DEGRADED);
      expect(status.errors).toHaveLength(1);
      expect(status.errors[0].message).toBe('Unsupported');
    });

    it('keeps the devices of one node out of the status of another', async () => {
      const first = await register();
      const second = await register();

      await gpuService.replaceInventory(first, { devices: [device('GPU-a')] });
      await gpuService.replaceInventory(second, { devices: [device('GPU-b'), device('GPU-c')] });

      const response = await getNodeTelemetryStatus(app, adminToken, first).expect(200);
      const status = response.body as NodeTelemetryStatusDto;

      expect(status.devices).toHaveLength(1);
      expect(status.devices[0].deviceKey).toBe('GPU-a');
    });
  });

  describe("the ledger's figures", () => {
    it('carries no predictions on idle devices, and the headroom kept back on every card', async () => {
      const nodeId = await register();

      await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a'), device('GPU-b')] });
      telemetryService.recordTelemetry(nodeId, telemetry(['GPU-a']));

      const status = (await getNodeTelemetryStatus(app, adminToken, nodeId).expect(200)).body as NodeTelemetryStatusDto;

      expect(status.headroomBytes).toBe(1024 ** 3);
      expect(status.devices.map(entry => [entry.deviceKey, entry.predictions])).toEqual([
        ['GPU-a', []],
        ['GPU-b', []],
      ]);
    });
  });

  describe('stream', () => {
    it('opens with the current status and sends one on each reading', async () => {
      const nodeId = await register();

      await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });

      const stream = await openSse(app, `/api/v1/admin/node/${nodeId}/telemetry/stream`, authHeaders(adminToken));

      expect(await stream.status).toBe(200);
      expect((await stream.headers)['content-type']).toContain('text/event-stream');

      const [opening] = await stream.take(1);

      expect((JSON.parse(opening) as NodeTelemetryStatusDto).telemetryState).toBeNull();

      telemetryService.recordTelemetry(nodeId, telemetry(['GPU-a']));

      const [, second] = await stream.take(2);
      const status = JSON.parse(second) as NodeTelemetryStatusDto;

      expect(status.telemetryState).toBe(NodeTelemetryState.OK);
      expect(status.devices[0].memoryUsedBytes).toBe(21_474_836_480);

      stream.close();
    });

    it('ignores a reading from another node', async () => {
      const watched = await register();
      const other = await register();

      await gpuService.replaceInventory(watched, { devices: [device('GPU-a')] });
      await gpuService.replaceInventory(other, { devices: [device('GPU-b')] });

      const stream = await openSse(app, `/api/v1/admin/node/${watched}/telemetry/stream`, authHeaders(adminToken));

      await stream.take(1);

      telemetryService.recordTelemetry(other, telemetry(['GPU-b']));

      await expect(stream.take(2, 500)).rejects.toThrow('Timed out');

      stream.close();
    });
  });

  describe('fleet', () => {
    it('refuses a caller who is not a system administrator', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      const response = await getFleetTelemetry(app, userToken).expect(403);

      expect(response.body.message).toBe('You do not have permission to do this');
    });

    it('carries every node its own devices, including a node that has never reported', async () => {
      const reporting = await register();
      const silent = await register();

      await gpuService.replaceInventory(reporting, { devices: [device('GPU-a')] });
      await gpuService.replaceInventory(silent, { devices: [device('GPU-b')] });
      telemetryService.recordTelemetry(reporting, telemetry(['GPU-a']));

      const response = await getFleetTelemetry(app, adminToken).expect(200);
      const nodes = (response.body as FleetTelemetryResponseDto).nodes;
      const reportingNode = nodes.find(node => node.nodeId === reporting);
      const silentNode = nodes.find(node => node.nodeId === silent);

      expect(reportingNode?.status.devices.map(fleetDevice => fleetDevice.deviceKey)).toEqual(['GPU-a']);
      expect(reportingNode?.status.devices[0].memoryUsedBytes).toBe(21_474_836_480);
      expect(silentNode?.status.telemetryState).toBeNull();
      expect(silentNode?.status.devices.map(fleetDevice => fleetDevice.deviceKey)).toEqual(['GPU-b']);
    });

    it('opens its stream with the fleet and sends it again after a reading', async () => {
      const nodeId = await register();

      await gpuService.replaceInventory(nodeId, { devices: [device('GPU-a')] });

      const stream = await openSse(app, '/api/v1/admin/telemetry/stream', authHeaders(adminToken));

      expect(await stream.status).toBe(200);

      await stream.take(1);

      telemetryService.recordTelemetry(nodeId, telemetry(['GPU-a']));

      const [, second] = await stream.take(2);
      const node = (JSON.parse(second) as FleetTelemetryResponseDto).nodes.find(
        fleetNode => fleetNode.nodeId === nodeId
      );

      expect(node?.status.telemetryState).toBe(NodeTelemetryState.OK);

      stream.close();
    });
  });
});
