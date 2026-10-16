import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentHello, PROTOCOL_VERSION, RejectReason } from '@libs/agent-protocol';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Node } from '@/core/node/entities/node.entity';

import { EventService } from '@/core/event/event.service';
import { NodeAgentService } from '@/core/node/node-agent.service';

import { buildNode, TEST_NODE_ID as NODE_ID, TEST_NODE_KEY as NODE_KEY } from '@/test/node.factory';

vi.mock('bcryptjs', () => ({
  compare: vi.fn(),
}));

type BcryptCompare = (secret: string, hash: string) => Promise<boolean>;

const REMOTE_ADDRESS = '192.0.2.7';

const RELAY = { url: 'http://localhost:3040', token: 'a-relay-token-long-enough-for-the-schema' };

const buildHello = (overrides: Partial<AgentHello> = {}): AgentHello => ({
  nodeKey: NODE_KEY,
  secret: 'mfn_secret',
  agentVersion: '1.2.3',
  protocolVersions: [PROTOCOL_VERSION],
  relay: RELAY,
  ...overrides,
});

describe('NodeAgentService', () => {
  let nodeAgentService: NodeAgentService;
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let nodeRepository: { findOne: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    nodeRepository = {
      findOne: vi.fn().mockResolvedValue(buildNode()),
      update: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked<BcryptCompare>(bcrypt.compare).mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NodeAgentService,
        { provide: EventService, useValue: eventService },
        { provide: getRepositoryToken(Node), useValue: nodeRepository },
      ],
    }).compile();

    nodeAgentService = moduleRef.get(NodeAgentService);
  });

  describe('authenticate', () => {
    it('accepts a known node presenting the right secret', async () => {
      const result = await nodeAgentService.authenticate(buildHello(), REMOTE_ADDRESS);

      expect(result.ok).toBe(true);
      expect(result.ok && result.node.id).toBe(NODE_ID);
      expect(result.ok && result.protocolVersion).toBe(PROTOCOL_VERSION);
    });

    it('refuses a version the server does not speak, without reading the node', async () => {
      const result = await nodeAgentService.authenticate(buildHello({ protocolVersions: [99] }), REMOTE_ADDRESS);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe(RejectReason.UNSUPPORTED_PROTOCOL_VERSION);
      expect(nodeRepository.findOne).not.toHaveBeenCalled();
    });

    it('refuses a node key that is not registered', async () => {
      nodeRepository.findOne.mockResolvedValue(null);

      const result = await nodeAgentService.authenticate(buildHello(), REMOTE_ADDRESS);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe(RejectReason.UNKNOWN_NODE);
    });

    it('refuses a secret that does not match', async () => {
      vi.mocked<BcryptCompare>(bcrypt.compare).mockResolvedValue(false);

      const result = await nodeAgentService.authenticate(buildHello(), REMOTE_ADDRESS);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe(RejectReason.INVALID_CREDENTIALS);
    });

    it('refuses a disabled node holding the right secret', async () => {
      nodeRepository.findOne.mockResolvedValue(buildNode({ enabled: false }));

      const result = await nodeAgentService.authenticate(buildHello(), REMOTE_ADDRESS);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe(RejectReason.NODE_DISABLED);
    });

    it('records every refusal as a warning naming the reason and the caller', async () => {
      nodeRepository.findOne.mockResolvedValue(null);

      await nodeAgentService.authenticate(buildHello(), REMOTE_ADDRESS);

      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.NODE_CONNECTION_REFUSED,
        EventSeverity.WARNING,
        expect.objectContaining({
          subjectType: EventPartyType.NODE,
          message: `Refused a node connection from \`${REMOTE_ADDRESS}\`: This node key is not registered`,
          detail: { reason: RejectReason.UNKNOWN_NODE, nodeKey: NODE_KEY, remoteAddress: REMOTE_ADDRESS },
        })
      );
    });

    it('records nothing when the handshake is accepted', async () => {
      await nodeAgentService.authenticate(buildHello(), REMOTE_ADDRESS);

      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });
  });

  describe('recordConnected', () => {
    it('stamps the node as seen and records the connection', async () => {
      const node = buildNode();

      await nodeAgentService.recordConnected(node, buildHello(), PROTOCOL_VERSION, REMOTE_ADDRESS);

      expect(nodeRepository.update).toHaveBeenCalledWith(
        { id: NODE_ID },
        { lastSeenDate: expect.any(Date) as Date, agentVersion: '1.2.3' }
      );
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.NODE_CONNECTED,
        EventSeverity.INFO,
        expect.objectContaining({
          subjectId: `${NODE_ID}`,
          message: `Node **rig-01** connected from \`${REMOTE_ADDRESS}\` running agent \`1.2.3\``,
          detail: {
            name: 'rig-01',
            agentVersion: '1.2.3',
            protocolVersion: PROTOCOL_VERSION,
            remoteAddress: REMOTE_ADDRESS,
          },
        })
      );
    });
  });

  describe('recordDisconnected', () => {
    it('records the close code the connection ended on', async () => {
      await nodeAgentService.recordDisconnected(buildNode(), 4002);

      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.NODE_DISCONNECTED,
        EventSeverity.INFO,
        expect.objectContaining({
          message: 'Node **rig-01** disconnected with close code `4002`',
          detail: { name: 'rig-01', closeCode: 4002 },
        })
      );
    });
  });
});
