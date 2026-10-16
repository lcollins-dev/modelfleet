import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';

import { AgentMessageType, AgentPayloadMap } from '@libs/agent-protocol';

import { ServerClient } from './server-client';
import { ServerSessionService } from './server-session.service';

@Injectable()
export class ServerConnectionService {
  constructor(
    private readonly serverSessionService: ServerSessionService,
    private readonly serverClient: ServerClient
  ) {}

  sessionOpened(): Observable<void> {
    return this.serverSessionService.sessionOpened();
  }

  sessionClosed(): Observable<void> {
    return this.serverSessionService.sessionClosed();
  }

  /** Dropped where no session holds the link. */
  send<TType extends AgentMessageType>(type: TType, payload: AgentPayloadMap[TType]): void {
    // Subscribing is what surfaces a dispatch failure; `emit` connects itself.
    this.serverClient.emit(type, payload).subscribe();
  }
}
