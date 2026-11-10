import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { INSTANCE_LABEL } from '@libs/backends/runtime';

import { ConfigService } from '@/config/config.service';
import { ContainerService, NODE_LABEL } from '@/docker/container.service';

const CONTAINER_ID = 'c0ffee';
const NETWORK = 'modelfleet-instances';
const NODE_KEY = '01999999-0000-7000-8000-000000000001';
const INSTANCE_KEY = '01999999-1111-7111-8111-111111111111';

const NEVER_RUN = '0001-01-01T00:00:00Z';

const refused = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

const inspected = (overrides: Record<string, unknown> = {}) => ({
  Id: CONTAINER_ID,
  Config: { Labels: { [INSTANCE_LABEL]: INSTANCE_KEY } },
  State: {
    Running: true,
    ExitCode: 0,
    StartedAt: '2026-08-29T19:59:25.537230658Z',
  },
  NetworkSettings: { Networks: { [NETWORK]: { IPAddress: '198.51.100.2' } } },
  ...overrides,
});

describe('ContainerService', () => {
  let inspect: ReturnType<typeof vi.fn>;
  let listContainers: ReturnType<typeof vi.fn>;
  let createContainer: ReturnType<typeof vi.fn>;
  let stop: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let logs: ReturnType<typeof vi.fn>;
  let docker: Docker;
  let containerService: ContainerService;

  beforeEach(() => {
    inspect = vi.fn().mockResolvedValue(inspected());
    listContainers = vi.fn().mockResolvedValue([{ Id: CONTAINER_ID }]);
    createContainer = vi.fn().mockResolvedValue({ id: CONTAINER_ID });
    stop = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);
    logs = vi.fn().mockResolvedValue(Buffer.from('error: failed to load model\n', 'utf8'));

    docker = {
      listContainers,
      createContainer,
      getContainer: () => ({ inspect, stop, remove, logs }),
    } as unknown as Docker;

    containerService = new ContainerService({ nodeKey: NODE_KEY } as unknown as ConfigService, docker);
  });

  describe('create', () => {
    it('labels the container with this node beside the labels it was given', async () => {
      await containerService.create({ Image: 'backend', Labels: { [INSTANCE_LABEL]: INSTANCE_KEY } });

      expect(createContainer).toHaveBeenCalledWith(
        expect.objectContaining({ Labels: { [INSTANCE_LABEL]: INSTANCE_KEY, [NODE_LABEL]: NODE_KEY } })
      );
    });
  });

  describe('listInstances', () => {
    it('asks only for instance containers this node launched, running or not', async () => {
      await containerService.listInstances();

      expect(listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: [INSTANCE_LABEL, `${NODE_LABEL}=${NODE_KEY}`] },
      });
    });

    it('reads the labels, state and network address off each container', async () => {
      expect(await containerService.listInstances()).toEqual([
        {
          id: CONTAINER_ID,
          labels: { [INSTANCE_LABEL]: INSTANCE_KEY },
          running: true,
          startedAt: new Date('2026-08-29T19:59:25.537230658Z'),
          exitCode: null,
          addresses: { [NETWORK]: '198.51.100.2' },
        },
      ]);
    });

    it('reports the exit code of a container that has stopped', async () => {
      inspect.mockResolvedValue(
        inspected({ State: { Running: false, ExitCode: 137, StartedAt: '2026-08-29T19:59:25Z' } })
      );

      const [container] = await containerService.listInstances();

      expect(container.exitCode).toBe(137);
    });

    it('reports no exit code for a container that has never run, since nothing exited', async () => {
      inspect.mockResolvedValue(inspected({ State: { Running: false, ExitCode: 128, StartedAt: NEVER_RUN } }));

      const [container] = await containerService.listInstances();

      expect(container.startedAt).toBeNull();
      expect(container.exitCode).toBe(128);
    });

    it('skips a container removed between listing and inspecting it', async () => {
      inspect.mockRejectedValue(refused(404, 'No such container'));

      expect(await containerService.listInstances()).toEqual([]);
    });

    it('raises on a container it cannot read, rather than letting the caller start a second one', async () => {
      inspect.mockResolvedValue({ Id: CONTAINER_ID });

      await expect(containerService.listInstances()).rejects.toThrow(/cannot read/);
    });

    it('raises a refusal that is not a missing container', async () => {
      inspect.mockRejectedValue(refused(500, 'server error'));

      await expect(containerService.listInstances()).rejects.toThrow('server error');
    });
  });

  describe('stopAndRemove', () => {
    it("stops with the backend's grace period, then removes", async () => {
      await containerService.stopAndRemove(CONTAINER_ID, 30);

      expect(stop).toHaveBeenCalledWith({ t: 30 });
      expect(remove).toHaveBeenCalledWith({ force: true });
    });

    it('removes a container that was already stopped', async () => {
      stop.mockRejectedValue(refused(304, 'container already stopped'));

      await containerService.stopAndRemove(CONTAINER_ID, 30);

      expect(remove).toHaveBeenCalledWith({ force: true });
    });
  });

  describe('tailLogs', () => {
    it("reads the backend's own output, demultiplexed", async () => {
      expect(await containerService.tailLogs(CONTAINER_ID, 30)).toBe('error: failed to load model');
      expect(logs).toHaveBeenCalledWith({ stdout: true, stderr: true, tail: 30 });
    });

    it('answers with nothing where the log cannot be read', async () => {
      logs.mockRejectedValue(refused(404, 'No such container'));

      expect(await containerService.tailLogs(CONTAINER_ID, 30)).toBeNull();
    });
  });

  describe('pullImage', () => {
    const REFERENCE = 'registry.example.com/backend:v2';
    const STALL_MS = 300_000;

    let progress: PassThrough;
    let pull: Mock<(reference: string, options: { abortSignal: AbortSignal }) => Promise<PassThrough>>;
    let service: ContainerService;

    const line = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`;
    const downloading = (current: number) => line({ id: 'a1b2c3', status: 'Downloading', progressDetail: { current } });

    beforeEach(() => {
      vi.useFakeTimers();

      progress = new PassThrough();
      pull = vi.fn<(reference: string, options: { abortSignal: AbortSignal }) => Promise<PassThrough>>();
      pull.mockResolvedValue(progress);

      const configService = {
        nodeKey: NODE_KEY,
        imagePullStallTimeout: '5m',
        imagePullStallTimeoutMs: STALL_MS,
      } as unknown as ConfigService;

      service = new ContainerService(configService, { pull } as unknown as Docker);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('raises the failure the daemon wrote into the progress stream', async () => {
      const pulling = service.pullImage(REFERENCE);

      progress.end(line({ status: 'Downloading' }) + line({ error: 'no space left on device' }));

      await expect(pulling).rejects.toThrow('no space left on device');
    });

    it('reads a line the daemon sent split across chunks', async () => {
      const pulling = service.pullImage(REFERENCE);
      const failure = line({ error: 'manifest unknown' });

      progress.write(failure.slice(0, 10));
      progress.end(failure.slice(10));

      await expect(pulling).rejects.toThrow('manifest unknown');
    });

    it('reads a last line the daemon sent without a newline', async () => {
      const pulling = service.pullImage(REFERENCE);

      progress.end(JSON.stringify({ error: 'no space left on device' }));

      await expect(pulling).rejects.toThrow('no space left on device');
    });

    it('counts a layer changing status at the same byte count as progress', async () => {
      const pulling = service.pullImage(REFERENCE);

      await vi.advanceTimersByTimeAsync(0);
      progress.write(downloading(2048));
      await vi.advanceTimersByTimeAsync(STALL_MS - 1000);
      progress.write(line({ id: 'a1b2c3', status: 'Download complete', progressDetail: { current: 2048 } }));
      await vi.advanceTimersByTimeAsync(STALL_MS - 1000);
      progress.end(line({ status: 'Status: Downloaded newer image' }));

      await expect(pulling).resolves.toBeUndefined();
    });

    it('carries on with a pull that keeps progressing, however long it takes in all', async () => {
      const pulling = service.pullImage(REFERENCE);

      await vi.advanceTimersByTimeAsync(0);

      for (let minute = 1; minute <= 30; minute += 1) {
        progress.write(downloading(minute * 1024));
        await vi.advanceTimersByTimeAsync(STALL_MS - 1000);
      }

      progress.end(line({ status: 'Status: Downloaded newer image' }));

      await expect(pulling).resolves.toBeUndefined();
    });

    it('fails a pull that repeats its last figures for the stall timeout, naming the timeout', async () => {
      const pulling = service.pullImage(REFERENCE);
      const outcome = pulling.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      progress.write(downloading(2048));

      for (let second = 0; second < STALL_MS / 1000; second += 1) {
        progress.write(downloading(2048));
        await vi.advanceTimersByTimeAsync(1000);
      }

      expect(await outcome).toEqual(new Error('The image pull made no progress for 5m'));
    });

    it('fails a pull whose layers take turns repeating their last figures', async () => {
      const outcome = service.pullImage(REFERENCE).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);

      for (let second = 0; second < STALL_MS / 1000; second += 1) {
        progress.write(line({ id: 'a1b2c3', status: 'Downloading', progressDetail: { current: 100 } }));
        progress.write(line({ id: 'd4e5f6', status: 'Downloading', progressDetail: { current: 200 } }));
        await vi.advanceTimersByTimeAsync(1000);
      }

      expect(await outcome).toEqual(new Error('The image pull made no progress for 5m'));
    });

    it('raises an error the daemon wrote on a line it cannot fully read', async () => {
      const pulling = service.pullImage(REFERENCE);

      progress.end(line({ id: 7, progressDetail: null, error: 'no space left on device' }));

      await expect(pulling).rejects.toThrow('no space left on device');
    });

    it('fails a pull whose stream is cut off without an end', async () => {
      const outcome = service.pullImage(REFERENCE).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      progress.write(downloading(2048));
      progress.destroy();

      expect(await outcome).toEqual(new Error('The Docker daemon closed the image pull before it finished'));
    });

    it('fails a pull whose layers take turns repeating their last figures', async () => {
      const outcome = service.pullImage(REFERENCE).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);

      for (let second = 0; second < STALL_MS / 1000; second += 1) {
        progress.write(line({ id: 'a1b2c3', status: 'Downloading', progressDetail: { current: 100 } }));
        progress.write(line({ id: 'd4e5f6', status: 'Downloading', progressDetail: { current: 200 } }));
        await vi.advanceTimersByTimeAsync(1000);
      }

      expect(await outcome).toEqual(new Error('The image pull made no progress for 5m'));
    });

    it('raises an error the daemon wrote on a line it cannot fully read', async () => {
      const pulling = service.pullImage(REFERENCE);

      progress.end(line({ id: 7, progressDetail: null, error: 'no space left on device' }));

      await expect(pulling).rejects.toThrow('no space left on device');
    });

    it('fails a pull whose stream is cut off without an end', async () => {
      const outcome = service.pullImage(REFERENCE).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      progress.write(downloading(2048));
      progress.destroy();

      expect(await outcome).toEqual(new Error('The Docker daemon closed the image pull before it finished'));
    });

    it('never abandons a pull where the stall timeout is 0', async () => {
      const configService = { imagePullStallTimeout: '0', imagePullStallTimeoutMs: 0 } as unknown as ConfigService;
      const unbounded = new ContainerService(configService, { pull } as unknown as Docker);
      const pulling = unbounded.pullImage(REFERENCE);

      await vi.advanceTimersByTimeAsync(0);
      progress.write(downloading(2048));
      await vi.advanceTimersByTimeAsync(STALL_MS * 10);
      progress.end(line({ status: 'Status: Downloaded newer image' }));

      await expect(pulling).resolves.toBeUndefined();
    });

    it('fails a pull the daemon never starts answering, and aborts the request', async () => {
      let request = new AbortController().signal;

      pull.mockImplementation((_reference, options) => {
        request = options.abortSignal;

        return new Promise<PassThrough>((_resolve, reject) => {
          request.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        });
      });

      const outcome = service.pullImage(REFERENCE).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(STALL_MS);

      expect(await outcome).toEqual(new Error('The image pull made no progress for 5m'));
      expect(request.aborted).toBe(true);
    });
  });

  describe('countLogEntries', () => {
    it("counts a tty container's lines, since its log carries no frames", async () => {
      logs.mockResolvedValue(Buffer.from('loading\r\nready\r\n', 'utf8'));

      expect(await containerService.countLogEntries(CONTAINER_ID, 11)).toBe(2);
      expect(logs).toHaveBeenCalledWith({ stdout: true, stderr: true, tail: 11 });
    });
  });
});
