import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { AgentMessageType } from '@libs/agent-protocol';

import { ServerConnectionService } from '../server/server-connection.service';
import { TelemetryService } from './telemetry.service';

@Injectable()
export class TelemetryPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly telemetryService: TelemetryService,
    private readonly serverConnectionService: ServerConnectionService
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.telemetryService.inventoryChanges().subscribe(inventory => {
        this.serverConnectionService.send(AgentMessageType.GPU_INVENTORY, inventory);
      })
    );

    this.subscriptions.push(
      this.telemetryService.changes().subscribe(telemetry => {
        this.serverConnectionService.send(AgentMessageType.TELEMETRY, telemetry);
      })
    );

    this.subscriptions.push(
      this.serverConnectionService.sessionOpened().subscribe(() => {
        const inventory = this.telemetryService.currentInventory();

        if (inventory !== null) {
          this.serverConnectionService.send(AgentMessageType.GPU_INVENTORY, inventory);
        }

        this.telemetryService.requestSnapshot();
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
