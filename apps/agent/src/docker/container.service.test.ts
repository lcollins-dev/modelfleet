import Docker from 'dockerode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('countLogEntries', () => {
    it("counts a tty container's lines, since its log carries no frames", async () => {
      logs.mockResolvedValue(Buffer.from('loading\r\nready\r\n', 'utf8'));

      expect(await containerService.countLogEntries(CONTAINER_ID, 11)).toBe(2);
      expect(logs).toHaveBeenCalledWith({ stdout: true, stderr: true, tail: 11 });
    });
  });
});
