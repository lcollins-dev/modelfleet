import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { ListInstanceDto } from '@libs/dto';
import { InstanceState, NodeState } from '@libs/dto';

import Table from './Table.vue';

const GIB = 1024 ** 3;

const instance = (
  instanceKey: string,
  state: InstanceState,
  extra: Partial<ListInstanceDto> = {}
): ListInstanceDto => ({
  instanceKey,
  deploymentId: 4,
  deploymentName: 'llama-70b-chat',
  nodeId: 2,
  nodeName: 'gpu-a-01',
  nodeState: NodeState.ONLINE,
  devices: [{ deviceKey: 'GPU-4f2c', name: 'NVIDIA A100-SXM4-80GB' }],
  state,
  message: null,
  exitCode: null,
  startedDate: null,
  reportedDate: null,
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
  ...extra,
});

interface ITableProps {
  instances: ListInstanceDto[];
  party: 'deployment' | 'node';
  loading?: boolean;
  vramByInstance?: Record<string, number>;
}

const mountTable = (props: ITableProps) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });

  return mount(Table, { props: { emptyDescription: 'Nothing runs here.', ...props }, global: { plugins: [router] } });
};

describe('MfInstanceTable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leads each row with the instance, naming the deployment on a node screen and linking to it', () => {
    const table = mountTable({
      instances: [
        instance('9f0e1d2c3b4a5968', InstanceState.READY, { startedDate: new Date('2026-09-22T10:30:00.000Z') }),
      ],
      party: 'deployment',
    });

    const row = table.get('[data-testid="instance-row"]');
    const party = row.get('[data-testid="instance-party-link"]');

    expect(table.text()).toContain('Instance');
    expect(table.text()).toContain('Deployment');
    expect(row.text()).toContain('3b4a5968');
    expect(row.text()).not.toContain('9f0e1d2c');
    expect(party.text()).toBe('llama-70b-chat');
    expect(party.attributes('href')).toBe('/deployments/4');
    expect(row.text()).toContain('Ready');
    expect(row.text()).toContain('NVIDIA A100-SXM4-80GB');
    expect(row.text()).toContain('1h 30m');
  });

  it('names the node on a deployment screen, and reads an instance with no devices as CPU', () => {
    const table = mountTable({ instances: [instance('a', InstanceState.STARTING, { devices: [] })], party: 'node' });

    const row = table.get('[data-testid="instance-row"]');
    const party = row.get('[data-testid="instance-party-link"]');

    expect(table.text()).toContain('Node');
    expect(party.text()).toBe('gpu-a-01');
    expect(party.attributes('href')).toBe('/nodes/2');
    expect(row.text()).toContain('CPU');
    expect(row.text()).toContain('Loading weights');
  });

  it('links every row to its instance page, a failed row too', () => {
    for (const party of ['deployment', 'node'] as const) {
      const table = mountTable({
        instances: [instance('a', InstanceState.READY), instance('b', InstanceState.FAILED, { exitCode: 1 })],
        party,
      });

      const links = table.findAll('[data-testid="table-row-link"]');

      expect(links.map(link => link.attributes('href'))).toEqual([
        '/deployments/4/instance/a',
        '/deployments/4/instance/b',
      ]);
    }
  });

  it('titles a failed row by its exit code, leaving its output to the instance page', () => {
    const table = mountTable({
      instances: [
        instance('a', InstanceState.FAILED, { exitCode: 1, message: 'error: unknown argument --flash' }),
        instance('b', InstanceState.FAILED),
      ],
      party: 'deployment',
    });

    const rows = table.findAll('[data-testid="instance-row"]');

    expect(rows[0].text()).toContain('The backend exited 1');
    expect(rows[1].text()).toContain('The launch failed');
    expect(table.text()).not.toContain('unknown argument');
    expect(table.find('[data-testid="table-row-expand"]').exists()).toBe(false);
  });

  it('adds a VRAM column only when given the memory, reading a missing figure as -', () => {
    const without = mountTable({ instances: [instance('a', InstanceState.READY)], party: 'deployment' });

    expect(without.text()).not.toContain('VRAM');

    const table = mountTable({
      instances: [instance('a', InstanceState.READY), instance('b', InstanceState.READY)],
      party: 'deployment',
      vramByInstance: { a: 40 * GIB },
    });

    const rows = table.findAll('[data-testid="instance-row"]');

    expect(table.text()).toContain('VRAM');
    expect(rows[0].text()).toContain('40 GiB');
    expect(rows[1].text()).toContain('-');
  });

  it('says what an empty set means once loaded', () => {
    const loading = mountTable({ instances: [], party: 'deployment', loading: true });

    expect(loading.text()).not.toContain('Nothing runs here.');

    const table = mountTable({ instances: [], party: 'deployment' });

    expect(table.text()).toContain('Nothing runs here.');
  });
});
