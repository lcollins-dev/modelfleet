import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { RestartSchedule } from '../../common/restart-schedule';
import { ConfigService } from '../../config/config.service';
import { GpuSnapshot, parseGpuSnapshot } from './gpu-snapshot';
import { LineBuffer } from './line-buffer';
import { MfGpuService } from './mf-gpu.service';
import { IReaderProcess } from './types/reader-process';

const MAX_LINE_BYTES = 1024 * 1024;

@Injectable()
export class DeviceReaderService implements OnModuleDestroy {
  private readonly logger = new Logger(DeviceReaderService.name);

  private readonly snapshots = new Subject<GpuSnapshot>();
  private readonly failures = new Subject<string>();

  private readonly restartSchedule: RestartSchedule;
  private readonly lines = new LineBuffer(MAX_LINE_BYTES);

  private reader: IReaderProcess | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly mfGpuService: MfGpuService
  ) {
    this.restartSchedule = new RestartSchedule(this.configService.telemetryRestartBackoff, () => {
      this.start();
    });
  }

  onModuleDestroy(): void {
    this.restartSchedule.stop();

    this.reader?.kill();
    this.reader = null;
  }

  snapshotStream(): Observable<GpuSnapshot> {
    return this.snapshots.asObservable();
  }

  failureStream(): Observable<string> {
    return this.failures.asObservable();
  }

  start(): void {
    if (this.reader !== null) {
      return;
    }

    const command = this.configService.gpuReaderPath;
    const intervalSeconds = Math.max(1, Math.round(this.configService.gpuReaderIntervalMs / 1000));

    this.logger.log(`start(): Spawning ${command} at a ${intervalSeconds}s interval`);

    this.lines.reset();

    const reader = this.mfGpuService.spawn({ command, intervalSeconds });
    this.reader = reader;

    reader.onStdout(chunk => {
      this.readChunk(chunk);
    });

    reader.onStderr(chunk => {
      const text = chunk.trim();

      if (text.length > 0) {
        this.logger.warn(`start(): The device reader reported: ${text}`);
      }
    });

    reader.onError(error => {
      this.fail(`The device reader could not be run: ${error.message}`);
    });

    reader.onExit((code, signal) => {
      this.fail(`The device reader exited with code ${String(code)} and signal ${String(signal)}`);
    });
  }

  /** Dropped where no reader is running. */
  requestSnapshot(): void {
    this.reader?.request();
  }

  private readChunk(chunk: string): void {
    let lines: string[];

    try {
      lines = this.lines.push(chunk);
    } catch (error: unknown) {
      this.failures.next(error instanceof Error ? error.message : 'The device reader wrote an unreadable chunk');

      return;
    }

    for (const line of lines) {
      this.readLine(line);
    }
  }

  private readLine(line: string): void {
    const result = parseGpuSnapshot(line);

    if (!result.ok) {
      this.failures.next(`A snapshot was refused: ${result.reason}`);

      return;
    }

    this.restartSchedule.reset();
    this.snapshots.next(result.snapshot);
  }

  private fail(reason: string): void {
    if (this.reader === null) {
      return;
    }

    this.reader = null;
    this.failures.next(reason);

    const delayMs = this.restartSchedule.schedule();

    if (delayMs !== null) {
      this.logger.warn(
        { attempt: this.restartSchedule.attempts },
        `fail(): ${reason}, starting it again in ${delayMs}ms`
      );
    }
  }
}
