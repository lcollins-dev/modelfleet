import type {
  DownloadDto,
  DownloadProgressDto,
  DownloadTargetDto,
  NodeHostTelemetryDto,
  RepositoryFileDto,
} from '@libs/dto';
import {
  DownloadFileState,
  DownloadProgressState,
  DownloadState,
  DownloadTargetState,
  ModelDirectoryWriteAccess,
} from '@libs/dto';

import { formatDuration } from './format/date';
import { formatBytes } from './format/number';

export type DownloadStateTone = 'primary' | 'success' | 'error' | 'default';

export interface IRepositoryAddress {
  repository: string;
  revision: string | null;
}

export interface IDownloadSpace {
  warns: boolean;
  text: string;
}

const HUB_HOSTS = ['huggingface.co', 'www.huggingface.co', 'hf.co'];

/** The routes of a Hub address whose next segment is a revision. */
const REVISION_ROUTES = ['tree', 'blob', 'resolve'];

/** First segments of Hub addresses that name something other than a model repository. */
const NON_MODEL_ROUTES = [
  'datasets',
  'spaces',
  'buckets',
  'settings',
  'docs',
  'blog',
  'papers',
  'collections',
  'organizations',
];
export type DownloadBarTone = 'primary' | 'success' | 'error' | 'muted';

const STATE_LABELS: Record<DownloadState, string> = {
  [DownloadState.ACTIVE]: 'Downloading',
  [DownloadState.FAILED]: 'Failed',
  [DownloadState.STOPPED]: 'Stopped',
  [DownloadState.COMPLETED]: 'Done',
};

const STATE_TONES: Record<DownloadState, DownloadStateTone> = {
  [DownloadState.ACTIVE]: 'primary',
  [DownloadState.FAILED]: 'error',
  [DownloadState.STOPPED]: 'default',
  [DownloadState.COMPLETED]: 'success',
};

const STATE_BARS: Record<DownloadState, DownloadBarTone> = {
  [DownloadState.ACTIVE]: 'primary',
  [DownloadState.FAILED]: 'error',
  [DownloadState.STOPPED]: 'muted',
  [DownloadState.COMPLETED]: 'success',
};

const SUMMARY_VERBS: Record<DownloadState, string> = {
  [DownloadState.ACTIVE]: 'Downloading to',
  [DownloadState.FAILED]: 'Failed on',
  [DownloadState.STOPPED]: 'Stopped on',
  [DownloadState.COMPLETED]: 'Completed on',
};

const FILE_LABELS: Record<DownloadFileState, string> = {
  [DownloadFileState.PENDING]: 'Waiting',
  [DownloadFileState.VERIFYING]: 'Checking',
  [DownloadFileState.DOWNLOADING]: 'Downloading',
  [DownloadFileState.HELD]: 'Already held',
  [DownloadFileState.DONE]: 'Done',
  [DownloadFileState.FAILED]: 'Failed',
};

const TARGET_STATES: Record<DownloadTargetState, DownloadState> = {
  [DownloadTargetState.ACTIVE]: DownloadState.ACTIVE,
  [DownloadTargetState.SUCCEEDED]: DownloadState.COMPLETED,
  [DownloadTargetState.FAILED]: DownloadState.FAILED,
  [DownloadTargetState.STOPPED]: DownloadState.STOPPED,
};

const PROGRESS_LABELS: Record<DownloadProgressState, string> = {
  [DownloadProgressState.QUEUED]: 'Queued behind another download on this node',
  [DownloadProgressState.DOWNLOADING]: 'Downloading',
  [DownloadProgressState.SUCCEEDED]: 'Finishing',
  [DownloadProgressState.FAILED]: 'Finishing',
};

const WRITE_REFUSALS: Record<Exclude<ModelDirectoryWriteAccess, ModelDirectoryWriteAccess.WRITABLE>, string> = {
  [ModelDirectoryWriteAccess.READ_ONLY]: 'Read-only',
  [ModelDirectoryWriteAccess.DENIED]: 'Not writable by the agent',
};

export const formatDownloadState = (state: DownloadState): string => STATE_LABELS[state];

export const downloadStateTone = (state: DownloadState): DownloadStateTone => STATE_TONES[state];

export const downloadStateBar = (state: DownloadState): DownloadBarTone => STATE_BARS[state];

export const downloadTargetState = (target: DownloadTargetDto): DownloadState => TARGET_STATES[target.state];

export const formatDownloadFileState = (state: DownloadFileState | null): string =>
  state === null ? 'Unknown' : FILE_LABELS[state];

/** A whole percentage, never 100 until every byte is there. */
export const downloadPercent = (bytesDone: number, totalBytes: number): number => {
  if (totalBytes <= 0) {
    return 100;
  }

  return bytesDone >= totalBytes ? 100 : Math.min(99, Math.floor((bytesDone / totalBytes) * 100));
};

/** `29.4 GiB / 47.4 GiB (62%)` */
export const formatDownloadAmount = (bytesDone: number, totalBytes: number): string =>
  `${formatBytes(bytesDone)} / ${formatBytes(totalBytes)} (${downloadPercent(bytesDone, totalBytes)}%)`;

