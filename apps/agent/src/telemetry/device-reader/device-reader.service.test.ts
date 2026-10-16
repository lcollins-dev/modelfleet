import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { ConfigService } from '@/config/config.service';
import { DeviceReaderService } from '@/telemetry/device-reader/device-reader.service';
import { MfGpuService } from '@/telemetry/device-reader/mf-gpu.service';
import { IReaderCommand, IReaderProcess } from '@/telemetry/device-reader/types/reader-process';

const CONFIG = {
  gpuReaderPath: 'mf-gpu',
  gpuReaderIntervalMs: 5000,
  telemetryRestartBackoff: { initialDelayMs: 1000, maxDelayMs: 60_000, jitterRatio: 0 },
} as unknown as ConfigService;

interface IHandlers {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  exit: (code: number | null, signal: string | null) => void;
  error: (error: Error) => void;
}

const snapshotLine = (capturedAt = '2026-08-20T12:00:00.000Z') =>
  `${JSON.stringify({ schema: 1, capturedAt, devices: [], errors: [] })}\n`;

describe('DeviceReaderService', () => {
  let handlers: Partial<IHandlers>;
  let request: Mock<() => void>;
  let kill: Mock<() => void>;
  let spawnReader: ReturnType<typeof vi.fn>;
  let commands: IReaderCommand[];

  const buildProcess = (): IReaderProcess => ({
    onStdout: handler => {
      handlers.stdout = handler;
    },
    onStderr: handler => {
      handlers.stderr = handler;
    },
    onExit: handler => {
      handlers.exit = handler;
    },
    onError: handler => {
      handlers.error = handler;
    },
    request,
    kill,
  });

  const build = () => new DeviceReaderService(CONFIG, { spawn: spawnReader } as unknown as MfGpuService);

  beforeEach(() => {
    vi.useFakeTimers();

    handlers = {};
    commands = [];
    request = vi.fn<() => void>();
    kill = vi.fn<() => void>();
    spawnReader = vi.fn().mockImplementation((options: IReaderCommand) => {
      commands.push(options);

      return buildProcess();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns the reader named in config at the configured interval', () => {
    build().start();

    expect(commands).toEqual([{ command: 'mf-gpu', intervalSeconds: 5 }]);
  });

  it('publishes a snapshot for each readable line', () => {
    const reader = build();
    const seen: string[] = [];

    reader.snapshotStream().subscribe(snapshot => seen.push(snapshot.capturedAt));
    reader.start();

    handlers.stdout?.(snapshotLine('2026-08-20T12:00:00.000Z'));
    handlers.stdout?.(snapshotLine('2026-08-20T12:00:05.000Z'));

    expect(seen).toEqual(['2026-08-20T12:00:00.000Z', '2026-08-20T12:00:05.000Z']);
  });

  it('joins a snapshot split across two chunks', () => {
    const reader = build();
    const seen: string[] = [];

    reader.snapshotStream().subscribe(snapshot => seen.push(snapshot.capturedAt));
    reader.start();

    const line = snapshotLine();
    handlers.stdout?.(line.slice(0, 20));
    handlers.stdout?.(line.slice(20));

    expect(seen).toHaveLength(1);
  });

  it('reports a line it cannot read as a failure and keeps reading', () => {
    const reader = build();
    const failures: string[] = [];
    const seen: string[] = [];

    reader.failureStream().subscribe(reason => failures.push(reason));
    reader.snapshotStream().subscribe(snapshot => seen.push(snapshot.capturedAt));
    reader.start();

    handlers.stdout?.('{"schema":99}\n');
    handlers.stdout?.(snapshotLine());

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('99');
    expect(seen).toHaveLength(1);
  });

  it('starts the reader again after it exits', () => {
    const reader = build();

    reader.start();
    handlers.exit?.(1, null);

    expect(spawnReader).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);

    expect(spawnReader).toHaveBeenCalledTimes(2);
  });

  it('waits longer before each further attempt', () => {
    const reader = build();

    reader.start();

    handlers.exit?.(1, null);
    vi.advanceTimersByTime(1_000);

    handlers.exit?.(1, null);
    vi.advanceTimersByTime(1_000);

    expect(spawnReader).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1_000);

    expect(spawnReader).toHaveBeenCalledTimes(3);
  });

  it('reports a reader that could not be run at all', () => {
    const reader = build();
    const failures: string[] = [];

    reader.failureStream().subscribe(reason => failures.push(reason));
    reader.start();

    handlers.error?.(new Error('spawn mf-gpu ENOENT'));

    expect(failures[0]).toContain('ENOENT');
  });

  it('goes back to the first delay once a snapshot arrives', () => {
    const reader = build();

    reader.start();

    handlers.exit?.(1, null);
    vi.advanceTimersByTime(1_000);

    handlers.stdout?.(snapshotLine());
    handlers.exit?.(1, null);
    vi.advanceTimersByTime(1_000);

    expect(spawnReader).toHaveBeenCalledTimes(3);
  });

  it('asks the reader for a snapshot ahead of schedule', () => {
    const reader = build();

    reader.start();
    reader.requestSnapshot();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops the reader and schedules nothing further once destroyed', () => {
    const reader = build();

    reader.start();
    reader.onModuleDestroy();

    expect(kill).toHaveBeenCalledTimes(1);

    handlers.exit?.(0, 'SIGTERM');
    vi.advanceTimersByTime(60_000);

    expect(spawnReader).toHaveBeenCalledTimes(1);
  });
});
