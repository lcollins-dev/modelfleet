import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket } from 'ws';

import { AGENT_SOCKET_PATH, AgentMessageOf, AgentMessageType } from '@libs/agent-protocol';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { ModelCatalogueService } from './model-catalogue.service';

@WebSocketGateway({ path: AGENT_SOCKET_PATH })
export class ModelGateway {
  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly modelCatalogueService: ModelCatalogueService
  ) {}

  @SubscribeMessage(AgentMessageType.MODEL_INVENTORY)
  async handleModelInventory(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() message: AgentMessageOf<AgentMessageType.MODEL_INVENTORY>
  ): Promise<void> {
    const nodeId = this.agentConnectionService.readyNodeId(client, message.type);

    if (nodeId === null) {
      return;
    }

    await this.modelCatalogueService.mergeInventory(nodeId, message.payload);
  }
}
