import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { AgentDownloadProgress, DownloadFileState, DownloadState, ObservedDownload } from '@libs/agent-protocol';

/** Reports arrive about once a second, so this spans roughly the last ten seconds. */
const RATE_SAMPLES = 10;

interface IProgressSample {
  /** Every byte fetched since the window opened, which a resumed partial or a held file never adds to. */
  fetchedBytes: number;
  atMs: number;
}

interface IHeldDownload {
  report: ObservedDownload;
  samples: IProgressSample[];
}

/**
 * What each connected node last said about its downloads, and how fast each is moving. Held in memory alone: the node
 * restates it on every welcome, so a server restart loses nothing a reconnection does not bring back.
 */
@Injectable()
export class DownloadProgressService {
  private readonly byNode = new Map<number, Map<string, IHeldDownload>>();

  private readonly changed = new Subject<number>();

  getProgressChanges(): Observable<number> {
    return this.changed.asObservable();
  }

  replace(nodeId: number, report: AgentDownloadProgress): void {
    const previous = this.byNode.get(nodeId);
    const atMs = Date.now();

    const held = report.downloads.map((download): [string, IHeldDownload] => [
      download.downloadKey,
      { report: download, samples: this.sampled(previous?.get(download.downloadKey), download, atMs) },
    ]);

    this.byNode.set(nodeId, new Map(held));
    this.changed.next(nodeId);
  }

  /** Null where the node is not connected, or has not reported on this download. */
  get(nodeId: number, downloadKey: string): ObservedDownload | null {
    return this.byNode.get(nodeId)?.get(downloadKey)?.report ?? null;
  }

  /** Null where the download is not moving, or the node has reported on it only once. */
  bytesPerSecond(nodeId: number, downloadKey: string): number | null {
    const held = this.byNode.get(nodeId)?.get(downloadKey);

    if (held?.report.state !== DownloadState.DOWNLOADING || held.samples.length < 2) {
      return null;
    }

    const first = held.samples[0];
    const last = held.samples[held.samples.length - 1];
    const elapsedMs = last.atMs - first.atMs;

    return elapsedMs > 0 ? ((last.fetchedBytes - first.fetchedBytes) / elapsedMs) * 1000 : null;
  }

  /** Every download each connected node is reporting on, keyed by node. */
  nodeIds(): number[] {
    return [...this.byNode.keys()];
  }

  reportsFrom(nodeId: number): ObservedDownload[] {
    return [...(this.byNode.get(nodeId)?.values() ?? [])].map(held => held.report);
  }

  forget(nodeId: number): void {
    this.byNode.delete(nodeId);
    this.changed.next(nodeId);
  }

  /** A new attempt opens a new window. */
  private sampled(previous: IHeldDownload | undefined, download: ObservedDownload, atMs: number): IProgressSample[] {
    const samples = previous?.report.attempt === download.attempt ? previous.samples : [];
    const fetchedBytes =
      (samples.at(-1)?.fetchedBytes ?? 0) +
      this.fetchedSince(samples.length > 0 ? previous?.report : undefined, download);

    return [...samples, { fetchedBytes, atMs }].slice(-RATE_SAMPLES);
  }

  /**
   * What each file gained while it was downloading. A file found held, or its partial measured, jumps without a byte
   * crossing the wire, and a file started again goes backwards.
   */
  private fetchedSince(previous: ObservedDownload | undefined, download: ObservedDownload): number {
    const before = new Map((previous?.files ?? []).map(file => [file.path, file]));

    return download.files.reduce((sum, file) => {
      const was = before.get(file.path);
      const moving = file.state === DownloadFileState.DOWNLOADING || was?.state === DownloadFileState.DOWNLOADING;

      return was !== undefined && moving ? sum + Math.max(0, file.bytesDone - was.bytesDone) : sum;
    }, 0);
  }
}
