import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentMessageOf, AgentMessageType, DownloadState } from '@libs/agent-protocol';
import { DownloadTargetState } from '@libs/dto';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { DownloadDesiredStateService } from '@/core/download/download-desired-state.service';
import { DownloadProgressService } from '@/core/download/download-progress.service';

import { DownloadGateway } from '@/core/download/download.gateway';

const NODE_ID = 4;

function messageOf(
  downloads: { downloadKey: string; attempt: number; state: DownloadState; message: string | null }[]
): AgentMessageOf<AgentMessageType.DOWNLOAD_PROGRESS> {
  return {
    type: AgentMessageType.DOWNLOAD_PROGRESS,
    protocolVersion: 3,
    messageId: '8f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f',
    sentAt: '2026-09-25T12:00:00.000Z',
    payload: { downloads: downloads.map(download => ({ ...download, files: [] })) },
  };
}

describe('DownloadGateway', () => {
  let readyNodeId: ReturnType<typeof vi.fn>;
  let settle: ReturnType<typeof vi.fn>;
  let downloadProgressService: DownloadProgressService;
  let gateway: DownloadGateway;

  beforeEach(() => {
    readyNodeId = vi.fn().mockReturnValue(NODE_ID);
    settle = vi.fn().mockResolvedValue(undefined);
    downloadProgressService = new DownloadProgressService();

    gateway = new DownloadGateway({ readyNodeId } as unknown as AgentConnectionService, downloadProgressService, {
      settle,
    } as unknown as DownloadDesiredStateService);
  });

  it('holds the report as the node progress and settles only what the node says has finished', async () => {
    await gateway.handleDownloadProgress(
      {} as WebSocket,
      messageOf([
        { downloadKey: 'running', attempt: 0, state: DownloadState.DOWNLOADING, message: null },
        { downloadKey: 'done', attempt: 0, state: DownloadState.SUCCEEDED, message: null },
        { downloadKey: 'broken', attempt: 2, state: DownloadState.FAILED, message: 'The disk filled' },
      ])
    );

    expect(downloadProgressService.get(NODE_ID, 'running')?.state).toBe(DownloadState.DOWNLOADING);
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledWith(
      { nodeId: NODE_ID, downloadKey: 'done', attempt: 0, message: null },
      DownloadTargetState.SUCCEEDED
    );
    expect(settle).toHaveBeenCalledWith(
      { nodeId: NODE_ID, downloadKey: 'broken', attempt: 2, message: 'The disk filled' },
      DownloadTargetState.FAILED
    );
  });

  it('ignores a report from a socket that has not been welcomed', async () => {
    readyNodeId.mockReturnValue(null);

    await gateway.handleDownloadProgress(
      {} as WebSocket,
      messageOf([{ downloadKey: 'done', attempt: 0, state: DownloadState.SUCCEEDED, message: null }])
    );

    expect(settle).not.toHaveBeenCalled();
    expect(downloadProgressService.get(NODE_ID, 'done')).toBeNull();
  });
});
