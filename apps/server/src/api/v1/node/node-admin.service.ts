import { Injectable } from '@nestjs/common';

import { ListNodeDto, NodeDto, NodeListRequestDto, NodeListResponseDto, RegisterNodeResponseDto } from '@libs/dto';

import { Node } from '@/core/node/entities/node.entity';

import { ConfigService } from '@/config/config.service';
import { NodeService } from '@/core/node/node.service';

@Injectable()
export class NodeAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly nodeService: NodeService
  ) {}

  async registerNode(name: string, description: string, actorId: number): Promise<RegisterNodeResponseDto> {
    const { node, secret } = await this.nodeService.register(name, description, actorId);

    return { id: node.id, name: node.name, nodeKey: node.nodeKey, secret };
  }

  async getNodeList(nodeListRequest: NodeListRequestDto, page: number): Promise<NodeListResponseDto> {
    const pageSize = this.configService.pageSize;

    const [nodes, total] = await this.nodeService.findAndCount(
      { search: nodeListRequest.search, states: nodeListRequest.state },
      pageSize * (page - 1),
      pageSize
    );

    return {
      nodeList: nodes.map(node => this.getIListNode(node)),
      pages: Math.ceil(total / pageSize),
    };
  }

  async getNode(nodeId: number): Promise<NodeDto> {
    const node = await this.nodeService.findWithThrow(nodeId);

    return {
      ...this.getIListNode(node),
      nodeKey: node.nodeKey,
      description: node.description,
      createdDate: node.createdDate,
    };
  }

  updateNode(nodeId: number, name: string, description: string, actorId: number): Promise<void> {
    return this.nodeService.update(nodeId, name, description, actorId);
  }

  updateState(nodeId: number, enabled: boolean, actorId: number): Promise<void> {
    return this.nodeService.setEnabled(nodeId, enabled, actorId);
  }

  deleteNode(nodeId: number, actorId: number): Promise<void> {
    return this.nodeService.remove(nodeId, actorId);
  }

  private getIListNode(node: Node): ListNodeDto {
    return {
      id: node.id,
      name: node.name,
      state: this.nodeService.getState(node),
      enabled: node.enabled,
      lastSeenDate: node.lastSeenDate ?? null,
      agentVersion: node.agentVersion,
    };
  }
}