/** `Downloading to gpu-01`, or `Failed on 1 of 2 nodes` where the nodes do not all share the outcome. */
export const summariseDownload = (download: DownloadDto): string => {
  const total = download.targets.length;
  const sharing = download.targets.filter(target => downloadTargetState(target) === download.state).length;

  if (total === 0) {
    return 'On no nodes';
  }

  if (sharing === total) {
    return `${SUMMARY_VERBS[download.state]} ${total === 1 ? download.targets[0].nodeName : `${total} nodes`}`;
  }

  return `${SUMMARY_VERBS[download.state]} ${sharing} of ${total} nodes`;
};

const movingRate = (target: DownloadTargetDto): number | null =>
  target.state === DownloadTargetState.ACTIVE && target.bytesPerSecond !== null && target.bytesPerSecond > 0
    ? target.bytesPerSecond
    : null;

/** Null while bytes move, when the speed and time left say what the node is doing. */
export const describeDownloadTarget = (target: DownloadTargetDto): string | null => {
  if (target.state !== DownloadTargetState.ACTIVE) {
    return target.message;
  }

  if (target.progress === null) {
    return 'Waiting for the node to report';
  }

  return movingRate(target) === null ? PROGRESS_LABELS[target.progress] : null;
};

export const formatDownloadSpeed = (target: DownloadTargetDto): string => {
  const rate = movingRate(target);

  return rate === null ? '-' : `${formatBytes(rate)}/s`;
};

export const formatDownloadTimeLeft = (target: DownloadTargetDto): string => {
  const rate = movingRate(target);

  return rate === null ? '-' : formatDuration((target.totalBytes - target.bytesDone) / rate);
};

/** Lays what the nodes last reported over a download read from the rows. Only a target still active takes any. */
export const withProgress = (download: DownloadDto, progress: DownloadProgressDto | undefined): DownloadDto => {
  if (progress === undefined) {
    return download;
  }

  const targets = download.targets.map(target => {
    const live = progress.targets.find(entry => entry.nodeId === target.nodeId);

    if (live === undefined || target.state !== DownloadTargetState.ACTIVE) {
      return target;
    }

    return {
      ...target,
      progress: live.progress,
      bytesDone: live.bytesDone,
      bytesPerSecond: live.bytesPerSecond,
      // In the order the download names them, which the node's report does not keep.
      files: target.files.map(file => live.files.find(entry => entry.path === file.path) ?? file),
    };
  });

  return { ...download, targets, bytesDone: targets.reduce((sum, target) => sum + target.bytesDone, 0) };
};

export const defaultDownloadDirectory = (repository: string): string => {
  const trimmed = repository.trim();

  return trimmed.length > 0 ? `huggingface/${trimmed}` : '';
};

/** Reads `owner/name`, or a model's address on the Hub with any revision it names. Null for anything else. */
export const parseRepositoryAddress = (input: string): IRepositoryAddress | null => {
  const trimmed = input.trim();
  const named = HUB_HOSTS.some(host => trimmed.toLowerCase().startsWith(`${host}/`));

  if (!/^https?:\/\//i.test(trimmed) && !named) {
    const parts = trimmed.split('/');

    return parts.length === 2 && parts.every(part => part.length > 0) ? { repository: trimmed, revision: null } : null;
  }

  let segments: string[];

  try {
    const url = new URL(named ? `https://${trimmed}` : trimmed);

    if (!HUB_HOSTS.includes(url.hostname.toLowerCase())) {
      return null;
    }

    segments = url.pathname
      .split('/')
      .filter(segment => segment.length > 0)
      .map(segment => decodeURIComponent(segment));
  } catch {
    return null;
  }

  if (segments.length < 2 || NON_MODEL_ROUTES.includes(segments[0])) {
    return null;
  }

  const revision = REVISION_ROUTES.includes(segments[2]) && segments.length > 3 ? segments[3] : null;

  return { repository: `${segments[0]}/${segments[1]}`, revision };
};

export const selectedBytes = (files: RepositoryFileDto[], paths: string[]): number =>
  files.filter(file => paths.includes(file.path)).reduce((sum, file) => sum + file.sizeBytes, 0);

const describeFreeSpace = (freeBytes: number | null, totalBytes: number): IDownloadSpace => {
  if (freeBytes === null) {
    return { warns: false, text: 'Free space unknown' };
  }

  if (freeBytes < totalBytes) {
    return { warns: true, text: `${formatBytes(freeBytes)} free · needs ${formatBytes(totalBytes)}` };
  }

  return { warns: false, text: `${formatBytes(freeBytes)} free` };
};

/** Against the first model directory, which is where a node writes a download. */
export const describeDownloadSpace = (host: NodeHostTelemetryDto | null, totalBytes: number): IDownloadSpace => {
  const directory = host?.modelDirectories[0];

  if (directory === undefined) {
    return { warns: false, text: 'Free space unknown' };
  }

  const space = describeFreeSpace(directory.freeBytes, totalBytes);

  if (directory.writeAccess === null || directory.writeAccess === ModelDirectoryWriteAccess.WRITABLE) {
    return space;
  }

  return { warns: true, text: `${WRITE_REFUSALS[directory.writeAccess]} · ${space.text}` };
};
