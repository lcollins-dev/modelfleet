import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { AgentMessageType } from '@libs/agent-protocol';

import { ServerConnectionService } from '../server/server-connection.service';
import { ModelService } from './model.service';

@Injectable()
export class ModelPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly modelService: ModelService,
    private readonly serverConnectionService: ServerConnectionService
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.modelService.changes().subscribe(inventory => {
        this.serverConnectionService.send(AgentMessageType.MODEL_INVENTORY, inventory);
      })
    );

    this.subscriptions.push(
      this.serverConnectionService.sessionOpened().subscribe(() => {
        const inventory = this.modelService.currentInventory();

        if (inventory !== null) {
          this.serverConnectionService.send(AgentMessageType.MODEL_INVENTORY, inventory);
        }
      })
    );
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions.length = 0;
  }
}
