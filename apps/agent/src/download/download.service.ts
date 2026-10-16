import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { readdir, rm, statfs } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Observable, Subject } from 'rxjs';

import {
  AgentDownloadProgress,
  DOWNLOAD_PARTIAL_SUFFIX,
  DesiredDownload,
  DesiredDownloadFile,
  DownloadFileState,
  DownloadState,
  MAX_MESSAGE_LENGTH,
  ObservedDownloadFile,
  ServerDesiredDownloads,
} from '@libs/agent-protocol';

import { ModelService } from '../model/model.service';
import { DownloadLocationService } from './download-location.service';
import { FileFetcherService } from './file-fetcher.service';
import { DownloadError } from './types/errors';

/** Fetched last: a safetensors directory with no shard numbering reads as a whole model once it holds one. */
const MODEL_MARKER_FILE = 'config.json';

interface IDownloadRun {
  download: DesiredDownload;
  state: DownloadState;
  message: string | null;

  /** In the download's own order, one per file, updated in place as the run goes. */
  files: ObservedDownloadFile[];

  abort: AbortController;
}

/**
 * Holds the server's download set and works through it one download and one file at a time, so a download takes
 * one connection's worth of the node's bandwidth and disk. A download the server drops is aborted and its partial
 * files removed; a settled one is kept, and reported, until the server drops it.
 */
@Injectable()
export class DownloadService implements OnModuleDestroy {
  private readonly logger = new Logger(DownloadService.name);

  private readonly changed = new Subject<void>();

  private readonly runs = new Map<string, IDownloadRun>();

  private working = false;

  /** Set as the agent stops, so what it aborts on the way out stays on disk to resume from. */
  private shuttingDown = false;

  private swept = false;

  /** Each set is applied once the one before has finished, so a sweep never sees a newer set's partials. */
  private applying: Promise<void> = Promise.resolve();

  constructor(
    private readonly downloadLocationService: DownloadLocationService,
    private readonly fileFetcherService: FileFetcherService,
    private readonly modelService: ModelService
  ) {}

  onModuleDestroy(): void {
    this.shuttingDown = true;

    for (const run of this.runs.values()) {
      run.abort.abort();
    }
  }

  /** Fires on every change, a byte count included, so a subscriber throttles it. */
  changes(): Observable<void> {
    return this.changed.asObservable();
  }

  currentProgress(): AgentDownloadProgress {
    return {
      downloads: [...this.runs.values()].map(run => ({
        downloadKey: run.download.downloadKey,
        attempt: run.download.attempt,
        state: run.state,
        message: run.message,
        files: run.files.map(file => ({ ...file })),
      })),
    };
  }

  applyDesiredDownloads(desiredDownloads: ServerDesiredDownloads): Promise<void> {
    const applied = this.applying.then(() => this.apply(desiredDownloads));

    this.applying = applied.catch(() => undefined);

    return applied;
  }

  private async apply(desiredDownloads: ServerDesiredDownloads): Promise<void> {
    const desired = new Map(desiredDownloads.downloads.map(download => [download.downloadKey, download]));

    for (const [downloadKey, run] of this.runs) {
      if (!desired.has(downloadKey)) {
        this.runs.delete(downloadKey);
        await this.drop(run);
      }
    }

    for (const download of desired.values()) {
      const run = this.runs.get(download.downloadKey);

      if (run === undefined || this.isRetried(run, download)) {
        this.runs.set(download.downloadKey, this.queue(download));
      } else {
        // One still under way is the work a retry asks for, so it carries on under the new attempt and token.
        run.download.attempt = download.attempt;
        run.download.token = download.token;
      }
    }

    this.changed.next();

    // Only a restart can leave a partial no run knows of, so the first set is the one to clear them against.
    if (!this.swept) {
      this.swept = true;

      await this.removeUnwantedPartials(desiredDownloads.downloads);
    }

    this.work().catch((error: unknown) => {
      this.logger.error({ error }, 'applyDesiredDownloads(): Working through the download set failed');
    });
  }

