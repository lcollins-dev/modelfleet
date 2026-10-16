import { z } from 'zod';

import { MAX_MESSAGE_LENGTH } from './limits';

/** Where a download's files come from, and the directory beneath the model directory they land in. */
export enum DownloadSource {
  HUGGINGFACE = 'huggingface',
}

export enum DownloadDigestAlgorithm {
  /** An LFS object's own id: the SHA-256 of its content. */
  SHA256 = 'sha256',

  /** A git blob id: the SHA-1 of `blob <size>\0` followed by the content. */
  GIT_SHA1 = 'git-sha1',
}

export enum DownloadState {
  QUEUED = 'queued',
  DOWNLOADING = 'downloading',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export enum DownloadFileState {
  PENDING = 'pending',

  /** Reading bytes already on disk through the digest, before fetching or instead of it. */
  VERIFYING = 'verifying',

  DOWNLOADING = 'downloading',

  /** Already present with the right digest, so nothing was fetched. */
  HELD = 'held',

  DONE = 'done',
  FAILED = 'failed',
}

export const MAX_DOWNLOADS_PER_NODE = 16;
export const MAX_FILES_PER_DOWNLOAD = 64;
export const MAX_DOWNLOAD_PATH_LENGTH = 512;
export const MAX_DOWNLOAD_DIRECTORY_LENGTH = 256;
export const MAX_DOWNLOAD_URL_LENGTH = 8192;

/** What a file is called while it is incomplete. No format reader claims it, so the scan passes it over. */
export const DOWNLOAD_PARTIAL_SUFFIX = '.part';

const REPOSITORY_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]{0,95}';

/** `owner/name`. Each half opens with a letter or digit, so neither can be `.` or `..`. */
export const DOWNLOAD_REPOSITORY_PATTERN = new RegExp(`^${REPOSITORY_SEGMENT}/${REPOSITORY_SEGMENT}$`);

/** A full commit id, so the bytes a name resolves to cannot move while a download runs. */
export const DOWNLOAD_REVISION_PATTERN = /^[0-9a-f]{40}$/;

/** Printable ASCII with no whitespace: a header value `fetch` cannot send is quoted in the error it throws. */
export const DOWNLOAD_TOKEN_PATTERN = /^[\x21-\x7e]+$/;

export function isContainedDownloadPath(path: string): boolean {
  if (path.includes('\\') || path.includes('\0') || path.toLowerCase().endsWith(DOWNLOAD_PARTIAL_SUFFIX)) {
    return false;
  }

  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

export const downloadPathSchema = z
  .string()
  .min(1)
  .max(MAX_DOWNLOAD_PATH_LENGTH)
  .refine(isContainedDownloadPath, {
    error: `must be a relative path with no empty, . or .. segment, not ending ${DOWNLOAD_PARTIAL_SUFFIX}`,
  });

export const downloadDigestSchema = z.discriminatedUnion('algorithm', [
  z.object({ algorithm: z.literal(DownloadDigestAlgorithm.SHA256), value: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ algorithm: z.literal(DownloadDigestAlgorithm.GIT_SHA1), value: z.string().regex(/^[0-9a-f]{40}$/) }),
]);
export type DownloadDigest = z.infer<typeof downloadDigestSchema>;

export const desiredDownloadFileSchema = z.object({
  path: downloadPathSchema,

  /** Optional, so an agent that predates it still reads the set. */
  url: z
    .url({ protocol: /^https?$/ })
    .max(MAX_DOWNLOAD_URL_LENGTH)
    .optional(),

  sizeBytes: z.number().int().nonnegative(),
  digest: downloadDigestSchema,
});
export type DesiredDownloadFile = z.infer<typeof desiredDownloadFileSchema>;

export const desiredDownloadSchema = z.object({
  downloadKey: z.uuid(),

  /** Raised by each retry, so a node starts again rather than reporting how an earlier attempt ended. */
  attempt: z.number().int().nonnegative(),

  source: z.enum(DownloadSource),

  /** The origin the token belongs to. A file's `url` is fetched with it only where it shares this origin. */
  endpoint: z.url({ protocol: /^https?$/ }),

  repository: z.string().regex(DOWNLOAD_REPOSITORY_PATTERN),

  /** Where under the node's first model directory the files land, as a relative path. */
  directory: z.string().min(1).max(MAX_DOWNLOAD_DIRECTORY_LENGTH).refine(isContainedDownloadPath),
  revision: z.string().regex(DOWNLOAD_REVISION_PATTERN),

  files: z.array(desiredDownloadFileSchema).min(1).max(MAX_FILES_PER_DOWNLOAD),

  /** Sent to `endpoint` alone, as a bearer token. Optional, so an agent that predates it still reads the set. */
  token: z.string().regex(DOWNLOAD_TOKEN_PATTERN).optional(),
});
export type DesiredDownload = z.infer<typeof desiredDownloadSchema>;

export const serverDesiredDownloadsSchema = z.object({
  /** The node's whole set: a download absent from this list is one the server wants stopped. */
  downloads: z.array(desiredDownloadSchema).max(MAX_DOWNLOADS_PER_NODE),
});
export type ServerDesiredDownloads = z.infer<typeof serverDesiredDownloadsSchema>;

export const observedDownloadFileSchema = z.object({
  path: downloadPathSchema,
  state: z.enum(DownloadFileState),

  bytesDone: z.number().int().nonnegative(),
});
export type ObservedDownloadFile = z.infer<typeof observedDownloadFileSchema>;

export const observedDownloadSchema = z.object({
  downloadKey: z.uuid(),

  /** The attempt the node was asked for, so the server settles nothing from an earlier one. */
  attempt: z.number().int().nonnegative(),

  state: z.enum(DownloadState),

  message: z.string().min(1).max(MAX_MESSAGE_LENGTH).nullable(),

  files: z.array(observedDownloadFileSchema).max(MAX_FILES_PER_DOWNLOAD),
});
export type ObservedDownload = z.infer<typeof observedDownloadSchema>;

export const agentDownloadProgressSchema = z.object({
  /** Every download the agent holds, including a settled one the server has yet to drop. */
  downloads: z.array(observedDownloadSchema).max(MAX_DOWNLOADS_PER_NODE),
});
export type AgentDownloadProgress = z.infer<typeof agentDownloadProgressSchema>;
