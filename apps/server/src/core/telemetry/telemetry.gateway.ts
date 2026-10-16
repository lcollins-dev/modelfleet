import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { WebSocket } from 'ws';

import { AGENT_SOCKET_PATH, AgentMessageOf, AgentMessageType } from '@libs/agent-protocol';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { TelemetryService } from './telemetry.service';

@WebSocketGateway({ path: AGENT_SOCKET_PATH })
export class TelemetryGateway implements OnModuleInit, OnModuleDestroy {
  private closes: Subscription | null = null;

  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly telemetryService: TelemetryService
  ) {}

  onModuleInit(): void {
    this.closes = this.agentConnectionService.sessionClosed().subscribe(nodeId => {
      this.telemetryService.forget(nodeId);
    });
  }

  onModuleDestroy(): void {
    this.closes?.unsubscribe();
    this.closes = null;
  }

  @SubscribeMessage(AgentMessageType.TELEMETRY)
  handleTelemetry(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() message: AgentMessageOf<AgentMessageType.TELEMETRY>
  ): void {
    const nodeId = this.agentConnectionService.readyNodeId(client, message.type);

    if (nodeId === null) {
      return;
    }

    this.telemetryService.recordTelemetry(nodeId, message.payload);
  }
}
