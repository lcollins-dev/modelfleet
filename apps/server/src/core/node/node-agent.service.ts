import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import { AgentHello, RejectReason, negotiateProtocolVersion } from '@libs/agent-protocol';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Node } from './entities/node.entity';

import { EventService } from '../event/event.service';

const UNKNOWN_NODE_MESSAGE = 'This node key is not registered';
const INVALID_CREDENTIALS_MESSAGE = 'The secret is incorrect for this node';
export const NODE_DISABLED_MESSAGE = 'This node is disabled';

function unsupportedVersionMessage(offered: readonly number[]): string {
  return `The server does not support any of these protocol versions: ${offered.join(', ')}`;
}

export interface IAgentAuthAccepted {
  ok: true;
  node: Node;
  protocolVersion: number;
}

export interface IAgentAuthRefused {
  ok: false;
  reason: RejectReason;
  message: string;
}

export type AgentAuthResult = IAgentAuthAccepted | IAgentAuthRefused;

@Injectable()
export class NodeAgentService {
  constructor(
    private readonly eventService: EventService,
    @InjectRepository(Node)
    private readonly nodeRepository: Repository<Node>
  ) {}

  /** Records a refusal as an event before returning it. */
  async authenticate(hello: AgentHello, remoteAddress: string): Promise<AgentAuthResult> {
    const protocolVersion = negotiateProtocolVersion(hello.protocolVersions);

    if (protocolVersion === null) {
      return this.refuse(
        RejectReason.UNSUPPORTED_PROTOCOL_VERSION,
        unsupportedVersionMessage(hello.protocolVersions),
        hello.nodeKey,
        remoteAddress
      );
    }

    const node = await this.nodeRepository.findOne({ where: { nodeKey: hello.nodeKey } });

    if (!node) {
      return this.refuse(RejectReason.UNKNOWN_NODE, UNKNOWN_NODE_MESSAGE, hello.nodeKey, remoteAddress);
    }

    if (!(await bcrypt.compare(hello.secret, node.secretHash))) {
      return this.refuse(RejectReason.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE, hello.nodeKey, remoteAddress);
    }

    if (!node.enabled) {
      return this.refuse(RejectReason.NODE_DISABLED, NODE_DISABLED_MESSAGE, hello.nodeKey, remoteAddress);
    }

    return { ok: true, node, protocolVersion };
  }

  /** Stamps `lastSeenDate` and `agentVersion` as well as recording the event. */
  async recordConnected(node: Node, hello: AgentHello, protocolVersion: number, remoteAddress: string): Promise<void> {
    await this.nodeRepository.update({ id: node.id }, { lastSeenDate: new Date(), agentVersion: hello.agentVersion });

    await this.eventService.recordEvent(EventType.NODE_CONNECTED, EventSeverity.INFO, {
      subjectType: EventPartyType.NODE,
      subjectId: `${node.id}`,
      message: `Node **${node.name}** connected from \`${remoteAddress}\` running agent \`${hello.agentVersion}\``,
      detail: { name: node.name, agentVersion: hello.agentVersion, protocolVersion, remoteAddress },
    });
  }

  async recordDisconnected(node: Node, closeCode: number): Promise<void> {
    await this.eventService.recordEvent(EventType.NODE_DISCONNECTED, EventSeverity.INFO, {
      subjectType: EventPartyType.NODE,
      subjectId: `${node.id}`,
      message: `Node **${node.name}** disconnected with close code \`${closeCode}\``,
      detail: { name: node.name, closeCode },
    });
  }

  async markSeen(nodeId: number): Promise<void> {
    await this.nodeRepository.update({ id: nodeId }, { lastSeenDate: new Date() });
  }

  async findLiveNode(nodeId: number): Promise<Node | null> {
    return this.nodeRepository.findOne({ where: { id: nodeId } });
  }

  private async refuse(
    reason: RejectReason,
    message: string,
    nodeKey: string,
    remoteAddress: string
  ): Promise<IAgentAuthRefused> {
    await this.eventService.recordEvent(EventType.NODE_CONNECTION_REFUSED, EventSeverity.WARNING, {
      subjectType: EventPartyType.NODE,
      message: `Refused a node connection from \`${remoteAddress}\`: ${message}`,
      detail: { reason, nodeKey, remoteAddress },
    });

    return { ok: false, reason, message };
  }
}
