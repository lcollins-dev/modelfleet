import { z } from 'zod';

import { enumValue, id, optionalText, requestBody, selection, text } from '../../../fields';
import { DownloadState, DownloadDto, DownloadProgressDto } from './download';

// Must equal the agent protocol's bounds, which a server test checks.
export const DOWNLOAD_MAX_FILES = 64;
export const DOWNLOAD_MAX_PATH_LENGTH = 512;
export const DOWNLOAD_MAX_DIRECTORY_LENGTH = 256;

const DOWNLOAD_MAX_NODES = 64;

export const CreateDownloadRequestDto = requestBody({
  /** `owner/name` on the source. */
  repository: text(3, 193, { trim: true }),

  /** Absent or empty reads as `main`. Pinned to its commit when the download is created. */
  revision: optionalText(256),

  /** Relative to each node's first model directory. */
  directory: text(1, DOWNLOAD_MAX_DIRECTORY_LENGTH, { trim: true }),

  files: selection(text(0, DOWNLOAD_MAX_PATH_LENGTH, { trim: true }), 1, DOWNLOAD_MAX_FILES),
  nodeIds: selection(id(), 1, DOWNLOAD_MAX_NODES),
});
export type CreateDownloadRequestDto = z.infer<typeof CreateDownloadRequestDto>;

export const RepositoryListingRequestDto = requestBody({
  /** `owner/name` on the source. */
  repository: text(3, 193, { trim: true }),

  /** A branch, tag or commit. Absent or empty reads as `main`. */
  revision: optionalText(256),
});
export type RepositoryListingRequestDto = z.infer<typeof RepositoryListingRequestDto>;

export const RepositoryFileDto = z.object({
  path: z.string(),
  sizeBytes: z.number(),
});
export type RepositoryFileDto = z.infer<typeof RepositoryFileDto>;

export const RepositoryListingResponseDto = z.object({
  /** As the source spells it, whatever case it was asked for in. */
  repository: z.string(),

  /** The commit the revision pointed at. Passed back as a download's `revision`, it pins the download to what was listed. */
  revision: z.string(),

  /** Sorted by path. */
  files: z.array(RepositoryFileDto),

  /** The repository holds more files than `files`, which are the ones the source listed first. */
  truncated: z.boolean(),

  maxFilesPerDownload: z.number(),
});
export type RepositoryListingResponseDto = z.infer<typeof RepositoryListingResponseDto>;

export const StopDownloadRequestDto = requestBody({
  /** Absent or null stops every node still downloading. */
  nodeId: id().nullish(),
});
export type StopDownloadRequestDto = z.infer<typeof StopDownloadRequestDto>;

export const DownloadListRequestDto = requestBody({
  /** Matches the repository. */
  search: optionalText(512),

  state: enumValue(DownloadState).optional(),
});
export type DownloadListRequestDto = z.infer<typeof DownloadListRequestDto>;

export const DownloadListResponseDto = z.object({
  downloadList: z.array(DownloadDto),
  pages: z.number(),

  /** How many downloads match the search in each state, whatever state the list is narrowed to. */
  counts: z.record(z.enum(DownloadState), z.number()),
});
export type DownloadListResponseDto = z.infer<typeof DownloadListResponseDto>;

/** Every download a connected node is reporting on, whatever page or filter the reader holds. */
export const DownloadProgressResponseDto = z.object({
  downloads: z.array(DownloadProgressDto),
});
export type DownloadProgressResponseDto = z.infer<typeof DownloadProgressResponseDto>;
