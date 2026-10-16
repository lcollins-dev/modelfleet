import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { ServerMessageOf, ServerMessageType } from '@libs/agent-protocol';

import { ReconcilerService } from './reconciler.service';

@Controller()
export class ReconcileController {
  constructor(private readonly reconcilerService: ReconcilerService) {}

  @EventPattern(ServerMessageType.DESIRED_STATE)
  async handleDesiredState(@Payload() message: ServerMessageOf<ServerMessageType.DESIRED_STATE>): Promise<void> {
    await this.reconcilerService.applyDesiredState(message.payload);
  }
}
