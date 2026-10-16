import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { EventPartyType, EventSeverity, EventType, NodeState } from '@libs/dto';

import { Node } from './entities/node.entity';

import { EventService } from '../event/event.service';
import { NodeStateService } from './node-state.service';
import { ConfigService } from '@/config/config.service';

const NODE_MISSING_MESSAGE = 'This node does not exist';
const NODE_NAME_TAKEN_MESSAGE = 'A node with this name already exists';

const SECRET_PREFIX = 'mfn_';
const SECRET_BYTES = 32;

export interface INodeCriteria {
  search?: string;
  states?: NodeState[];
}

export interface IRegisteredNode {
  node: Node;

  /** Readable here alone - the row keeps only the hash. */
  secret: string;
}

@Injectable()
export class NodeService {
  constructor(
    private readonly configService: ConfigService,
    private readonly eventService: EventService,
    private readonly nodeStateService: NodeStateService,
    @InjectRepository(Node)
    private readonly nodeRepository: Repository<Node>
  ) {}

  /** Records the registration against the actor. */
  @Transactional()
  async register(name: string, description: string, actorId: number): Promise<IRegisteredNode> {
    name = name.trim();
    description = description.trim();

    await this.checkNameIsFree(name);

    const secret = `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
    const secretHash = await bcrypt.hash(secret, this.configService.nodeSecretHashRounds);

    const node = new Node({
      nodeKey: randomUUID(),
      name,
      secretHash,
      description: description.length > 0 ? description : null,
    });
    await this.nodeRepository.insert(node);

    await this.eventService.recordEvent(EventType.NODE_REGISTERED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.NODE,
      subjectId: `${node.id}`,
      message: `Registered node **${node.name}**`,
      detail: { name: node.name },
    });

    return { node, secret };
  }

  /** Ordered by name. */
  findAndCount(criteria: INodeCriteria, skip: number, take: number): Promise<[Node[], number]> {
    const queryBuilder = this.nodeRepository.createQueryBuilder('node');

    if (criteria.search !== undefined) {
      queryBuilder.andWhere('LOWER(node.name) LIKE LOWER(:search)', { search: `%${criteria.search}%` });
    }

    if (criteria.states !== undefined && criteria.states.length > 0) {
      this.narrowToStates(queryBuilder, criteria.states);
    }

    return queryBuilder.orderBy('node.name', 'ASC').take(take).skip(skip).getManyAndCount();
  }

  async findWithThrow(nodeId: number): Promise<Node> {
    const node = await this.find(nodeId);

    if (!node) {
      throw new BadRequestException(NODE_MISSING_MESSAGE);
    }

    return node;
  }

  /** Ordered by name. */
  findAll(): Promise<Node[]> {
    return this.nodeRepository.find({ order: { name: 'ASC' } });
  }

  find(nodeId: number): Promise<Node | null> {
    return this.nodeRepository.findOne({ where: { id: nodeId } });
  }

  /** A node that no longer exists is absent from the map, not an error. */
  async findNames(nodeIds: number[]): Promise<Map<number, string>> {
    if (nodeIds.length === 0) {
      return new Map();
    }

    const nodes = await this.nodeRepository.find({ select: ['id', 'name'], where: { id: In(nodeIds) } });

    return new Map(nodes.map(node => [node.id, node.name]));
  }

  /** An unchanged name records no rename, so a description-only edit is silent. */
  @Transactional()
  async update(nodeId: number, name: string, description: string, actorId: number): Promise<void> {
    name = name.trim();
    description = description.trim();

    const node = await this.findWithThrow(nodeId);
    const renamed = node.name.toLowerCase() !== name.toLowerCase();

    if (renamed) {
      await this.checkNameIsFree(name);
    }

    await this.nodeRepository.update(
      { id: node.id },
      { name, description: description.length > 0 ? description : null }
    );

    if (!renamed) {
      return;
    }

    await this.eventService.recordEvent(EventType.NODE_RENAMED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.NODE,
      subjectId: `${node.id}`,
      message: `Renamed node **${node.name}** to **${name}**`,
      detail: { name, previousName: node.name },
    });
  }

  /** Records the change against the actor. */
  @Transactional()
  async setEnabled(nodeId: number, enabled: boolean, actorId: number): Promise<void> {
    const node = await this.findWithThrow(nodeId);

    await this.nodeRepository.update({ id: node.id }, { enabled });

    await this.eventService.recordEvent(
      enabled ? EventType.NODE_ENABLED : EventType.NODE_DISABLED,
      EventSeverity.INFO,
      {
        actorType: EventPartyType.USER,
        actorId: `${actorId}`,
        subjectType: EventPartyType.NODE,
        subjectId: `${node.id}`,
        message: `${enabled ? 'Enabled' : 'Disabled'} node **${node.name}**`,
        detail: { name: node.name },
      }
    );
  }

  /** Drops the state held for the node and records the removal against the actor. */
  @Transactional()
  async remove(nodeId: number, actorId: number): Promise<void> {
    const node = await this.findWithThrow(nodeId);

    await this.nodeRepository.delete({ id: node.id });

    this.nodeStateService.forget(node.id);

    await this.eventService.recordEvent(EventType.NODE_DELETED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.NODE,
      subjectId: `${node.id}`,
      message: `Deleted node **${node.name}**`,
      detail: { name: node.name },
    });
  }

  getState(node: Node): NodeState {
    if (!node.enabled) {
      return NodeState.DISABLED;
    }

    if (node.lastSeenDate === null) {
      return NodeState.REGISTERED;
    }

    return node.lastSeenDate > this.getOfflineCutoff() ? NodeState.ONLINE : NodeState.OFFLINE;
  }

  /** A heartbeat older than this leaves its node offline. */
  getOfflineCutoff(): Date {
    return new Date(Date.now() - this.configService.nodeOfflineThresholdMs);
  }

  /** Matches the unique index, which is over the lowercased name. */
  private async checkNameIsFree(name: string): Promise<void> {
    const named = await this.nodeRepository
      .createQueryBuilder('node')
      .where('LOWER(node.name) = LOWER(:name)', { name })
      .getOne();

    if (named) {
      throw new BadRequestException(NODE_NAME_TAKEN_MESSAGE);
    }
  }

  /** Each condition mirrors `getState`, which reads the same state off the same columns. */
  private narrowToStates(queryBuilder: SelectQueryBuilder<Node>, states: NodeState[]): void {
    const conditions: Record<NodeState, string> = {
      [NodeState.DISABLED]: 'node.enabled = false',
      [NodeState.ONLINE]: 'node.enabled = true AND node.lastSeenDate > :cutoff',
      [NodeState.OFFLINE]: 'node.enabled = true AND node.lastSeenDate <= :cutoff',
      [NodeState.REGISTERED]: 'node.enabled = true AND node.lastSeenDate IS NULL',
    };

    queryBuilder.andWhere(
      new Brackets(where => {
        for (const state of states) {
          where.orWhere(`(${conditions[state]})`);
        }
      }),
      { cutoff: this.getOfflineCutoff() }
    );
  }
}
