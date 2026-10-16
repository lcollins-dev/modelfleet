import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentGpuInventory, AgentMessageType, GpuVendor } from '@libs/agent-protocol';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { GpuService } from '@/core/gpu/gpu.service';

import { GpuGateway } from '@/core/gpu/gpu.gateway';

const NODE_ID = 7;
const CLIENT = {} as WebSocket;

const envelope = (payload: AgentGpuInventory) =>
  ({
    protocolVersion: 1,
    messageId: '22222222-2222-4222-8222-222222222222',
    type: AgentMessageType.GPU_INVENTORY,
    sentAt: '2026-08-20T12:00:00.000Z',
    payload,
  }) as never;

const INVENTORY: AgentGpuInventory = {
  devices: [
    {
      deviceKey: 'GPU-4f2c',
      vendor: GpuVendor.NVIDIA,
      name: 'NVIDIA GeForce RTX 3090',
      pciBusId: '0000:01:00.0',
      memoryTotalBytes: 25_757_220_864,
    },
  ],
};

describe('GpuGateway', () => {
  let readyNodeId: ReturnType<typeof vi.fn>;
  let replaceInventory: ReturnType<typeof vi.fn>;
  let gateway: GpuGateway;

  beforeEach(() => {
    readyNodeId = vi.fn().mockReturnValue(NODE_ID);
    replaceInventory = vi.fn().mockResolvedValue(undefined);

    gateway = new GpuGateway(
      { readyNodeId } as unknown as AgentConnectionService,
      {
        replaceInventory,
      } as unknown as GpuService
    );
  });

  it('stores the device set an agent reported', async () => {
    await gateway.handleGpuInventory(CLIENT, envelope(INVENTORY));

    expect(replaceInventory).toHaveBeenCalledWith(NODE_ID, INVENTORY);
  });

  it('stores nothing where the session refuses an unwelcomed report', async () => {
    readyNodeId.mockReturnValue(null);

    await gateway.handleGpuInventory(CLIENT, envelope(INVENTORY));

    expect(replaceInventory).not.toHaveBeenCalled();
  });
});
