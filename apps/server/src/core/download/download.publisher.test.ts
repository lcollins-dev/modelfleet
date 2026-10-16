import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesiredDownload, ServerMessageType } from '@libs/agent-protocol';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { DownloadDesiredStateService } from '@/core/download/download-desired-state.service';
import { DownloadProgressService } from '@/core/download/download-progress.service';
import { DownloadService } from '@/core/download/download.service';

import { DownloadPublisher } from '@/core/download/download.publisher';

const NODE_ID = 4;

describe('DownloadPublisher', () => {
  let opened: Subject<number>;
  let closed: Subject<number>;
  let desiredChanges: Subject<number>;
  let send: ReturnType<typeof vi.fn>;
  let findDesired: ReturnType<typeof vi.fn>;
  let forget: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    opened = new Subject<number>();
    closed = new Subject<number>();
    desiredChanges = new Subject<number>();
    send = vi.fn();
    findDesired = vi.fn().mockResolvedValue([]);
    forget = vi.fn();

    new DownloadPublisher(
      {
        sessionOpened: () => opened.asObservable(),
        sessionClosed: () => closed.asObservable(),
        send,
      } as unknown as AgentConnectionService,
      { findDesired } as unknown as DownloadDesiredStateService,
      { forget } as unknown as DownloadProgressService,
      { getDesiredDownloadChanges: () => desiredChanges.asObservable() } as unknown as DownloadService
    ).onModuleInit();
  });

  it('sends a node its set on every welcome, empty or not, so it knows the server has spoken', async () => {
    opened.next(NODE_ID);

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(NODE_ID, ServerMessageType.DESIRED_DOWNLOADS, { downloads: [] });
    });
  });

  it('never lets an older set overtake a newer one on the wire', async () => {
    const older = [{ downloadKey: 'older' }] as DesiredDownload[];
    const newer = [{ downloadKey: 'newer' }] as DesiredDownload[];
    let releaseOlder: () => void = () => undefined;

    findDesired
      .mockReturnValueOnce(
        new Promise(resolve => {
          releaseOlder = () => resolve(older);
        })
      )
      .mockResolvedValueOnce(newer);

    desiredChanges.next(NODE_ID);
    desiredChanges.next(NODE_ID);

    releaseOlder();

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
    expect(send.mock.calls.map(call => (call[2] as { downloads: DesiredDownload[] }).downloads)).toEqual([
      older,
      newer,
    ]);
  });

  it('forgets a node progress once its session closes', () => {
    closed.next(NODE_ID);

    expect(forget).toHaveBeenCalledWith(NODE_ID);
  });
});
