import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, In, Repository } from 'typeorm';

import { AgentGpuInventory, GpuDevice } from '@libs/agent-protocol';

import { Gpu } from './entities/gpu.entity';

const GPU_ORDER: FindOptionsOrder<Gpu> = { index: { direction: 'ASC', nulls: 'LAST' }, deviceKey: 'ASC' };

@Injectable()
export class GpuService {
  private readonly logger = new Logger(GpuService.name);

  constructor(@InjectRepository(Gpu) private readonly gpuRepository: Repository<Gpu>) {}

  /** Ordered by device index with an unknown one last, then by device key. */
  findByNodeId(nodeId: number): Promise<Gpu[]> {
    return this.gpuRepository.find({ where: { nodeId }, order: GPU_ORDER });
  }

  /** Ordered by node, then as `findByNodeId` orders a node. */
  findAll(): Promise<Gpu[]> {
    return this.gpuRepository.find({ order: { nodeId: 'ASC', ...GPU_ORDER } });
  }

  /** Replaces the node's set: a device absent from the report has its row removed. */
  async replaceInventory(nodeId: number, inventory: AgentGpuInventory, reportedDate = new Date()): Promise<void> {
    const existing = await this.gpuRepository.find({ where: { nodeId } });
    const byDeviceKey = new Map(existing.map(row => [row.deviceKey, row]));

    const added: Gpu[] = [];

    for (const device of inventory.devices) {
      const row = byDeviceKey.get(device.deviceKey);

      if (row === undefined) {
        added.push(new Gpu({ nodeId, ...device, index: device.index ?? null, lastReportedDate: reportedDate }));

        continue;
      }

      byDeviceKey.delete(device.deviceKey);

      if (this.differs(row, device)) {
        await this.gpuRepository.update(row.id, {
          vendor: device.vendor,
          name: device.name,
          pciBusId: device.pciBusId,
          memoryTotalBytes: device.memoryTotalBytes,
          index: device.index ?? null,
          lastReportedDate: reportedDate,
        });

        continue;
      }

      await this.gpuRepository.update(row.id, { lastReportedDate: reportedDate });
    }

    if (added.length > 0) {
      await this.gpuRepository.insert(added);
    }

    const removed = [...byDeviceKey.values()].map(row => row.id);

    if (removed.length > 0) {
      await this.gpuRepository.delete({ id: In(removed) });
    }

    if (added.length > 0 || removed.length > 0) {
      this.logger.log(
        { nodeId, added: added.length, removed: removed.length },
        'replaceInventory(): A node changed devices'
      );
    }
  }

  private differs(row: Gpu, device: GpuDevice): boolean {
    return (
      row.name !== device.name ||
      row.pciBusId !== device.pciBusId ||
      row.memoryTotalBytes !== device.memoryTotalBytes ||
      row.index !== (device.index ?? null)
    );
  }
}
