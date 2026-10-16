import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NodeState,
  NodeListRequestDto,
  RegisterNodeRequestDto,
  UpdateNodeRequestDto,
  UpdateNodeStateRequestDto,
} from '@libs/dto';

import { User } from '@/core/user/entities/user.entity';

import { NodeAdminService } from '@/api/v1/node/node-admin.service';

import { NodeAdminController } from '@/api/v1/node/node-admin.controller';

const NODE_ID = 42;
const NODE_KEY = '11111111-1111-4111-8111-111111111111';

const buildUser = (): User => {
  const user = new User({ name: 'Admin', email: 'admin@example.com', passwordHash: 'hash' });
  user.id = 7;

  return user;
};

describe('NodeAdminController', () => {
  let controller: NodeAdminController;
  let nodeAdminService: {
    registerNode: ReturnType<typeof vi.fn>;
    getNodeList: ReturnType<typeof vi.fn>;
    getNode: ReturnType<typeof vi.fn>;
    updateNode: ReturnType<typeof vi.fn>;
    updateState: ReturnType<typeof vi.fn>;
    deleteNode: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    nodeAdminService = {
      registerNode: vi.fn().mockResolvedValue({ id: NODE_ID, name: 'rig-01', nodeKey: NODE_KEY, secret: 'mfn_secret' }),
      getNodeList: vi.fn().mockResolvedValue({ nodeList: [], pages: 0 }),
      getNode: vi
        .fn()
        .mockResolvedValue({ id: NODE_ID, name: 'rig-01', nodeKey: NODE_KEY, state: NodeState.REGISTERED }),
      updateNode: vi.fn().mockResolvedValue(undefined),
      updateState: vi.fn().mockResolvedValue(undefined),
      deleteNode: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NodeAdminController],
      providers: [{ provide: NodeAdminService, useValue: nodeAdminService }],
    }).compile();

    controller = moduleRef.get(NodeAdminController);
  });

  it('hands the key and the secret back to the administrator who registered the node', async () => {
    const dto: RegisterNodeRequestDto = { name: 'rig-01', description: 'The rack A head node' };

    const response = await controller.registerNode(buildUser(), dto);

    expect(nodeAdminService.registerNode).toHaveBeenCalledWith('rig-01', 'The rack A head node', 7);
    expect(response.nodeKey).toBe(NODE_KEY);
    expect(response.secret).toBe('mfn_secret');
  });

  it('passes the filter and the page through', async () => {
    const dto: NodeListRequestDto = { state: [NodeState.ONLINE] };

    await controller.getNodeList(dto, 2);

    expect(nodeAdminService.getNodeList).toHaveBeenCalledWith(dto, 2);
  });

  it('reads one node by its identifier', async () => {
    await controller.getNode(NODE_ID);

    expect(nodeAdminService.getNode).toHaveBeenCalledWith(NODE_ID);
  });

  it('names the administrator behind a rename', async () => {
    const dto: UpdateNodeRequestDto = { name: 'rig-02', description: 'The rack A head node' };

    await controller.updateNode(buildUser(), NODE_ID, dto);

    expect(nodeAdminService.updateNode).toHaveBeenCalledWith(NODE_ID, 'rig-02', 'The rack A head node', 7);
  });

  it('names the administrator behind a state change', async () => {
    const dto: UpdateNodeStateRequestDto = { enabled: false };

    await controller.updateState(buildUser(), NODE_ID, dto);

    expect(nodeAdminService.updateState).toHaveBeenCalledWith(NODE_ID, false, 7);
  });

  it('names the administrator behind a deletion', async () => {
    await controller.deleteNode(buildUser(), NODE_ID);

    expect(nodeAdminService.deleteNode).toHaveBeenCalledWith(NODE_ID, 7);
  });
});
