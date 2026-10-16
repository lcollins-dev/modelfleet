import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { In } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventPartyType, EventSeverity, EventType, NodeState } from '@libs/dto';

import { Node } from '@/core/node/entities/node.entity';

import { ConfigService } from '@/config/config.service';
import { EventService } from '@/core/event/event.service';
import { NodeStateService } from '@/core/node/node-state.service';
import { NodeService } from '@/core/node/node.service';

import { buildNode, TEST_NODE_ID as NODE_ID } from '@/test/node.factory';

vi.mock('bcryptjs', () => ({
  hash: vi.fn(),
}));

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

type BcryptHash = (secret: string, rounds: number) => Promise<string>;

const PAGE_SIZE = 10;
const HASH_ROUNDS = 4;
const OFFLINE_THRESHOLD_MS = 30_000;
const ACTOR_ID = 7;

interface IQueryBuilderMock {
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  skip: ReturnType<typeof vi.fn>;
  getOne: ReturnType<typeof vi.fn>;
  getManyAndCount: ReturnType<typeof vi.fn>;
}

const makeQueryBuilderMock = (): IQueryBuilderMock => {
  const queryBuilder: Partial<IQueryBuilderMock> = {};

  queryBuilder.where = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.andWhere = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.orderBy = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.take = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.skip = vi.fn().mockReturnValue(queryBuilder);
  queryBuilder.getOne = vi.fn().mockResolvedValue(null);
  queryBuilder.getManyAndCount = vi.fn().mockResolvedValue([[], 0]);

  return queryBuilder as IQueryBuilderMock;
};

