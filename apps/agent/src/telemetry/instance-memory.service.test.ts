import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContainerLookupService } from '@/docker/container-lookup.service';
import { InstanceMemoryService } from '@/telemetry/instance-memory.service';

vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(),
}));

const KEY_A = '0199a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';
const KEY_B = '22222222-2222-4222-8222-222222222222';

const statusWith = (rssFileKib: number, rssAnonKib = 0): string =>
  `Name:\tllama-server\nVmRSS:\t  1048576 kB\nRssAnon:\t  ${rssAnonKib} kB\nRssFile:\t ${rssFileKib} kB\nRssShmem:\t 0 kB\nThreads:\t8\n`;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('InstanceMemoryService', () => {
  const readFileMock = vi.mocked(readFile);

  let processesByInstance: ReturnType<typeof vi.fn>;
  let service: InstanceMemoryService;

  const answer = (statuses: Record<number, string | Error>): void => {
    readFileMock.mockImplementation(path => {
      const pid = Number((path as string).split('/')[2]);
      const status = statuses[pid];

      return status instanceof Error ? Promise.reject(status) : Promise.resolve(status);
    });
  };

  beforeEach(() => {
    readFileMock.mockReset();

    processesByInstance = vi.fn();
    service = new InstanceMemoryService({ processesByInstance } as unknown as ContainerLookupService);
  });

  it('reports the file-backed pages of each instance and the sum across the node', async () => {
    processesByInstance.mockResolvedValue(
      new Map([
        [KEY_A, [10]],
        [KEY_B, [20]],
      ])
    );
    answer({ 10: statusWith(1024), 20: statusWith(2048) });

    await expect(service.read()).resolves.toEqual({
      instanceMemory: [
        { instanceKey: KEY_A, heldBytes: 1024 * 1024, residentBytes: 1024 * 1024 },
        { instanceKey: KEY_B, heldBytes: 2048 * 1024, residentBytes: 2048 * 1024 },
      ],
      heldMemory: { bytes: 3072 * 1024, anyUnknown: false },
    });
  });

  it('reads only the status file of each process', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10]]]));
    answer({ 10: statusWith(1) });

    await service.read();

    expect(readFileMock.mock.calls.map(([path]) => path)).toEqual(['/proc/10/status']);
  });

  it('sums every process in a multi-process backend', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10, 11]]]));
    answer({ 10: statusWith(1024), 11: statusWith(512) });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0].heldBytes).toBe(1536 * 1024);
  });

  it('keeps held to file-backed pages, and reports resident as those plus anonymous, summed across processes', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10, 11]]]));
    answer({ 10: statusWith(1024, 2048), 11: statusWith(512, 4096) });

    await expect(service.read()).resolves.toEqual({
      instanceMemory: [{ instanceKey: KEY_A, heldBytes: 1536 * 1024, residentBytes: 7680 * 1024 }],
      heldMemory: { bytes: 1536 * 1024, anyUnknown: false },
    });
  });

  it('reads almost nothing as held for a process that keeps its weights in anonymous memory', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10]]]));
    answer({ 10: statusWith(4, 104_857_600) });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0]).toMatchObject({ heldBytes: 4 * 1024, residentBytes: (4 + 104_857_600) * 1024 });
  });

  it('reads both figures as unknown for a process with VmRSS and no anonymous figure', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10]]]));
    answer({ 10: 'Name:\tllama-server\nVmRSS:\t2048 kB\nRssFile:\t1024 kB\n' });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0]).toMatchObject({ heldBytes: null, residentBytes: null });
  });

  it('reports a process that exists and reads zero as zero', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10]]]));
    answer({ 10: statusWith(0) });

    await expect(service.read()).resolves.toMatchObject({
      instanceMemory: [{ instanceKey: KEY_A, heldBytes: 0, residentBytes: 0 }],
      heldMemory: { bytes: 0, anyUnknown: false },
    });
  });

  it('keeps the known figures and flags the node where one instance cannot be read', async () => {
    processesByInstance.mockResolvedValue(
      new Map([
        [KEY_A, [10]],
        [KEY_B, [20]],
      ])
    );
    answer({ 10: statusWith(1024), 20: errno('EACCES') });

    await expect(service.read()).resolves.toEqual({
      instanceMemory: [
        { instanceKey: KEY_A, heldBytes: 1024 * 1024, residentBytes: 1024 * 1024 },
        { instanceKey: KEY_B, heldBytes: null, residentBytes: null },
      ],
      heldMemory: { bytes: 1024 * 1024, anyUnknown: true },
    });
  });

  it('reads as unknown an instance with one unreadable process among readable ones', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10, 11]]]));
    answer({ 10: statusWith(1024), 11: errno('EACCES') });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0].heldBytes).toBeNull();
  });

  it('passes over a process that exited since it was listed', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10, 11]]]));
    answer({ 10: statusWith(1024), 11: errno('ENOENT') });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0].heldBytes).toBe(1024 * 1024);
  });

  it('reads as unknown an instance none of whose processes can be found, as without the host PID namespace', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10, 11]]]));
    answer({ 10: errno('ENOENT'), 11: errno('ENOENT') });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0].heldBytes).toBeNull();
  });

  it('reads as unknown an instance whose processes could not be listed', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, []]]));

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0].heldBytes).toBeNull();
  });

  it('counts a zombie process as holding nothing', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10, 11]]]));
    answer({ 10: statusWith(1024), 11: 'Name:\tsh\nState:\tZ (zombie)\nThreads:\t1\n' });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0]).toMatchObject({ heldBytes: 1024 * 1024, residentBytes: 1024 * 1024 });
  });

  it('reads as unknown a kernel that reports no file-backed figure', async () => {
    processesByInstance.mockResolvedValue(new Map([[KEY_A, [10]]]));
    answer({ 10: 'Name:\tllama-server\nVmRSS:\t1024 kB\n' });

    const { instanceMemory } = await service.read();

    expect(instanceMemory[0]).toMatchObject({ heldBytes: null, residentBytes: null });
  });

  it('flags the node as unknown where docker has never answered', async () => {
    processesByInstance.mockResolvedValue(null);

    await expect(service.read()).resolves.toEqual({
      instanceMemory: [],
      heldMemory: { bytes: 0, anyUnknown: true },
    });
  });
});
