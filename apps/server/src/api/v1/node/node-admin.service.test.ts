import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeState } from '@libs/dto';

import { NodeAdminService } from '@/api/v1/node/node-admin.service';
import { ConfigService } from '@/config/config.service';
import { NodeService } from '@/core/node/node.service';

import { buildNode, TEST_NODE_ID as NODE_ID, TEST_NODE_KEY } from '@/test/node.factory';

const PAGE_SIZE = 10;
const ACTOR_ID = 7;

describe('NodeAdminService', () => {
  let nodeAdminService: NodeAdminService;
  let nodeService: {
    register: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    nodeService = {
      register: vi.fn().mockResolvedValue({ node: buildNode(), secret: 'mfn_secret' }),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      findWithThrow: vi.fn().mockResolvedValue(buildNode()),
      update: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockReturnValue(NodeState.REGISTERED),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NodeAdminService,
        { provide: ConfigService, useValue: { pageSize: PAGE_SIZE } },
        { provide: NodeService, useValue: nodeService },
      ],
    }).compile();

    nodeAdminService = moduleRef.get(NodeAdminService);
  });

  describe('registerNode', () => {
    it('answers with the identity alongside the secret', async () => {
      const response = await nodeAdminService.registerNode('rig-01', '', ACTOR_ID);

      expect(response).toEqual({ id: NODE_ID, name: 'rig-01', nodeKey: TEST_NODE_KEY, secret: 'mfn_secret' });
    });

    it('keeps the secret hash out of the response', async () => {
      const response = await nodeAdminService.registerNode('rig-01', '', ACTOR_ID);

      expect(JSON.stringify(response)).not.toContain('hashed-secret');
    });
  });

  describe('getNodeList', () => {
    it('turns the requested page into an offset and a limit', async () => {
      await nodeAdminService.getNodeList({}, 3);

      expect(nodeService.findAndCount).toHaveBeenCalledWith(
        { search: undefined, states: undefined },
        PAGE_SIZE * 2,
        PAGE_SIZE
      );
    });

    it('passes the filter through as criteria', async () => {
      await nodeAdminService.getNodeList({ search: 'rig', state: [NodeState.ONLINE] }, 1);

      expect(nodeService.findAndCount).toHaveBeenCalledWith(
        { search: 'rig', states: [NodeState.ONLINE] },
        0,
        PAGE_SIZE
      );
    });

    it('reads each row down to what a list needs', async () => {
      nodeService.findAndCount.mockResolvedValue([[buildNode()], 1]);

      const response = await nodeAdminService.getNodeList({}, 1);

      expect(response.nodeList).toEqual([
        {
          id: NODE_ID,
          name: 'rig-01',
          state: NodeState.REGISTERED,
          enabled: true,
          lastSeenDate: null,
          agentVersion: null,
        },
      ]);
    });

    it('keeps the secret hash out of the list', async () => {
      nodeService.findAndCount.mockResolvedValue([[buildNode()], 1]);

      const response = await nodeAdminService.getNodeList({}, 1);

      expect(JSON.stringify(response)).not.toContain('hashed-secret');
    });

    it('rounds the page count up on a partial last page', async () => {
      nodeService.findAndCount.mockResolvedValue([[], 21]);

      const response = await nodeAdminService.getNodeList({}, 1);

      expect(response.pages).toBe(3);
    });
  });

  describe('getNode', () => {
    it('answers with the dates as they stand, for JSON to encode', async () => {
      const lastSeenDate = new Date('2026-05-14T08:30:00Z');
      nodeService.findWithThrow.mockResolvedValue(buildNode({ lastSeenDate }));

      const node = await nodeAdminService.getNode(NODE_ID);

      expect(node.lastSeenDate).toEqual(lastSeenDate);
      expect(node.createdDate).toEqual(new Date('2026-05-01T09:00:00Z'));
    });

    it('reports a node that has never connected as never seen', async () => {
      const node = await nodeAdminService.getNode(NODE_ID);

      expect(node.lastSeenDate).toBeNull();
    });

    it('keeps the secret hash out of the response', async () => {
      const node = await nodeAdminService.getNode(NODE_ID);

      expect(JSON.stringify(node)).not.toContain('hashed-secret');
    });
  });

  describe('the commands it passes on', () => {
    it('updates through the domain', async () => {
      await nodeAdminService.updateNode(NODE_ID, 'rig-02', 'The rack A head node', ACTOR_ID);

      expect(nodeService.update).toHaveBeenCalledWith(NODE_ID, 'rig-02', 'The rack A head node', ACTOR_ID);
    });

    it('changes state through the domain', async () => {
      await nodeAdminService.updateState(NODE_ID, false, ACTOR_ID);

      expect(nodeService.setEnabled).toHaveBeenCalledWith(NODE_ID, false, ACTOR_ID);
    });

    it('deletes through the domain', async () => {
      await nodeAdminService.deleteNode(NODE_ID, ACTOR_ID);

      expect(nodeService.remove).toHaveBeenCalledWith(NODE_ID, ACTOR_ID);
    });
  });
});
