import { z } from 'zod';

import { timestamp } from '../../../fields';
import { NodeState } from '../node';

export enum DownloadSource {
  HUGGINGFACE = 'huggingface',
}

export enum DownloadState {
  ACTIVE = 'active',
  FAILED = 'failed',
  STOPPED = 'stopped',
  COMPLETED = 'completed',
}

export enum DownloadTargetState {
  ACTIVE = 'active',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  STOPPED = 'stopped',
}

export enum DownloadProgressState {
  QUEUED = 'queued',
  DOWNLOADING = 'downloading',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export enum DownloadFileState {
  PENDING = 'pending',
  VERIFYING = 'verifying',
  DOWNLOADING = 'downloading',
  HELD = 'held',
  DONE = 'done',
  FAILED = 'failed',
}

export const DownloadFileDto = z.object({
  path: z.string(),
  sizeBytes: z.number(),
});
export type DownloadFileDto = z.infer<typeof DownloadFileDto>;

export const DownloadTargetFileDto = z.object({
  path: z.string(),

  state: z.enum(DownloadFileState).nullable(),

  bytesDone: z.number(),
});
export type DownloadTargetFileDto = z.infer<typeof DownloadTargetFileDto>;

export const DownloadTargetDto = z.object({
  nodeId: z.number(),
  nodeName: z.string(),
  nodeState: z.enum(NodeState),
  state: z.enum(DownloadTargetState),

  progress: z.enum(DownloadProgressState).nullable(),

  message: z.string().nullable(),

  bytesDone: z.number(),
  totalBytes: z.number(),

  bytesPerSecond: z.number().nullable(),

  files: z.array(DownloadTargetFileDto),
  settledDate: timestamp().nullable(),
});
export type DownloadTargetDto = z.infer<typeof DownloadTargetDto>;

export const DownloadDto = z.object({
  id: z.number(),

  key: z.string(),

  source: z.enum(DownloadSource),
  repository: z.string(),

  /** Relative to each node's first model directory. */
  directory: z.string(),

  revision: z.string(),

  state: z.enum(DownloadState),
  files: z.array(DownloadFileDto),
  targets: z.array(DownloadTargetDto),

  /** Across every node, so a download to two nodes totals twice its files. */
  bytesDone: z.number(),
  totalBytes: z.number(),

  createdByName: z.string().optional(),

  createdDate: timestamp(),
});
export type DownloadDto = z.infer<typeof DownloadDto>;

export const DownloadTargetProgressDto = z.object({
  nodeId: z.number(),
  progress: z.enum(DownloadProgressState),
  bytesDone: z.number(),
  bytesPerSecond: z.number().nullable(),
  files: z.array(DownloadTargetFileDto),
});
export type DownloadTargetProgressDto = z.infer<typeof DownloadTargetProgressDto>;

export const DownloadProgressDto = z.object({
  key: z.string(),
  targets: z.array(DownloadTargetProgressDto),
});
export type DownloadProgressDto = z.infer<typeof DownloadProgressDto>;
