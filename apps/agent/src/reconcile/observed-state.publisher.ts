import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { AgentMessageType } from '@libs/agent-protocol';

import { ServerConnectionService } from '../server/server-connection.service';
import { ReconcilerService } from './reconciler.service';

@Injectable()
export class ObservedStatePublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObservedStatePublisher.name);

  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly reconcilerService: ReconcilerService,
    private readonly serverConnectionService: ServerConnectionService
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.reconcilerService.changes().subscribe(observedState => {
        this.serverConnectionService.send(AgentMessageType.OBSERVED_STATE, observedState);
      })
    );

    // A reconnecting node reports what it holds, which corrects whatever the server believed.
    this.subscriptions.push(
      this.serverConnectionService.sessionOpened().subscribe(() => {
        this.reconcilerService.report().catch((error: unknown) => {
          this.logger.error({ error }, 'onModuleInit(): Reporting what this node holds failed');
        });
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
