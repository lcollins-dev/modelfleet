import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendId } from '@libs/backends';
import type { GpuTelemetryDto, InstancePlacementDto, PlacementNodeDto } from '@libs/dto';
import {
  ActivationPolicy,
  ExpectedUsageSource,
  GpuProcessAttribution,
  GpuVendor,
  NodeState,
  PlacementProblemReason,
} from '@libs/dto';

import { Config } from '@/Config';

import type { IPlacementSelection } from '@/utils/configuration/placement';

import Placement from './Placement.vue';

const GIB = 1024 ** 3;

const getNodeList = vi.fn();
const getNodeTelemetryStatus = vi.fn();
const previewPlacement = vi.fn();

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ getNodeList }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ getNodeTelemetryStatus }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ previewPlacement }),
}));

const device = (deviceKey: string, usedBytes: number): GpuTelemetryDto => ({
  deviceKey,
  vendor: GpuVendor.NVIDIA,
  name: `Card ${deviceKey}`,
  pciBusId: null,
  memoryTotalBytes: 24 * GIB,
  lastReportedDate: new Date('2026-09-22T12:00:00.000Z'),
  index: 0,
  memoryUsedBytes: usedBytes,
  utilisationPercent: null,
  temperatureC: null,
  powerDrawWatts: null,
  processAttribution: GpuProcessAttribution.EXACT,
  processes: [],
  predictions: [],
});

const listNode = (id: number, name: string) => ({
  id,
  name,
  state: NodeState.ONLINE,
  enabled: true,
  lastSeenDate: null,
  agentVersion: null,
});

const verdict = (nodeId: number, nodeName: string, overrides: Partial<PlacementNodeDto> = {}): PlacementNodeDto => ({
  nodeId,
  nodeName,
  devices: [{ deviceKey: `GPU-${nodeId}`, name: null }],
  replicas: 1,
  running: 0,
  problem: null,
  problemReason: null,
  expectedUsage: {
    bytes: 20 * GIB,
    source: ExpectedUsageSource.ESTIMATED,
    hostWeightsBytes: 0,
    hostResidentBytes: 0,
    hostCacheBytes: 0,
  },
  measured: null,
  capacity: { expectedBytes: 20 * GIB, availableBytes: 23 * GIB, hostFreeBytes: null, cards: [], hostWeights: null },
  evictions: [],
  ...overrides,
});

const BOTH_NODES: IPlacementSelection = {
  gpus: [
    { nodeId: 1, deviceKey: 'GPU-1' },
    { nodeId: 2, deviceKey: 'GPU-2' },
  ],
  nodeIds: [],
};

const DOCUMENT = 'contextSize: 4096\n';

const answer = (placement: InstancePlacementDto) => previewPlacement.mockResolvedValue({ placement });

