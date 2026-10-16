import { BeforeApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';

import { AGENT_SOCKET_PATH, AgentMessageOf, AgentMessageType } from '@libs/agent-protocol';

import { AgentSessionService } from './agent-session.service';

import { MALFORMED_MESSAGE_EVENT } from './agent-message-parser';

const MAX_FRAME_BYTES = 1024 * 1024;

@WebSocketGateway({ path: AGENT_SOCKET_PATH, maxPayload: MAX_FRAME_BYTES })
export class AgentGateway implements OnGatewayConnection, BeforeApplicationShutdown {
  constructor(private readonly agentSessionService: AgentSessionService) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    this.agentSessionService.open(client, request);
  }

  /** Runs before the socket server terminates every socket and before the data source closes. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.agentSessionService.closeAll();
  }

  @SubscribeMessage(AgentMessageType.HELLO)
  async handleHello(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() message: AgentMessageOf<AgentMessageType.HELLO>
  ): Promise<void> {
    await this.agentSessionService.forClient(client).handleHello(message.payload, message.messageId);
  }

  @SubscribeMessage(AgentMessageType.HEARTBEAT)
  async handleHeartbeat(@ConnectedSocket() client: WebSocket): Promise<void> {
    await this.agentSessionService.forClient(client).handleHeartbeat();
  }

  @SubscribeMessage(AgentMessageType.OBSERVED_STATE)
  handleObservedState(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() message: AgentMessageOf<AgentMessageType.OBSERVED_STATE>
  ): void {
    this.agentSessionService.forClient(client).handleObservedState(message.payload);
  }

  @SubscribeMessage(MALFORMED_MESSAGE_EVENT)
  handleMalformed(@ConnectedSocket() client: WebSocket, @MessageBody() reason: string): void {
    this.agentSessionService.forClient(client).handleMalformed(reason);
  }
}
