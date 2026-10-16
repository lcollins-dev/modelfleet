import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadFileState, DownloadState } from '@libs/agent-protocol';

import { DownloadProgressService } from '@/core/download/download-progress.service';

const NODE_ID = 4;
const KEY = '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f';

describe('DownloadProgressService', () => {
  let downloadProgressService: DownloadProgressService;

  const report = (
    bytesDone: number,
    state: DownloadState = DownloadState.DOWNLOADING,
    fileState: DownloadFileState = DownloadFileState.DOWNLOADING,
    attempt = 0
  ) => {
    downloadProgressService.replace(NODE_ID, {
      downloads: [
        {
          downloadKey: KEY,
          attempt,
          state,
          message: null,
          files: [{ path: 'model.gguf', state: fileState, bytesDone }],
        },
      ],
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    downloadProgressService = new DownloadProgressService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('knows no rate from a single report', () => {
    report(1000);

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBeNull();
  });

  it('reads the rate over the reports it has seen', () => {
    report(0);
    vi.setSystemTime(1000);
    report(100 * 1024 * 1024);
    vi.setSystemTime(2000);
    report(300 * 1024 * 1024);

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBe(150 * 1024 * 1024);
  });

  it('forgets the earliest reports, so the rate follows what the node is doing now', () => {
    for (let second = 0; second < 20; second += 1) {
      vi.setSystemTime(second * 1000);
      report(second < 10 ? second * 1000 : 9000 + (second - 9) * 100_000);
    }

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBe(100_000);
  });

  it('reads a file started again as fetching nothing that second, rather than a negative rate', () => {
    report(5000);
    vi.setSystemTime(1000);
    report(0);
    vi.setSystemTime(2000);
    report(2000);

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBe(1000);
  });

  it('does not read a file found held as speed', () => {
    report(0, DownloadState.DOWNLOADING, DownloadFileState.VERIFYING);
    vi.setSystemTime(1000);
    report(40 * 1024 ** 3, DownloadState.DOWNLOADING, DownloadFileState.HELD);

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBe(0);
  });

  it('does not read a partial measured before resuming as speed', () => {
    report(0, DownloadState.DOWNLOADING, DownloadFileState.PENDING);
    vi.setSystemTime(1000);
    report(8 * 1024 ** 3, DownloadState.DOWNLOADING, DownloadFileState.PENDING);
    vi.setSystemTime(2000);
    report(8 * 1024 ** 3 + 1000);

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBe(500);
  });

  it('opens a new window for a new attempt', () => {
    report(0);
    vi.setSystemTime(1000);
    report(5000, DownloadState.DOWNLOADING, DownloadFileState.DOWNLOADING, 1);

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBeNull();
  });

  it('reads no rate for a download that is not moving', () => {
    report(0);
    vi.setSystemTime(1000);
    report(1000, DownloadState.QUEUED);

    expect(downloadProgressService.bytesPerSecond(NODE_ID, KEY)).toBeNull();
  });
});
