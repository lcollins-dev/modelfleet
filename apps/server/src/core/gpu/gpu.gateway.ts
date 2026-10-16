import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket } from 'ws';

import { AGENT_SOCKET_PATH, AgentMessageOf, AgentMessageType } from '@libs/agent-protocol';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { GpuService } from './gpu.service';

@WebSocketGateway({ path: AGENT_SOCKET_PATH })
export class GpuGateway {
  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly gpuService: GpuService
  ) {}

  @SubscribeMessage(AgentMessageType.GPU_INVENTORY)
  async handleGpuInventory(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() message: AgentMessageOf<AgentMessageType.GPU_INVENTORY>
  ): Promise<void> {
    const nodeId = this.agentConnectionService.readyNodeId(client, message.type);

    if (nodeId === null) {
      return;
    }

    await this.gpuService.replaceInventory(nodeId, message.payload);
  }
}
