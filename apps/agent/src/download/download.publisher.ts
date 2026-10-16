import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription, asyncScheduler, throttleTime } from 'rxjs';

import { AgentMessageType } from '@libs/agent-protocol';

import { ServerConnectionService } from '../server/server-connection.service';
import { DownloadService } from './download.service';

/** Progress moves with every chunk, so it goes on the wire at most this often, and always once it stops moving. */
const PROGRESS_INTERVAL_MS = 1000;

@Injectable()
export class DownloadPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly downloadService: DownloadService,
    private readonly serverConnectionService: ServerConnectionService
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.downloadService
        .changes()
        .pipe(throttleTime(PROGRESS_INTERVAL_MS, asyncScheduler, { leading: true, trailing: true }))
        .subscribe(() => {
          this.publish();
        })
    );

    this.subscriptions.push(
      this.serverConnectionService.sessionOpened().subscribe(() => {
        this.publish();
      })
    );
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions.length = 0;
  }

  private publish(): void {
    this.serverConnectionService.send(AgentMessageType.DOWNLOAD_PROGRESS, this.downloadService.currentProgress());
  }
}
