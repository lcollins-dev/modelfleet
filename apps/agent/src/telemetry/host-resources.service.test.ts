import { access, statfs } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_MODEL_DIRECTORIES, ModelDirectoryWriteAccess } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { HostResourcesService, MOUNT_TIMEOUT_MS } from '@/telemetry/host-resources.service';

vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  statfs: vi.fn(),
  access: vi.fn(),
}));

const BLOCK = 4096;
const WRITABLE = ModelDirectoryWriteAccess.WRITABLE;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('HostResourcesService', () => {
  const statfsMock = vi.mocked(statfs);
  const accessMock = vi.mocked(access);

  const serviceFor = (modelDirs: string[]): HostResourcesService =>
    new HostResourcesService({ modelDirs } as unknown as ConfigService);

  beforeEach(() => {
    statfsMock.mockReset();
    accessMock.mockReset();
    accessMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the space free to the agent in each model directory, in configured order', async () => {
    statfsMock.mockImplementation(path =>
      Promise.resolve({
        bsize: BLOCK,
        blocks: path === '/models/fast' ? 1000 : 5000,
        bavail: path === '/models/fast' ? 100 : 2500,
        bfree: 9999,
      } as Awaited<ReturnType<typeof statfs>>)
    );

    const host = await serviceFor(['/models/fast', '/models/bulk']).read();

    expect(host.modelDirectories).toEqual([
      { path: '/models/fast', freeBytes: 100 * BLOCK, totalBytes: 1000 * BLOCK, writeAccess: WRITABLE },
      { path: '/models/bulk', freeBytes: 2500 * BLOCK, totalBytes: 5000 * BLOCK, writeAccess: WRITABLE },
    ]);
  });

  it('reports a directory it cannot read without figures, and still reports the rest', async () => {
    statfsMock.mockImplementation(path =>
      path === '/models/gone'
        ? Promise.reject(new Error('ENOENT'))
        : Promise.resolve({ bsize: BLOCK, blocks: 10, bavail: 5, bfree: 5 } as Awaited<ReturnType<typeof statfs>>)
    );

    accessMock.mockImplementation(path =>
      path === '/models/gone' ? Promise.reject(errno('ENOENT')) : Promise.resolve()
    );

    const host = await serviceFor(['/models/gone', '/models/here']).read();

    expect(host.modelDirectories).toEqual([
      { path: '/models/gone', freeBytes: null, totalBytes: null, writeAccess: null },
      { path: '/models/here', freeBytes: 5 * BLOCK, totalBytes: 10 * BLOCK, writeAccess: WRITABLE },
    ]);
  });

  it.each([
    ['a read-only mount', 'EROFS', ModelDirectoryWriteAccess.READ_ONLY],
    ["a directory the agent's user may not write", 'EACCES', ModelDirectoryWriteAccess.DENIED],
    ['a directory the agent is not permitted to write', 'EPERM', ModelDirectoryWriteAccess.DENIED],
  ])('reports %s as not writable, naming which, beside its free space', async (_label, code, writeAccess) => {
    statfsMock.mockResolvedValue({ bsize: BLOCK, blocks: 10, bavail: 5, bfree: 5 } as Awaited<
      ReturnType<typeof statfs>
    >);
    accessMock.mockRejectedValue(errno(code));

    const host = await serviceFor(['/models']).read();

    expect(host.modelDirectories).toEqual([
      { path: '/models', freeBytes: 5 * BLOCK, totalBytes: 10 * BLOCK, writeAccess },
    ]);
  });

  it('reports no directories where none is configured', async () => {
    expect((await serviceFor([]).read()).modelDirectories).toEqual([]);
  });

  it('reports a directory whose mount does not answer without figures, and does not ask it again while it hangs', async () => {
    vi.useFakeTimers();

    let answer: (space: Awaited<ReturnType<typeof statfs>>) => void = () => undefined;

    statfsMock.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve;
        })
    );

    const service = serviceFor(['/mnt/nfs']);
    const first = service.read();

    await vi.advanceTimersByTimeAsync(MOUNT_TIMEOUT_MS);

    expect((await first).modelDirectories).toEqual([
      { path: '/mnt/nfs', freeBytes: null, totalBytes: null, writeAccess: WRITABLE },
    ]);

    const second = service.read();

    await vi.advanceTimersByTimeAsync(MOUNT_TIMEOUT_MS);

    expect((await second).modelDirectories).toEqual([
      { path: '/mnt/nfs', freeBytes: null, totalBytes: null, writeAccess: WRITABLE },
    ]);
    expect(statfsMock).toHaveBeenCalledTimes(1);

    const space = { bsize: BLOCK, blocks: 10, bavail: 5, bfree: 5 } as Awaited<ReturnType<typeof statfs>>;

    answer(space);
    statfsMock.mockResolvedValue(space);
    await vi.advanceTimersByTimeAsync(0);

    const third = service.read();

    await vi.advanceTimersByTimeAsync(0);

    expect((await third).modelDirectories).toEqual([
      { path: '/mnt/nfs', freeBytes: 5 * BLOCK, totalBytes: 10 * BLOCK, writeAccess: WRITABLE },
    ]);
    expect(statfsMock).toHaveBeenCalledTimes(2);
  });

  it('reports the free space of a directory whose write access does not answer', async () => {
    vi.useFakeTimers();

    statfsMock.mockResolvedValue({ bsize: BLOCK, blocks: 10, bavail: 5, bfree: 5 } as Awaited<
      ReturnType<typeof statfs>
    >);
    accessMock.mockReturnValue(new Promise(() => undefined));

    const reading = serviceFor(['/mnt/nfs']).read();

    await vi.advanceTimersByTimeAsync(MOUNT_TIMEOUT_MS);

    expect((await reading).modelDirectories).toEqual([
      { path: '/mnt/nfs', freeBytes: 5 * BLOCK, totalBytes: 10 * BLOCK, writeAccess: null },
    ]);
  });

  it('reports no more directories than a reading can carry', async () => {
    statfsMock.mockResolvedValue({ bsize: BLOCK, blocks: 10, bavail: 5, bfree: 5 } as Awaited<
      ReturnType<typeof statfs>
    >);

    const host = await serviceFor(Array.from({ length: MAX_MODEL_DIRECTORIES + 1 }, (_, i) => `/models/${i}`)).read();

    expect(host.modelDirectories).toHaveLength(MAX_MODEL_DIRECTORIES);
  });
});
