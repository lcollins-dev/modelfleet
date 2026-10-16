import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDownloadProgress, AgentMessageType } from '@libs/agent-protocol';

import { DownloadPublisher } from '@/download/download.publisher';
import { DownloadService } from '@/download/download.service';
import { ServerConnectionService } from '@/server/server-connection.service';

const PROGRESS: AgentDownloadProgress = { downloads: [] };

describe('DownloadPublisher', () => {
  let changes: Subject<void>;
  let welcomes: Subject<void>;
  let send: ReturnType<typeof vi.fn>;
  let publisher: DownloadPublisher;

  beforeEach(() => {
    vi.useFakeTimers();

    changes = new Subject<void>();
    welcomes = new Subject<void>();
    send = vi.fn();

    publisher = new DownloadPublisher(
      { changes: () => changes.asObservable(), currentProgress: () => PROGRESS } as unknown as DownloadService,
      { sessionOpened: () => welcomes.asObservable(), send } as unknown as ServerConnectionService
    );

    publisher.onModuleInit();
  });

  afterEach(() => {
    publisher.onModuleDestroy();
    vi.useRealTimers();
  });

  it('sends a burst of byte counts as one report at once and one more once it settles', () => {
    for (let chunk = 0; chunk < 100; chunk += 1) {
      changes.next();
    }

    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(AgentMessageType.DOWNLOAD_PROGRESS, PROGRESS);
  });

  it('states what it holds again on every welcome, so a restarted server learns progress back', () => {
    welcomes.next();

    expect(send).toHaveBeenCalledWith(AgentMessageType.DOWNLOAD_PROGRESS, PROGRESS);
  });
});
