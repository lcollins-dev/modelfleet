import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { WebSocket } from 'ws';

import { AgentMessageType, AgentRelay, ServerMessageType, ServerPayloadMap } from '@libs/agent-protocol';

import { AgentSessionService } from './agent-session.service';

import { AgentClient } from './agent-client';

@Injectable()
export class AgentConnectionService {
  constructor(private readonly agentSessionService: AgentSessionService) {}

  /** The node each welcomed handshake speaks for. */
  sessionOpened(): Observable<number> {
    return this.agentSessionService.sessionOpened();
  }

  /** The node each ended session was holding. */
  sessionClosed(): Observable<number> {
    return this.agentSessionService.sessionClosed();
  }

  /** The node a welcomed socket speaks for, refusing any other connection. */
  readyNodeId(client: WebSocket, type: AgentMessageType): number | null {
    return this.agentSessionService.readyNodeId(client, type);
  }

  /** Where a node's inference relay is reached, and the token it accepts. Null unless the node holds a session. */
  relayFor(nodeId: number): AgentRelay | null {
    return this.agentSessionService.relayFor(nodeId);
  }

  /** What the node's agent asked to be left free on each card. Null unless the node holds a session that said. */
  gpuHeadroomFor(nodeId: number): number | null {
    return this.agentSessionService.gpuHeadroomFor(nodeId);
  }

  /** Dropped where the node holds no session. */
  send<TType extends ServerMessageType>(nodeId: number, type: TType, payload: ServerPayloadMap[TType]): void {
    // Subscribing is what surfaces a dispatch failure; `emit` connects itself.
    new AgentClient(this.agentSessionService, nodeId).emit(type, payload).subscribe();
  }
}