  private isRetried(run: IDownloadRun, download: DesiredDownload): boolean {
    const settled = run.state === DownloadState.SUCCEEDED || run.state === DownloadState.FAILED;

    return settled && run.download.attempt !== download.attempt;
  }

  /** A running download removes its own partials as it stops; one that never ran may hold some from before a restart. */
  private async drop(run: IDownloadRun): Promise<void> {
    if (run.state === DownloadState.QUEUED) {
      await this.removePartials(run.download);
    } else {
      run.abort.abort();
    }
  }

  private queue(download: DesiredDownload): IDownloadRun {
    const files = [...download.files].sort((left, right) => this.fetchOrder(left) - this.fetchOrder(right));

    return {
      download: { ...download, files },
      state: DownloadState.QUEUED,
      message: null,
      files: files.map(file => ({ path: file.path, state: DownloadFileState.PENDING, bytesDone: 0 })),
      abort: new AbortController(),
    };
  }

  private fetchOrder(file: DesiredDownloadFile): number {
    return basename(file.path) === MODEL_MARKER_FILE ? 1 : 0;
  }

  /** One run at a time. A set arriving mid-run is picked up by the loop, never by a second one. */
  private async work(): Promise<void> {
    if (this.working) {
      return;
    }

    this.working = true;

    try {
      let next = this.nextQueued();

      while (next !== undefined) {
        await this.run(next);

        next = this.nextQueued();
      }
    } finally {
      this.working = false;
    }
  }

  private nextQueued(): IDownloadRun | undefined {
    return [...this.runs.values()].find(run => run.state === DownloadState.QUEUED);
  }

  private async run(run: IDownloadRun): Promise<void> {
    const { download, abort } = run;

    run.state = DownloadState.DOWNLOADING;
    this.changed.next();

    try {
      await this.download(run);

      run.state = DownloadState.SUCCEEDED;

      this.logger.log(
        { downloadKey: download.downloadKey, repository: download.repository },
        'run(): A download finished'
      );
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        await this.removePartials(download);
        this.fail(run, error);
      } else if (this.shuttingDown) {
        this.logger.log(
          { downloadKey: download.downloadKey },
          'run(): A download was left to resume on the next start'
        );
      } else {
        await this.removePartials(download);
        this.logger.log({ downloadKey: download.downloadKey }, 'run(): A download was stopped');
      }
    }

