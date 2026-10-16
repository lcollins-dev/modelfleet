import { Injectable } from '@nestjs/common';
import { access, constants, statfs } from 'node:fs/promises';
import { cpus, freemem, loadavg, totalmem } from 'node:os';

import {
  HostResources,
  MAX_CPU_MODEL_LENGTH,
  MAX_MODEL_DIRECTORIES,
  ModelDirectorySpace,
  ModelDirectoryWriteAccess,
} from '@libs/agent-protocol';

import { ConfigService } from '../config/config.service';

export const MOUNT_TIMEOUT_MS = 2000;

@Injectable()
export class HostResourcesService {
  private readonly unanswered = new Set<string>();

  constructor(private readonly configService: ConfigService) {}

  async read(): Promise<HostResources> {
    return {
      cpuModel: this.firstCpuModel(),
      cpuCount: cpus().length,
      loadAverage1m: this.oneMinuteLoad(),
      memoryTotalBytes: totalmem(),
      memoryFreeBytes: freemem(),
      modelDirectories: await Promise.all(
        this.configService.modelDirs.slice(0, MAX_MODEL_DIRECTORIES).map(path => this.measure(path))
      ),
    };
  }

  private async measure(path: string): Promise<ModelDirectorySpace> {
    const [space, writeAccess] = await Promise.all([
      this.answered(`statfs:${path}`, () => this.spaceOf(path), { freeBytes: null, totalBytes: null }),
      this.answered(`access:${path}`, () => this.writeAccessOf(path), null),
    ]);

    return { path, ...space, writeAccess };
  }

  /** Each call holds a libuv thread until the mount answers, so one still waiting is not asked again. */
  private async answered<T>(key: string, ask: () => Promise<T>, unknown: T): Promise<T> {
    if (this.unanswered.has(key)) {
      return unknown;
    }

    this.unanswered.add(key);

    const answer = ask().finally(() => this.unanswered.delete(key));

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<T>(resolve => {
      timer = setTimeout(() => resolve(unknown), MOUNT_TIMEOUT_MS);
    });

    return Promise.race([answer, timedOut]).finally(() => clearTimeout(timer));
  }

  /** Measures as `DownloadService.checkFreeSpace` does, so the console warns on the figure the agent refuses on. */
  private async spaceOf(path: string): Promise<Pick<ModelDirectorySpace, 'freeBytes' | 'totalBytes'>> {
    try {
      const space = await statfs(path);

      return { freeBytes: space.bavail * space.bsize, totalBytes: space.blocks * space.bsize };
    } catch {
      return { freeBytes: null, totalBytes: null };
    }
  }

  private async writeAccessOf(path: string): Promise<ModelDirectoryWriteAccess | null> {
    try {
      await access(path, constants.W_OK | constants.X_OK);

      return ModelDirectoryWriteAccess.WRITABLE;
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : null;

      if (code === 'EROFS') {
        return ModelDirectoryWriteAccess.READ_ONLY;
      }

      if (code === 'EACCES' || code === 'EPERM') {
        return ModelDirectoryWriteAccess.DENIED;
      }

      return null;
    }
  }

  private firstCpuModel(): string | null {
    const cores = cpus();
    const model = cores.length === 0 ? '' : cores[0].model.trim();

    return model.length > 0 ? model.slice(0, MAX_CPU_MODEL_LENGTH) : null;
  }

  private oneMinuteLoad(): number | null {
    const [oneMinute] = loadavg();

    return typeof oneMinute === 'number' && Number.isFinite(oneMinute) ? this.roundToTwo(oneMinute) : null;
  }

  private roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
