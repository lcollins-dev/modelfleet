import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';

import { HeldMemory, InstanceMemory, MAX_INSTANCE_MEMORY_READINGS } from '@libs/agent-protocol';

import { ContainerLookupService } from '../docker/container-lookup.service';

export interface IHeldMemoryReading {
  instanceMemory: InstanceMemory[];
  heldMemory: HeldMemory;
}

interface IProcessMemory {
  heldBytes: number;
  sharedBytes: number;
  residentBytes: number;
}

const BYTES_PER_KIB = 1024;
const UNKNOWN_MEMORY = { heldBytes: null, sharedBytes: null, residentBytes: null };

/** Reads `status`, the one procfs file whose cost does not scale with the size of a mapping. */
@Injectable()
export class InstanceMemoryService {
  constructor(private readonly containerLookupService: ContainerLookupService) {}

  async read(): Promise<IHeldMemoryReading> {
    const processes = await this.containerLookupService.processesByInstance();

    if (processes === null) {
      return { instanceMemory: [], heldMemory: { bytes: 0, anyUnknown: true } };
    }

    const instanceMemory = await Promise.all(
      [...processes]
        .slice(0, MAX_INSTANCE_MEMORY_READINGS)
        .map(async ([instanceKey, pids]) => ({ instanceKey, ...(await this.memoryOfProcesses(pids)) }))
    );

    const heldMemory: HeldMemory = { bytes: 0, anyUnknown: false };

    for (const { heldBytes } of instanceMemory) {
      if (heldBytes === null) {
        heldMemory.anyUnknown = true;
      } else {
        heldMemory.bytes += heldBytes;
      }
    }

    return { instanceMemory, heldMemory };
  }

  /** Null where no process could be read or one refused, so the sums would read short. */
  private async memoryOfProcesses(pids: readonly number[]): Promise<IProcessMemory | typeof UNKNOWN_MEMORY> {
    const figures = await Promise.all(pids.map(pid => this.memoryOf(pid)));
    const total: IProcessMemory = { heldBytes: 0, sharedBytes: 0, residentBytes: 0 };

    let read = 0;

    for (const figure of figures) {
      if (figure === null) {
        return UNKNOWN_MEMORY;
      }

      if (figure !== undefined) {
        total.heldBytes += figure.heldBytes;
        total.sharedBytes += figure.sharedBytes;
        total.residentBytes += figure.residentBytes;
        read += 1;
      }
    }

    return read === 0 ? UNKNOWN_MEMORY : total;
  }

  /**
   * Undefined where the process has exited since it was listed: a health check's shell comes and goes, and must not
   * turn a whole instance unknown. Null where the process exists and its figures cannot be read.
   */
  private async memoryOf(pid: number): Promise<IProcessMemory | null | undefined> {
    let status: string;

    try {
      status = await readFile(`/proc/${pid}/status`, 'utf8');
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : null;

      return code === 'ENOENT' || code === 'ESRCH' ? undefined : null;
    }

    const fileBackedBytes = this.statusBytes(status, 'RssFile');
    const anonymousBytes = this.statusBytes(status, 'RssAnon');

    // CUDA pinned host buffers come from the nvidia driver and show here, in neither of the other two.
    const sharedBytes = this.statusBytes(status, 'RssShmem');

    if (fileBackedBytes !== null && anonymousBytes !== null && sharedBytes !== null) {
      return { heldBytes: fileBackedBytes, sharedBytes, residentBytes: fileBackedBytes + anonymousBytes + sharedBytes };
    }

    // A zombie has no memory lines at all and holds nothing. A process with VmRSS and any line missing is unreadable.
    return /^VmRSS:/m.test(status) ? null : { heldBytes: 0, sharedBytes: 0, residentBytes: 0 };
  }

  private statusBytes(status: string, field: string): number | null {
    const match = new RegExp(`^${field}:\\s*(\\d+) kB$`, 'm').exec(status);

    return match === null ? null : Number.parseInt(match[1], 10) * BYTES_PER_KIB;
  }
}
