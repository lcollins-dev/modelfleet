import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { ServerMessageOf, ServerMessageType } from '@libs/agent-protocol';

import { ServerSessionService } from './server-session.service';

@Controller()
export class ServerController {
  constructor(private readonly serverSessionService: ServerSessionService) {}

  @EventPattern(ServerMessageType.WELCOME)
  handleWelcome(@Payload() message: ServerMessageOf<ServerMessageType.WELCOME>): void {
    this.serverSessionService.active().handleWelcome(message.payload);
  }

  @EventPattern(ServerMessageType.REJECT)
  handleReject(@Payload() message: ServerMessageOf<ServerMessageType.REJECT>): void {
    this.serverSessionService.active().handleReject(message.payload);
  }
}