describe('MfPlacementField', () => {
  const render = (modelValue: IPlacementSelection = BOTH_NODES, modelId: number | null = 5) =>
    mount(Placement, {
      props: {
        modelValue,
        document: DOCUMENT,
        modelId,
        presetId: null,
        backend: BackendId.LLAMA_CPP,
        activationPolicy: ActivationPolicy.ALWAYS,
      },
    });

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(Config.PREVIEW_DEBOUNCE_MS + 1);
    await flushPromises();
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();

    getNodeList.mockResolvedValue({ nodeList: [listNode(1, 'rig-01'), listNode(2, 'rig-02')], pages: 1 });
    getNodeTelemetryStatus.mockImplementation((nodeId: number) =>
      Promise.resolve({ devices: [device(`GPU-${nodeId}`, 8 * GIB)], headroomBytes: GIB })
    );
    answer({ nodes: [verdict(1, 'rig-01')], problem: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('gives each node its own verdict, naming the shortfall of the one that does not fit', async () => {
    answer({
      nodes: [
        verdict(1, 'rig-01'),
        verdict(2, 'rig-02', {
          problem: 'Not enough GPU memory for 20.0 GiB',
          problemReason: PlacementProblemReason.NOT_ENOUGH_VRAM,
          capacity: {
            expectedBytes: 20 * GIB,
            availableBytes: 13 * GIB,
            hostFreeBytes: null,
            cards: [],
            hostWeights: null,
          },
        }),
      ],
      problem: null,
    });

    const wrapper = render();
    await settle();

    const nodes = wrapper.findAll('[data-testid="placement-node"]');
    const refused = nodes[1];

    expect(nodes[0].text()).toContain('VRAM 20 / 23 GiB free');
    expect(nodes[0].get('[data-testid="placement-node-status"]').text()).toBe('Fits');
    expect(refused.get('[data-testid="placement-node-status"]').text()).toBe('Not enough VRAM');
    expect(refused.get('[data-testid="placement-node-status"]').attributes('title')).toBe(
      'Not enough GPU memory for 20.0 GiB'
    );

    const memory = refused.get('[data-testid="placement-node-memory"]');

    expect(memory.text()).toBe('VRAM 20 / 13 GiB free');
    expect(memory.classes()).toContain('text-error');
    expect(memory.get('[title]').attributes('title')).toBe('Estimated');
    expect(refused.text()).not.toContain('Not enough GPU memory');
  });

  it('says a node fits after eviction, naming what goes, rather than that it does not fit', async () => {
    previewPlacement.mockResolvedValue({
      placement: {
        nodes: [
          verdict(1, 'rig-01', {
            problem: null,
            evictions: [
              {
                deploymentName: 'qwen-idle',
                instanceKey: 'key-1',
                devices: [{ deviceKey: 'GPU-1', name: null }],
                idleMs: 300_000,
                releasedBytes: 8 * GIB,
              },
            ],
          }),
        ],
        problem: null,
      },
    });

    const wrapper = render();
    await settle();

    const status = wrapper.get('[data-testid="placement-node-status"]');

    expect(status.text()).toBe('Fits after evicting');
    expect(status.attributes('title')).toBe('Fits after evicting qwen-idle (idle 5m, frees 8 GiB)');
  });

  it('asks about the form as edited, and asks again when a field that moves the figure changes', async () => {
    const wrapper = render();
    await settle();

    expect(previewPlacement).toHaveBeenLastCalledWith(
      expect.objectContaining({ deploymentId: null, modelId: 5, backend: BackendId.LLAMA_CPP, document: DOCUMENT })
    );

    await wrapper.setProps({ document: 'contextSize: 32768\n' });
    await settle();

    expect(previewPlacement).toHaveBeenCalledTimes(2);
    expect(previewPlacement).toHaveBeenLastCalledWith(expect.objectContaining({ document: 'contextSize: 32768\n' }));
  });

  it('drops the verdict of a node once nothing on it is ticked', async () => {
    const capacity = {
      expectedBytes: 18 * GIB,
      availableBytes: 23 * GIB,
      hostFreeBytes: null,
      cards: [],
      hostWeights: null,
    };
    answer({ nodes: [verdict(1, 'rig-01'), verdict(2, 'rig-02', { capacity })], problem: null });

    const wrapper = render();
    await settle();

    expect(wrapper.text()).toContain('VRAM 18 / 23 GiB free');

    await wrapper.setProps({ modelValue: { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] } });

    expect(wrapper.text()).not.toContain('VRAM 18 / 23 GiB free');
  });

  it("shows a ticked card's free memory after headroom, from the figures its verdict was read off", async () => {
    answer({
      nodes: [
        verdict(1, 'rig-01', {
          capacity: {
            expectedBytes: 20 * GIB,
            availableBytes: 11 * GIB,
            hostFreeBytes: null,
            cards: [
              {
                deviceKey: 'GPU-1',
                name: null,
                totalBytes: 24 * GIB,
                usedBytes: 10 * GIB,
                predictedBytes: 2 * GIB,
                headroomBytes: GIB,
                freeBytes: 12 * GIB,
                short: false,
              },
            ],
            hostWeights: null,
          },
        }),
      ],
      problem: null,
    });

    const wrapper = render();
    await flushPromises();

    for (const toggle of wrapper.findAll('button[aria-label="Show devices"]')) {
      await toggle.trigger('click');
    }

    // Before the preview lands, the telemetry read gives both cards 24 less 8 used and 1 headroom.
    expect(wrapper.text()).toContain('15 GiB free after headroom');

    await settle();

    expect(wrapper.text()).toContain('11 GiB free after headroom');
    expect(wrapper.text()).toContain('15 GiB free after headroom');
  });

  it('asks nothing once the model is cleared before the debounce fires', async () => {
    const wrapper = render();

    await wrapper.setProps({ modelId: null });
    await settle();

    expect(previewPlacement).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('Fits');
  });

  it('drops an answer an edit has overtaken, showing the later one', async () => {
    let answerFirst: (value: unknown) => void = () => undefined;

    previewPlacement.mockImplementationOnce(() => new Promise(resolve => (answerFirst = resolve)));
    answer({ nodes: [verdict(1, 'rig-01')], problem: null });

    const wrapper = render();
    await settle();

    await wrapper.setProps({ document: 'contextSize: 32768\n' });
    await settle();

    answerFirst({ placement: { nodes: [], problem: 'An answer the edit overtook' } });
    await flushPromises();

    expect(wrapper.text()).not.toContain('An answer the edit overtook');
    expect(wrapper.text()).toContain('Fits');
  });

  it('asks for a model rather than guessing where none is chosen', async () => {
    const wrapper = render(BOTH_NODES, null);
    await settle();

    expect(previewPlacement).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Choose a model to check memory requirements.');
  });

  it('says why the selection as a whole cannot be sized', async () => {
    answer({ nodes: [], problem: 'Choose a backend when the deployment does not use a preset' });

    const wrapper = render();
    await settle();

    expect(wrapper.text()).toContain('Choose a backend when the deployment does not use a preset.');
  });

  it('says the check failed, dropping the verdict an earlier check gave', async () => {
    const wrapper = render();
    await settle();

    expect(wrapper.text()).toContain('Fits');

    previewPlacement.mockRejectedValue(new Error('offline'));
    await wrapper.setProps({ document: 'contextSize: 32768\n' });

    expect(wrapper.text()).toContain('Checking available memory...');

    await settle();

    expect(wrapper.text()).toContain('Could not check available memory.');
    expect(wrapper.text()).not.toContain('Fits');
  });

  it('asks nothing while the scheduler places the deployment', async () => {
    render({ gpus: [], nodeIds: [] });
    await settle();

    expect(previewPlacement).not.toHaveBeenCalled();
  });

  it('opens on the pinned mode for a saved pin, offering both modes', () => {
    const wrapper = render();
    const modes = wrapper.findAll('[role="radio"]');

    expect(modes.map(mode => mode.text())).toEqual(['Automatic', 'Pick devices']);
    expect(modes[1].attributes('aria-checked')).toBe('true');
  });

  it('clears the pins when switched back to automatic', async () => {
    const wrapper = render();

    await wrapper.findAll('[role="radio"]')[0].trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([[{ gpus: [], nodeIds: [] }]]);
    expect(wrapper.find('[data-testid="placement-nodes"]').exists()).toBe(false);
  });

  it('marks a node part-ticked where only some of its devices are pinned', async () => {
    getNodeTelemetryStatus.mockImplementation((nodeId: number) =>
      Promise.resolve({
        devices: [device(`GPU-${nodeId}`, 8 * GIB), device(`GPU-${nodeId}b`, 8 * GIB)],
        headroomBytes: GIB,
      })
    );

    const wrapper = render({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] });
    await flushPromises();

    const nodeBoxes = wrapper.findAll('[data-testid="placement-node"]').map(node => node.get('input'));

    expect(nodeBoxes[0].attributes('aria-checked')).toBe('mixed');
    expect(nodeBoxes[1].attributes('aria-checked')).toBeUndefined();
  });

  it('pins a node by its checkbox', async () => {
    const wrapper = render({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] });
    await flushPromises();

    await wrapper.findAll('[data-testid="placement-node"]')[1].get('input').setValue(true);

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([BOTH_NODES]);
  });

  it("pins a node's CPU and a card from the rows its devices open", async () => {
    const wrapper = render({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] });
    await flushPromises();

    const node = wrapper.findAll('[data-testid="placement-node"]')[1];

    await node.get('button[aria-label="Show devices"]').trigger('click');

    const [cpu, card] = node.findAll('[data-testid="picker-row"]').slice(1);

    await cpu.get('input').setValue(true);

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [2] },
    ]);

    await wrapper.setProps({ modelValue: { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [2] } });
    await card.get('input').setValue(true);

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      {
        gpus: [
          { nodeId: 1, deviceKey: 'GPU-1' },
          { nodeId: 2, deviceKey: 'GPU-2' },
        ],
        nodeIds: [2],
      },
    ]);
  });
});
