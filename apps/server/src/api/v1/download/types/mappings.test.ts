import { describe, expect, it } from 'vitest';

import { DownloadFileState as ProtocolDownloadFileState, DownloadState } from '@libs/agent-protocol';
import { DownloadFileState, DownloadProgressState } from '@libs/dto';

import { DOWNLOAD_FILE_STATES, DOWNLOAD_PROGRESS_STATES } from '@/api/v1/download/types/mappings';

describe('DOWNLOAD_PROGRESS_STATES', () => {
  it.each([
    [DownloadState.QUEUED, DownloadProgressState.QUEUED],
    [DownloadState.DOWNLOADING, DownloadProgressState.DOWNLOADING],
    [DownloadState.SUCCEEDED, DownloadProgressState.SUCCEEDED],
    [DownloadState.FAILED, DownloadProgressState.FAILED],
  ])('maps %s to %s', (reported, shown) => {
    expect(DOWNLOAD_PROGRESS_STATES[reported]).toBe(shown);
  });
});

describe('DOWNLOAD_FILE_STATES', () => {
  it.each([
    [ProtocolDownloadFileState.PENDING, DownloadFileState.PENDING],
    [ProtocolDownloadFileState.VERIFYING, DownloadFileState.VERIFYING],
    [ProtocolDownloadFileState.DOWNLOADING, DownloadFileState.DOWNLOADING],
    [ProtocolDownloadFileState.HELD, DownloadFileState.HELD],
    [ProtocolDownloadFileState.DONE, DownloadFileState.DONE],
    [ProtocolDownloadFileState.FAILED, DownloadFileState.FAILED],
  ])('maps %s to %s', (reported, shown) => {
    expect(DOWNLOAD_FILE_STATES[reported]).toBe(shown);
  });
});
