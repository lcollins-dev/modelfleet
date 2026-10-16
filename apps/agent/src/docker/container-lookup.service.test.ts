import Docker from 'dockerode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service';
import { ContainerLookupService } from '@/docker/container-lookup.service';

const INSTANCE_KEY = '0199a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';
const INSTANCE_LABEL = 'modelfleet.instance';
const NODE_LABEL = 'modelfleet.node';
const NODE_KEY = '0199a3b2-0000-7000-8000-000000000001';
const OTHER_NODE_KEY = '0199a3b2-0000-7000-8000-000000000002';
const OTHER_INSTANCE_KEY = '0199a3b2-7c4d-7e8f-9a0b-000000000002';

interface IFakeContainer {
  id: string;
  name: string;
  pids: number[];
  labels?: Record<string, string>;
}

const CONTAINERS: IFakeContainer[] = [
  {
    id: 'abc123',
    name: 'vllm-qwen',
    pids: [12345, 12346],
    labels: { [INSTANCE_LABEL]: INSTANCE_KEY, [NODE_LABEL]: NODE_KEY },
  },
  { id: 'def456', name: 'grafana', pids: [999] },
  { id: 'fed789', name: 'impostor', pids: [888], labels: { [INSTANCE_LABEL]: 'not-a-uuid' } },
  { id: 'aaa111', name: 'unlabelled', pids: [555], labels: { [INSTANCE_LABEL]: OTHER_INSTANCE_KEY } },
  {
    id: 'bbb222',
    name: 'neighbour',
    pids: [666],
    labels: { [INSTANCE_LABEL]: OTHER_INSTANCE_KEY, [NODE_LABEL]: OTHER_NODE_KEY },
  },
];

describe('ContainerLookupService', () => {
  let held: IFakeContainer[];
  let listContainers: ReturnType<typeof vi.fn>;
  let docker: Docker;

  const build = (maxAgeMs = 30_000) =>
    new ContainerLookupService(
      { telemetryAttributionMaxAgeMs: maxAgeMs, nodeKey: NODE_KEY } as unknown as ConfigService,
      docker
    );

  beforeEach(() => {
    vi.useFakeTimers();

    held = [...CONTAINERS];

    listContainers = vi.fn(() =>
      Promise.resolve(
        held.map(container => ({ Id: container.id, Names: [`/${container.name}`], Labels: container.labels ?? {} }))
      )
    );

    docker = {
      listContainers,
      getContainer: (id: string) => ({
        top: () => {
          const container = held.find(candidate => candidate.id === id);

          return Promise.resolve({ Titles: ['PID'], Processes: (container?.pids ?? []).map(pid => [String(pid)]) });
        },
      }),
    } as unknown as Docker;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the container holding a process', async () => {
    const resolved = await build().resolve([12345]);

    expect(resolved.get(12345)).toEqual({ id: 'abc123', name: 'vllm-qwen', instanceKey: INSTANCE_KEY });
  });

  it('reads no instance key from a container with no instance label', async () => {
    const resolved = await build().resolve([999]);

    expect(resolved.get(999)?.instanceKey).toBeNull();
  });

  it('reads no instance key from an instance label that is not a uuid', async () => {
    const resolved = await build().resolve([888]);

    expect(resolved.get(888)?.instanceKey).toBeNull();
  });

  it('reads no instance key from a container that carries no node label', async () => {
    const resolved = await build().resolve([555]);

    expect(resolved.get(555)?.instanceKey).toBeNull();
  });

  it("reads no instance key from a container another node's agent launched on the same daemon", async () => {
    const resolved = await build().resolve([666]);

    expect(resolved.get(666)).toEqual({ id: 'bbb222', name: 'neighbour', instanceKey: null });
  });

  it('leaves a process no container owns unresolved', async () => {
    const resolved = await build().resolve([4242]);

    expect(resolved.has(4242)).toBe(false);
  });

  it('asks docker once while every process is already known', async () => {
    const lookup = build();

    await lookup.resolve([12345]);
    await lookup.resolve([12346]);
    await lookup.resolve([12345, 12346]);

    expect(listContainers).toHaveBeenCalledTimes(1);
  });

  it('asks docker again as soon as a process is unknown', async () => {
    const lookup = build();

    await lookup.resolve([12345]);
    await lookup.resolve([777]);

    expect(listContainers).toHaveBeenCalledTimes(2);
  });

  it('asks docker again once the index has aged out', async () => {
    const lookup = build(30_000);

    await lookup.resolve([12345]);
    vi.advanceTimersByTime(30_001);
    await lookup.resolve([12345]);

    expect(listContainers).toHaveBeenCalledTimes(2);
  });

  it('answers from what it holds where docker cannot be reached', async () => {
    const lookup = build();

    await lookup.resolve([12345]);

    listContainers.mockRejectedValue(new Error('socket closed'));
    vi.advanceTimersByTime(60_000);

    const resolved = await lookup.resolve([12345]);

    expect(resolved.get(12345)).toEqual({ id: 'abc123', name: 'vllm-qwen', instanceKey: INSTANCE_KEY });
  });

  it('forgets a process whose container has gone', async () => {
    const lookup = build();

    await lookup.resolve([999]);

    held = [CONTAINERS[0]];
    vi.advanceTimersByTime(60_000);

    const resolved = await lookup.resolve([999]);

    expect(resolved.has(999)).toBe(false);
  });

  it('skips a container that exits while its processes are being read', async () => {
    docker = {
      listContainers,
      getContainer: () => ({ top: () => Promise.reject(new Error('no such container')) }),
    } as unknown as Docker;

    const resolved = await build().resolve([12345]);

    expect(resolved.has(12345)).toBe(false);
  });
});