describe('NodeService', () => {
  let nodeService: NodeService;
  let queryBuilder: IQueryBuilderMock;
  let nodeRepository: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let nodeStateService: { forget: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.mocked<BcryptHash>(bcrypt.hash).mockResolvedValue('hashed-secret');

    queryBuilder = makeQueryBuilderMock();
    nodeRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      findOne: vi.fn(),
      find: vi.fn(),

      // TypeORM fills the generated columns in on the entity it inserted.
      insert: vi.fn().mockImplementation((node: Node) => {
        node.id = NODE_ID;

        return Promise.resolve(undefined);
      }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    nodeStateService = { forget: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NodeService,
        {
          provide: ConfigService,
          useValue: {
            pageSize: PAGE_SIZE,
            nodeSecretHashRounds: HASH_ROUNDS,
            nodeOfflineThresholdMs: OFFLINE_THRESHOLD_MS,
          },
        },
        { provide: EventService, useValue: eventService },
        { provide: NodeStateService, useValue: nodeStateService },
        { provide: getRepositoryToken(Node), useValue: nodeRepository },
      ],
    }).compile();

    nodeService = moduleRef.get(NodeService);
  });

  describe('register', () => {
    it('issues a key and a secret alongside the row identifier', async () => {
      const response = await nodeService.register('rig-01', '', ACTOR_ID);

      expect(response.node.id).toBe(NODE_ID);
      expect(response.node.name).toBe('rig-01');
      expect(response.node.nodeKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.secret).toMatch(/^mfn_[\w-]{43}$/);
    });

    it('issues a different key and secret to every node', async () => {
      const first = await nodeService.register('rig-01', '', ACTOR_ID);
      const second = await nodeService.register('rig-02', '', ACTOR_ID);

      expect(first.secret).not.toBe(second.secret);
      expect(first.node.nodeKey).not.toBe(second.node.nodeKey);
    });

    it('stores only the hash of the secret', async () => {
      const response = await nodeService.register('rig-01', '', ACTOR_ID);
      const inserted = nodeRepository.insert.mock.calls[0][0] as Node;

      expect(bcrypt.hash).toHaveBeenCalledWith(response.secret, HASH_ROUNDS);
      expect(inserted.secretHash).toBe('hashed-secret');
      expect(JSON.stringify(inserted)).not.toContain(response.secret);
    });

    it('trims the name it was given', async () => {
      const response = await nodeService.register('  rig-01  ', '', ACTOR_ID);

      expect(response.node.name).toBe('rig-01');
    });

    it('stores the description it was given, trimmed', async () => {
      const response = await nodeService.register('rig-01', '  The rack A head node  ', ACTOR_ID);

      expect(response.node.description).toBe('The rack A head node');
    });

    it('leaves a node registered with no description holding none', async () => {
      const response = await nodeService.register('rig-01', '   ', ACTOR_ID);

      expect(response.node.description).toBeNull();
    });

    it('refuses a name another node already holds', async () => {
      queryBuilder.getOne.mockResolvedValue(buildNode());

      await expect(nodeService.register('rig-01', '', ACTOR_ID)).rejects.toThrow(BadRequestException);

      expect(nodeRepository.insert).not.toHaveBeenCalled();
    });

    it('compares the name against the lowercased index', async () => {
      await nodeService.register('Rig-01', '', ACTOR_ID);

      expect(queryBuilder.where).toHaveBeenCalledWith('LOWER(node.name) = LOWER(:name)', { name: 'Rig-01' });
    });

    it('records the registration against the administrator who made it', async () => {
      const response = await nodeService.register('rig-01', '', ACTOR_ID);

      expect(eventService.recordEvent).toHaveBeenCalledWith(EventType.NODE_REGISTERED, EventSeverity.INFO, {
        actorType: EventPartyType.USER,
        actorId: `${ACTOR_ID}`,
        subjectType: EventPartyType.NODE,
        subjectId: `${response.node.id}`,
        message: 'Registered node **rig-01**',
        detail: { name: 'rig-01' },
      });
    });

    it('keeps the secret out of the event it records', async () => {
      const response = await nodeService.register('rig-01', '', ACTOR_ID);

      expect(JSON.stringify(eventService.recordEvent.mock.calls)).not.toContain(response.secret);
    });
  });

  describe('getState', () => {
    const secondsAgo = (seconds: number): Date => new Date(Date.now() - seconds * 1000);

    it('reads a node awaiting first contact as registered', () => {
      expect(nodeService.getState(buildNode())).toBe(NodeState.REGISTERED);
    });

    it('reads a node heard from within the threshold as online', () => {
      expect(nodeService.getState(buildNode({ lastSeenDate: secondsAgo(5) }))).toBe(NodeState.ONLINE);
    });

    it('reads a node past the threshold as offline', () => {
      expect(nodeService.getState(buildNode({ lastSeenDate: secondsAgo(31) }))).toBe(NodeState.OFFLINE);
    });

    it('reads a node silent for a long time as offline', () => {
      expect(nodeService.getState(buildNode({ lastSeenDate: secondsAgo(86400) }))).toBe(NodeState.OFFLINE);
    });

    it('reads a held-back node as disabled however recently it was heard from', () => {
      const node = buildNode({ enabled: false, lastSeenDate: secondsAgo(1) });

      expect(nodeService.getState(node)).toBe(NodeState.DISABLED);
    });
  });

  describe('findAndCount', () => {
    it('narrows on nothing when no criteria are given', async () => {
      await nodeService.findAndCount({}, 0, PAGE_SIZE);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('wraps the search term in wildcards', async () => {
      await nodeService.findAndCount({ search: 'rig' }, 0, PAGE_SIZE);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('LOWER(node.name)'), {
        search: '%rig%',
      });
    });

    it('narrows on the states it was asked for, against the threshold cutoff', async () => {
      await nodeService.findAndCount({ states: [NodeState.ONLINE] }, 0, PAGE_SIZE);

      const [, parameters] = queryBuilder.andWhere.mock.calls[0] as [unknown, { cutoff: Date }];

      expect(parameters.cutoff.getTime()).toBeCloseTo(Date.now() - 30000, -3);
    });

    it('narrows on nothing when the state list is empty', async () => {
      await nodeService.findAndCount({ states: [] }, 0, PAGE_SIZE);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('takes and skips what it was asked for', async () => {
      await nodeService.findAndCount({}, PAGE_SIZE * 2, PAGE_SIZE);

      expect(queryBuilder.take).toHaveBeenCalledWith(PAGE_SIZE);
      expect(queryBuilder.skip).toHaveBeenCalledWith(PAGE_SIZE * 2);
    });

    it('answers with the rows and how many match in total', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[buildNode()], 21]);

      const [nodes, total] = await nodeService.findAndCount({}, 0, PAGE_SIZE);

      expect(nodes).toHaveLength(1);
      expect(total).toBe(21);
    });
  });

  describe('findWithThrow', () => {
    it('throws when the node does not exist', async () => {
      nodeRepository.findOne.mockResolvedValue(null);

      await expect(nodeService.findWithThrow(NODE_ID)).rejects.toThrow(BadRequestException);
    });

    it('answers with the row', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      const node = await nodeService.findWithThrow(NODE_ID);

      expect(node.id).toBe(NODE_ID);
    });
  });

  describe('findNames', () => {
    it('maps each id it finds to its name', async () => {
      nodeRepository.find.mockResolvedValue([buildNode({ id: 4, name: 'rig-01' })]);

      const nodeNames = await nodeService.findNames([4, 5]);

      expect(nodeRepository.find).toHaveBeenCalledWith({ select: ['id', 'name'], where: { id: In([4, 5]) } });
      expect(nodeNames.get(4)).toBe('rig-01');
      expect(nodeNames.get(5)).toBeUndefined();
    });

    it('reads nothing when asked for no nodes', async () => {
      const nodeNames = await nodeService.findNames([]);

      expect(nodeRepository.find).not.toHaveBeenCalled();
      expect(nodeNames.size).toBe(0);
    });
  });

  describe('update', () => {
    it('throws when the node does not exist', async () => {
      nodeRepository.findOne.mockResolvedValue(null);

      await expect(nodeService.update(NODE_ID, 'rig-02', '', ACTOR_ID)).rejects.toThrow(BadRequestException);

      expect(nodeRepository.update).not.toHaveBeenCalled();
    });

    it('stores the new name', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.update(NODE_ID, 'rig-02', '', ACTOR_ID);

      expect(nodeRepository.update).toHaveBeenCalledWith({ id: NODE_ID }, { name: 'rig-02', description: null });
    });

    it('refuses a name another node already holds', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());
      queryBuilder.getOne.mockResolvedValue(buildNode({ id: 99, name: 'rig-02' }));

      await expect(nodeService.update(NODE_ID, 'rig-02', '', ACTOR_ID)).rejects.toThrow(BadRequestException);
    });

    it('allows a node to change the case of its own name', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.update(NODE_ID, 'RIG-01', '', ACTOR_ID);

      expect(nodeRepository.update).toHaveBeenCalledWith({ id: NODE_ID }, { name: 'RIG-01', description: null });
      expect(queryBuilder.getOne).not.toHaveBeenCalled();
    });

    it('records the name it had before', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.update(NODE_ID, 'rig-02', '', ACTOR_ID);

      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.NODE_RENAMED,
        EventSeverity.INFO,
        expect.objectContaining({
          message: 'Renamed node **rig-01** to **rig-02**',
          detail: { name: 'rig-02', previousName: 'rig-01' },
        })
      );
    });

    it('stores the description alongside the name', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.update(NODE_ID, 'rig-02', '  The rack A head node  ', ACTOR_ID);

      expect(nodeRepository.update).toHaveBeenCalledWith(
        { id: NODE_ID },
        { name: 'rig-02', description: 'The rack A head node' }
      );
    });

    it('records no rename when only the description changed', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.update(NODE_ID, 'rig-01', 'The rack A head node', ACTOR_ID);

      expect(nodeRepository.update).toHaveBeenCalled();
      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });
  });

  describe('setEnabled', () => {
    it('throws when the node does not exist', async () => {
      nodeRepository.findOne.mockResolvedValue(null);

      await expect(nodeService.setEnabled(NODE_ID, false, ACTOR_ID)).rejects.toThrow(BadRequestException);

      expect(nodeRepository.update).not.toHaveBeenCalled();
    });

    it('stores the new enabled flag', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.setEnabled(NODE_ID, false, ACTOR_ID);

      expect(nodeRepository.update).toHaveBeenCalledWith({ id: NODE_ID }, { enabled: false });
    });

    it('records holding a node back apart from letting it work', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.setEnabled(NODE_ID, false, ACTOR_ID);
      await nodeService.setEnabled(NODE_ID, true, ACTOR_ID);

      expect(eventService.recordEvent).toHaveBeenNthCalledWith(
        1,
        EventType.NODE_DISABLED,
        EventSeverity.INFO,
        expect.objectContaining({ message: 'Disabled node **rig-01**' })
      );
      expect(eventService.recordEvent).toHaveBeenNthCalledWith(
        2,
        EventType.NODE_ENABLED,
        EventSeverity.INFO,
        expect.objectContaining({ message: 'Enabled node **rig-01**' })
      );
    });
  });

  describe('remove', () => {
    it('throws when the node does not exist', async () => {
      nodeRepository.findOne.mockResolvedValue(null);

      await expect(nodeService.remove(NODE_ID, ACTOR_ID)).rejects.toThrow(BadRequestException);

      expect(nodeRepository.delete).not.toHaveBeenCalled();
    });

    it('removes the row and records what it was called', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode());

      await nodeService.remove(NODE_ID, ACTOR_ID);

      expect(nodeRepository.delete).toHaveBeenCalledWith({ id: NODE_ID });
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.NODE_DELETED,
        EventSeverity.INFO,
        expect.objectContaining({
          subjectId: `${NODE_ID}`,
          message: 'Deleted node **rig-01**',
          detail: { name: 'rig-01' },
        })
      );
    });
  });
});