    // Whatever finished before a failure or a stop stays on disk, and is catalogued like any other file.
    this.changed.next();
    this.modelService.requestScan();
  }

  private fail(run: IDownloadRun, error: unknown): void {
    run.state = DownloadState.FAILED;
    run.message = this.messageOf(error);

    for (const file of run.files) {
      if (file.state !== DownloadFileState.HELD && file.state !== DownloadFileState.DONE) {
        file.state = DownloadFileState.FAILED;
      }
    }

    this.logger.error({ error, downloadKey: run.download.downloadKey }, 'fail(): A download failed');
  }

  /** Held to the length the report carries, since one over it would make every report unsendable. */
  private messageOf(error: unknown): string {
    const message =
      error instanceof DownloadError ? error.message : 'The download failed for a reason the agent logged';

    return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 3)}...` : message;
  }

  private async download(run: IDownloadRun): Promise<void> {
    const { download, abort } = run;

    await this.checkHeldAndPartial(run);

    const required = download.files.reduce(
      (sum, file, index) => sum + (run.files[index].state === DownloadFileState.HELD ? 0 : file.sizeBytes),
      0
    );
    const onDisk = run.files.reduce(
      (sum, file) => sum + (file.state === DownloadFileState.HELD ? 0 : file.bytesDone),
      0
    );

    await this.checkFreeSpace(download, required - onDisk);

    for (const [index, file] of download.files.entries()) {
      const observed = run.files[index];

      if (observed.state === DownloadFileState.HELD) {
        continue;
      }

      await this.fileFetcherService.fetch(
        download,
        file,
        this.downloadLocationService.fileLocation(download, file),
        abort.signal,
        (state, bytesDone) => {
          observed.state = state;
          observed.bytesDone = bytesDone;
          this.changed.next();
        }
      );

      observed.state = DownloadFileState.DONE;
      observed.bytesDone = file.sizeBytes;
      this.changed.next();
    }
  }

  private async checkHeldAndPartial(run: IDownloadRun): Promise<void> {
    const { download, abort } = run;

    for (const [index, file] of download.files.entries()) {
      const observed = run.files[index];
      const location = this.downloadLocationService.fileLocation(download, file);

      await this.downloadLocationService.checkContained(location);

      observed.state = DownloadFileState.VERIFYING;
      this.changed.next();

      if (await this.fileFetcherService.isHeld(file, location, abort.signal)) {
        observed.state = DownloadFileState.HELD;
        observed.bytesDone = file.sizeBytes;
      } else {
        observed.state = DownloadFileState.PENDING;
        observed.bytesDone = await this.fileFetcherService.partialBytes(file, location);
      }

      this.changed.next();
    }
  }

  private async checkFreeSpace(download: DesiredDownload, requiredBytes: number): Promise<void> {
    if (requiredBytes <= 0) {
      return;
    }

    const modelDirectory = this.downloadLocationService.modelDirectory();
    let freeBytes: number;

    try {
      const space = await statfs(modelDirectory);

      freeBytes = space.bavail * space.bsize;
    } catch (error: unknown) {
      this.logger.error({ error, modelDirectory }, 'checkFreeSpace(): The model directory could not be read');

      throw new DownloadError(`The model directory ${modelDirectory} could not be read`);
    }

    if (freeBytes < requiredBytes) {
      throw new DownloadError(
        `${download.repository} needs ${this.gib(requiredBytes)} GiB but ${modelDirectory} has ${this.gib(freeBytes)} GiB free`
      );
    }
  }

  private gib(bytes: number): string {
    return (bytes / 1024 ** 3).toFixed(1);
  }

  /** Leaves alone a partial a symlink carries out of the model directory, which is not the agent's to remove. */
  private async removePartials(download: DesiredDownload): Promise<void> {
    for (const file of download.files) {
      try {
        const { partialPath } = this.downloadLocationService.fileLocation(download, file);

        if (await this.downloadLocationService.isContained(partialPath)) {
          await rm(partialPath, { force: true });
        }
      } catch (error: unknown) {
        this.logger.error({ error, path: file.path }, 'removePartials(): A partial file could not be removed');
      }
    }
  }

  /**
   * Clears partials anywhere under the model directory that no wanted file maps to, left by a download the server dropped
   * while this agent was down. Only a set the server sent reaches here, so a restart out of contact loses nothing.
   */
  private async removeUnwantedPartials(downloads: DesiredDownload[]): Promise<void> {
    const wanted = new Set<string>();
    let entries;

    // No model directory, or one that cannot be read, leaves nothing to clear.
    try {
      for (const download of downloads) {
        for (const file of download.files) {
          wanted.add(this.downloadLocationService.fileLocation(download, file).partialPath);
        }
      }

      // Resolved, since a wanted partial's path is, and a relative one would match none of them.
      const modelDirectory = resolve(this.downloadLocationService.modelDirectory());

      entries = await readdir(modelDirectory, { recursive: true, withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(entry.parentPath, entry.name);

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(DOWNLOAD_PARTIAL_SUFFIX) || wanted.has(path)) {
        continue;
      }

      await rm(path, { force: true }).catch((error: unknown) => {
        this.logger.error({ error, path }, 'removeUnwantedPartials(): A partial file could not be removed');
      });
    }
  }
}
