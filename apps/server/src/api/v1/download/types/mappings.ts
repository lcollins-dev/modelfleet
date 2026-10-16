import { DownloadFileState as ProtocolDownloadFileState, DownloadState } from '@libs/agent-protocol';
import { DownloadFileState, DownloadProgressState } from '@libs/dto';

export const DOWNLOAD_PROGRESS_STATES: Record<DownloadState, DownloadProgressState> = {
  [DownloadState.QUEUED]: DownloadProgressState.QUEUED,
  [DownloadState.DOWNLOADING]: DownloadProgressState.DOWNLOADING,
  [DownloadState.SUCCEEDED]: DownloadProgressState.SUCCEEDED,
  [DownloadState.FAILED]: DownloadProgressState.FAILED,
};

export const DOWNLOAD_FILE_STATES: Record<ProtocolDownloadFileState, DownloadFileState> = {
  [ProtocolDownloadFileState.PENDING]: DownloadFileState.PENDING,
  [ProtocolDownloadFileState.VERIFYING]: DownloadFileState.VERIFYING,
  [ProtocolDownloadFileState.DOWNLOADING]: DownloadFileState.DOWNLOADING,
  [ProtocolDownloadFileState.HELD]: DownloadFileState.HELD,
  [ProtocolDownloadFileState.DONE]: DownloadFileState.DONE,
  [ProtocolDownloadFileState.FAILED]: DownloadFileState.FAILED,
};
