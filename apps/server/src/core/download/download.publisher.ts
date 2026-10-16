import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { ServerMessageType } from '@libs/agent-protocol';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { DownloadDesiredStateService } from './download-desired-state.service';
import { DownloadProgressService } from './download-progress.service';
import { DownloadService } from './download.service';

/** Sends a node its whole set of active downloads on every welcome and every change, read fresh from the rows. */
@Injectable()
export class DownloadPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DownloadPublisher.name);

  private readonly subscriptions: Subscription[] = [];

  /** One read and send at a time per node, so an older set can never overtake a newer one on the wire. */
  private readonly pending = new Map<number, Promise<void>>();

  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly downloadDesiredStateService: DownloadDesiredStateService,
    private readonly downloadProgressService: DownloadProgressService,
    private readonly downloadService: DownloadService
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.agentConnectionService.sessionOpened().subscribe(nodeId => {
        this.publish(nodeId);
      }),
      this.downloadService.getDesiredDownloadChanges().subscribe(nodeId => {
        this.publish(nodeId);
      }),
      this.agentConnectionService.sessionClosed().subscribe(nodeId => {
        this.downloadProgressService.forget(nodeId);
      })
    );
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions.length = 0;
  }

  private publish(nodeId: number): void {
    const previous = this.pending.get(nodeId) ?? Promise.resolve();

    const next = previous
      .then(async () => {
        const downloads = await this.downloadDesiredStateService.findDesired(nodeId);

        this.agentConnectionService.send(nodeId, ServerMessageType.DESIRED_DOWNLOADS, { downloads });
      })
      .catch((error: unknown) => {
        this.logger.error({ error, nodeId }, 'publish(): Sending a node its downloads failed');
      });

    this.pending.set(nodeId, next);
  }
}
