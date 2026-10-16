import { Injectable, Logger } from '@nestjs/common';
import { access, constants, mkdir, open, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { DesiredDownload, DesiredDownloadFile, DownloadFileState } from '@libs/agent-protocol';

import { Backoff } from '../common/backoff';
import { ConfigService } from '../config/config.service';
import { FileDigestService } from './file-digest.service';
import { DownloadError } from './types/errors';
import { IFileLocation } from './types/file-location';

export type FetchProgress = (state: DownloadFileState, bytesDone: number) => void;

interface ITransfer {
  download: DesiredDownload;
  file: DesiredDownloadFile;
  url: string;
  location: IFileLocation;
  signal: AbortSignal;
  onProgress: FetchProgress;
}

interface IContentRange {
  start: number;
  total: number;
}

@Injectable()
export class FileFetcherService {
  private readonly logger = new Logger(FileFetcherService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly fileDigestService: FileDigestService
  ) {}

  /** Throws where a file of another size or digest already holds the name, which a download never overwrites. */
  async isHeld(file: DesiredDownloadFile, location: IFileLocation, signal: AbortSignal): Promise<boolean> {
    const size = await this.sizeOf(location.filePath);

    if (size === null) {
      return false;
    }

    if (
      size !== file.sizeBytes ||
      !(await this.fileDigestService.matches(location.filePath, file.digest, file.sizeBytes, signal))
    ) {
      throw new DownloadError(`A different file is already at ${location.filePath}, so it was left alone`);
    }

    return true;
  }

  /** A partial longer than the file cannot be part of it, so it counts as nothing and is written over. */
  async partialBytes(file: DesiredDownloadFile, location: IFileLocation): Promise<number> {
    const size = (await this.sizeOf(location.partialPath)) ?? 0;

    return size > file.sizeBytes ? 0 : size;
  }

  /**
   * Resumes from any partial already on disk, and renames it into place only once the whole file on disk matches its
   * digest.
   * A dropped or stalled connection is fetched again from where it stopped; the retry limit counts attempts in a
   * row that added nothing.
   */
  async fetch(
    download: DesiredDownload,
    file: DesiredDownloadFile,
    location: IFileLocation,
    signal: AbortSignal,
    onProgress: FetchProgress
  ): Promise<void> {
    const url = this.urlOf(file);

    await this.onDisk(file, () => this.checkWritable(location));
    await this.onDisk(file, () => mkdir(dirname(location.partialPath), { recursive: true }));

    // An empty file has no body to fetch, so nothing else would create its partial.
    if (file.sizeBytes === 0) {
      await this.onDisk(file, () => writeFile(location.partialPath, ''));
    }

    const transfer: ITransfer = { download, file, url, location, signal, onProgress };

    await this.transferWithRetries(transfer);

    onProgress(DownloadFileState.VERIFYING, file.sizeBytes);

    if (!(await this.fileDigestService.matches(location.partialPath, file.digest, file.sizeBytes, signal))) {
      await rm(location.partialPath, { force: true });

      throw new DownloadError(`${file.path} did not match the digest the server records for it, so it was discarded`);
    }

    await this.onDisk(file, () => rename(location.partialPath, location.filePath));
  }

  private async onDisk<T>(file: DesiredDownloadFile, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      throw this.diskError(error, file) ?? error;
    }
  }

  /** A recursive `mkdir` refused by a read-only mount reports `ENOENT` against the leaf, so this asks first. */
  private async checkWritable(location: IFileLocation): Promise<void> {
    let existing = dirname(location.partialPath);

    while (existing !== location.modelDirectory && (await this.sizeOf(existing)) === null) {
      existing = dirname(existing);
    }

    await access(existing, constants.W_OK | constants.X_OK);
  }

  private async transferWithRetries(transfer: ITransfer): Promise<void> {
    const backoff = new Backoff(this.configService.downloadRetryBackoff);

    let failures = 0;

    for (;;) {
      const before = await this.partialBytes(transfer.file, transfer.location);

      try {
        if (before < transfer.file.sizeBytes) {
          await this.receive(transfer, before);
        }

        return;
      } catch (error: unknown) {
        if (!(error instanceof DownloadError) || !error.retryable) {
          throw error;
        }

        if ((await this.partialBytes(transfer.file, transfer.location)) > before) {
          failures = 0;
          backoff.reset();
        } else {
          failures += 1;
        }

        if (failures >= this.configService.downloadRetryLimit) {
          throw new DownloadError(`${transfer.file.path} failed ${failures} times in a row: ${error.message}`);
        }

        this.logger.warn(
          { path: transfer.file.path, failures, reason: error.message },
          'transferWithRetries(): Fetching a file failed, and it will be tried again'
        );

        await sleep(backoff.next(), undefined, { signal: transfer.signal });
      }
    }
  }

  private async receive(transfer: ITransfer, offset: number): Promise<void> {
    const { download, file, url, location, signal } = transfer;
    const stall = new AbortController();
    const stallTimer = setTimeout(() => stall.abort(), this.configService.downloadStallTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: this.headersOf(download, url, offset),
        signal: AbortSignal.any([signal, stall.signal]),
      });

      const start = await this.startOf(transfer, response, offset);

      if (response.body === null) {
        throw new DownloadError('The source answered with no body', true);
      }

      const handle = await open(location.partialPath, start === 0 ? 'w' : 'a');
      let received = start;

      try {
        for await (const chunk of response.body) {
          stallTimer.refresh();
          received += chunk.length;

          if (received > file.sizeBytes) {
            throw new DownloadError(`The source sent more of ${file.path} than the server records it holding`);
          }

          await handle.write(chunk);

          transfer.onProgress(DownloadFileState.DOWNLOADING, received);
        }
      } finally {
        await handle.close();
      }

      if (received < file.sizeBytes) {
        throw new DownloadError('The connection closed before the file was complete', true);
      }
    } catch (error: unknown) {
      throw this.classify(error, transfer, stall.signal);
    } finally {
      clearTimeout(stallTimer);
    }
  }

  /** Where in the file the response body begins: the offset asked for, or the start where the range was ignored. */
  private async startOf(transfer: ITransfer, response: Response, offset: number): Promise<number> {
    const { download, file, location } = transfer;

    if (response.status === 200) {
      return 0;
    }

    if (response.status === 206) {
      const range = this.parseContentRange(response.headers.get('content-range'));

      if (range?.start === offset && range.total === file.sizeBytes) {
        return offset;
      }
    }

    await response.body?.cancel();

    if (response.status === 206 || response.status === 416) {
      await truncate(location.partialPath, 0);

      throw new DownloadError(
        'The source answered a range other than the one asked for, so the file starts again',
        true
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new DownloadError(
        download.token === undefined
          ? `${file.path} cannot be reached without a token`
          : `The source refused the token for ${file.path}`
      );
    }

    if (response.status === 404) {
      throw new DownloadError(`${file.path} was not found at the source`);
    }

    if (response.status === 429 || response.status >= 500) {
      throw new DownloadError(`The source answered ${response.status}`, true);
    }

    throw new DownloadError(`The source answered ${response.status} for ${file.path}`);
  }

  private parseContentRange(header: string | null): IContentRange | null {
    const match = /^bytes (\d+)-\d+\/(\d+)$/.exec(header ?? '');

    if (match === null) {
      return null;
    }

    return { start: Number(match[1]), total: Number(match[2]) };
  }

  /** An abort from the caller passes through unchanged. */
  private classify(error: unknown, transfer: ITransfer, stallSignal: AbortSignal): unknown {
    if (transfer.signal.aborted || error instanceof DownloadError) {
      return error;
    }

    if (stallSignal.aborted) {
      return new DownloadError(`Nothing arrived for ${this.configService.downloadStallTimeout}`, true);
    }

    return (
      this.diskError(error, transfer.file) ??
      new DownloadError(error instanceof Error ? error.message : 'The fetch failed', true)
    );
  }

  private diskError(error: unknown, file: DesiredDownloadFile): DownloadError | null {
    const code = this.codeOf(error);

    if (code === 'ENOSPC') {
      return new DownloadError(`The disk filled while writing ${file.path}`);
    }

    if (code === 'EROFS') {
      return new DownloadError(`${file.path} could not be written: ${this.pathOf(error)} is read-only`);
    }

    if (code === 'EACCES' || code === 'EPERM') {
      const user = `the agent's user (uid ${process.getuid?.()})`;

      return new DownloadError(
        `${file.path} could not be written: permission denied to ${user} at ${this.pathOf(error)}`
      );
    }

    if (code !== null && error instanceof Error) {
      return new DownloadError(`${file.path} could not be written: ${error.message}`);
    }

    return null;
  }

  /** The filesystem's error code. A network failure carries its code on `cause`, so it reads as null here. */
  private codeOf(error: unknown): string | null {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      return error.code;
    }

    return null;
  }

  /** The directory refused: the path itself for an `access` check, and the parent of what `open` or `mkdir` named. */
  private pathOf(error: unknown): string {
    if (!(error instanceof Error && 'path' in error && typeof error.path === 'string')) {
      return 'its directory';
    }

    return 'syscall' in error && error.syscall === 'access' ? error.path : dirname(error.path);
  }

  /** `fetch` drops `Authorization` on a cross-origin redirect, so the token reaches the source and never its CDN. */
  private headersOf(download: DesiredDownload, url: string, offset: number): Record<string, string> {
    const headers: Record<string, string> = {};

    // The token is the endpoint's, so a URL the server named anywhere else is fetched without it.
    if (download.token !== undefined && new URL(url).origin === new URL(download.endpoint).origin) {
      headers.Authorization = `Bearer ${download.token}`;
    }

    if (offset > 0) {
      headers.Range = `bytes=${offset}-`;
    }

    return headers;
  }

  /** Only a server that predates resolving each file's URL sends one without it. */
  private urlOf(file: DesiredDownloadFile): string {
    if (file.url === undefined) {
      throw new DownloadError(`The server named no URL for ${file.path}`);
    }

    return file.url;
  }

  private async sizeOf(path: string): Promise<number | null> {
    try {
      return (await stat(path)).size;
    } catch (error: unknown) {
      if (this.codeOf(error) === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }
}
