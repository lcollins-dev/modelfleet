import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentGpuInventory, GpuVendor } from '@libs/agent-protocol';

import { Gpu } from '@/core/gpu/entities/gpu.entity';

import { GpuService } from '@/core/gpu/gpu.service';

const NODE_ID = 7;
const REPORTED_DATE = new Date('2026-08-20T12:00:00.000Z');

const device = (overrides: Partial<AgentGpuInventory['devices'][number]> = {}) => ({
  deviceKey: 'GPU-4f2c',
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA GeForce RTX 3090',
  pciBusId: '0000:01:00.0',
  memoryTotalBytes: 25_757_220_864,
  index: 0,
  ...overrides,
});

const row = (id: number, overrides: Partial<Gpu> = {}): Gpu =>
  ({
    id,
    nodeId: NODE_ID,
    deviceKey: 'GPU-4f2c',
    vendor: GpuVendor.NVIDIA,
    name: 'NVIDIA GeForce RTX 3090',
    pciBusId: '0000:01:00.0',
    memoryTotalBytes: 25_757_220_864,
    index: 0,
    lastReportedDate: new Date('2026-08-19T12:00:00.000Z'),
    createdDate: new Date('2026-08-19T12:00:00.000Z'),
    ...overrides,
  }) as Gpu;

describe('GpuService', () => {
  let gpuRepository: {
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let gpuService: GpuService;

  beforeEach(async () => {
    gpuRepository = {
      find: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [GpuService, { provide: getRepositoryToken(Gpu), useValue: gpuRepository }],
    }).compile();

    gpuService = moduleRef.get(GpuService);
  });

  it('stores a device the node has not reported before', async () => {
    await gpuService.replaceInventory(NODE_ID, { devices: [device()] }, REPORTED_DATE);

    expect(gpuRepository.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        nodeId: NODE_ID,
        deviceKey: 'GPU-4f2c',
        vendor: GpuVendor.NVIDIA,
        memoryTotalBytes: 25_757_220_864,
        index: 0,
        lastReportedDate: REPORTED_DATE,
      }),
    ]);
  });

  it('stores no index for a device from an agent that predates reporting it', async () => {
    await gpuService.replaceInventory(NODE_ID, { devices: [device({ index: undefined })] }, REPORTED_DATE);

    expect(gpuRepository.insert).toHaveBeenCalledWith([expect.objectContaining({ index: null })]);
  });

  it('stamps a device that is unchanged rather than rewriting it', async () => {
    gpuRepository.find.mockResolvedValue([row(1)]);

    await gpuService.replaceInventory(NODE_ID, { devices: [device()] }, REPORTED_DATE);

    expect(gpuRepository.update).toHaveBeenCalledWith(1, { lastReportedDate: REPORTED_DATE });
    expect(gpuRepository.insert).not.toHaveBeenCalled();
  });

  it('rewrites a device whose card was replaced under the same identity', async () => {
    gpuRepository.find.mockResolvedValue([row(1)]);

    await gpuService.replaceInventory(
      NODE_ID,
      { devices: [device({ name: 'NVIDIA RTX A6000', memoryTotalBytes: 51_539_607_552 })] },
      REPORTED_DATE
    );

    expect(gpuRepository.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'NVIDIA RTX A6000', memoryTotalBytes: 51_539_607_552 })
    );
  });

  it('moves a renumbered device to its new index without replacing it', async () => {
    gpuRepository.find.mockResolvedValue([row(1), row(2, { deviceKey: 'GPU-9a1b', index: 1 })]);

    await gpuService.replaceInventory(
      NODE_ID,
      { devices: [device({ index: 1 }), device({ deviceKey: 'GPU-9a1b', index: 0 })] },
      REPORTED_DATE
    );

    expect(gpuRepository.update).toHaveBeenCalledWith(1, expect.objectContaining({ index: 1 }));
    expect(gpuRepository.update).toHaveBeenCalledWith(2, expect.objectContaining({ index: 0 }));
    expect(gpuRepository.insert).not.toHaveBeenCalled();
    expect(gpuRepository.delete).not.toHaveBeenCalled();
  });

  it('forgets the index of a device once its agent stops reporting one', async () => {
    gpuRepository.find.mockResolvedValue([row(1)]);

    await gpuService.replaceInventory(NODE_ID, { devices: [device({ index: undefined })] }, REPORTED_DATE);

    expect(gpuRepository.update).toHaveBeenCalledWith(1, expect.objectContaining({ index: null }));
  });

  it('removes a device the node no longer reports', async () => {
    gpuRepository.find.mockResolvedValue([row(1), row(2, { deviceKey: 'GPU-9a1b' })]);

    await gpuService.replaceInventory(NODE_ID, { devices: [device()] }, REPORTED_DATE);

    const criteria = gpuRepository.delete.mock.calls[0][0] as { id: FindOperator<number> };

    expect(criteria.id.value).toEqual([2]);
  });

  it('removes every device where a node reports none', async () => {
    gpuRepository.find.mockResolvedValue([row(1)]);

    await gpuService.replaceInventory(NODE_ID, { devices: [] }, REPORTED_DATE);

    expect(gpuRepository.delete).toHaveBeenCalled();
    expect(gpuRepository.insert).not.toHaveBeenCalled();
  });

  it('touches nothing where a node reports no devices and holds none', async () => {
    await gpuService.replaceInventory(NODE_ID, { devices: [] }, REPORTED_DATE);

    expect(gpuRepository.insert).not.toHaveBeenCalled();
    expect(gpuRepository.update).not.toHaveBeenCalled();
    expect(gpuRepository.delete).not.toHaveBeenCalled();
  });
});
