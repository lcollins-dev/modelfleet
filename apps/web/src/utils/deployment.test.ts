import { describe, expect, it } from 'vitest';

import { BackendId } from '@libs/backends';
import type {
  DeploymentResidencyDto,
  EffectiveConfigurationEntryDto,
  ExpectedUsageDto,
  ListDeploymentDto,
  ListInstanceDto,
  PlacementCapacityDto,
  PlacementNodeDto,
} from '@libs/dto';
import {
  ActivationPolicy,
  ConfigurationSource,
  ExpectedUsageSource,
  InstanceState,
  NodeState,
  PlacementProblemReason,
  ResidencyRule,
} from '@libs/dto';

import {
  countDeploymentRunStates,
  deploymentRunState,
  describeDeploymentPlacement,
  describeLaunchFailures,
  describePlacementFit,
  formatActivationPolicy,
  formatPlacementFit,
  PlacementFit,
  placementFit,
  placementFitTone,
  placementMemory,
  placementReason,
  placementRows,
  presetLayer,
} from './deployment';

const entry = (partial: Partial<EffectiveConfigurationEntryDto>): EffectiveConfigurationEntryDto => ({
  key: 'threads',
  value: 8,
  source: ConfigurationSource.DEPLOYMENT,
  modelled: true,
  ...partial,
});

const residency = (partial: Partial<DeploymentResidencyDto> = {}): DeploymentResidencyDto => ({
  rule: ResidencyRule.ALWAYS,
  idleTimeoutMs: null,
  lastUsedDate: null,
  idleSince: null,
  inFlight: 0,
  launchFailures: 0,
  retryDate: null,
  givenUp: false,
  lastLaunchFailure: null,
  makingRoomNodeIds: [],
  restarting: false,
  ...partial,
});

describe('formatActivationPolicy', () => {
  it('names each policy', () => {
    expect(formatActivationPolicy(ActivationPolicy.ALWAYS)).toBe('Always on');
    expect(formatActivationPolicy(ActivationPolicy.ON_DEMAND)).toBe('On demand');
  });
});

describe('describeLaunchFailures', () => {
  const NOW = new Date('2026-09-23T12:00:00Z');

  it('says nothing where the last launch did not fail', () => {
    expect(describeLaunchFailures(residency(), NOW)).toBeNull();
  });

  it('says how long a failure holds the next start back', () => {
    const line = describeLaunchFailures(
      residency({ launchFailures: 1, retryDate: new Date('2026-09-23T12:00:45Z') }),
      NOW
    );

    expect(line).toBe('Last start failed. Retry available in 45s.');
  });

  it('counts the failed launches and says nothing once the wait is not holding a start back', () => {
    const line = describeLaunchFailures(
      residency({ launchFailures: 3, retryDate: new Date('2026-09-23T12:02:00Z') }),
      NOW
    );

    expect(line).toBe('Last 3 starts failed. Retry available in 2m.');
    expect(describeLaunchFailures(residency({ launchFailures: 3 }), NOW)).toBeNull();
  });

  it('rounds the wait up and says nothing once it has run out', () => {
    const failed = residency({ launchFailures: 2, retryDate: new Date('2026-09-23T12:00:00.400Z') });

    expect(describeLaunchFailures(failed, NOW)).toBe('Last 2 starts failed. Retry available in 1s.');
    expect(describeLaunchFailures(failed, new Date('2026-09-23T12:00:00.400Z'))).toBeNull();
    expect(describeLaunchFailures(failed, new Date('2026-09-23T12:00:05Z'))).toBeNull();
  });
});

describe('presetLayer', () => {
  it('takes the value of a key the deployment inherits', () => {
    const layer = presetLayer([entry({ key: 'threads', value: 16, source: ConfigurationSource.PRESET })]);

    expect(layer).toEqual({ threads: 16 });
  });

  it('takes the replaced value of a key the deployment overrides', () => {
    const layer = presetLayer([entry({ key: 'threads', value: 8, presetValue: 16 })]);

    expect(layer).toEqual({ threads: 16 });
  });

  it('leaves out a key only the deployment sets', () => {
    expect(presetLayer([entry({ key: 'threads', value: 8 })])).toEqual({});
  });

  it('leaves out a declared default, which no layer of the form holds', () => {
    const entries = [entry({ key: 'image', value: 'llama.cpp:tested', source: ConfigurationSource.DECLARATION })];

    expect(presetLayer(entries)).toEqual({});
  });

  it('keeps a preset value of null, which absence would read as inherited', () => {
    const layer = presetLayer([entry({ key: 'tensorSplit', value: [1], presetValue: null })]);

    expect(layer).toEqual({ tensorSplit: null });
  });
});

describe('deployment run state', () => {
  const instance = (overrides: Partial<ListInstanceDto> = {}): ListInstanceDto => ({
    instanceKey: 'a',
    deploymentId: 1,
    deploymentName: 'llama-70b-chat',
    nodeId: 1,
    nodeName: 'gpu-1',
    nodeState: NodeState.ONLINE,
    devices: [{ deviceKey: 'GPU-4f2c', name: 'NVIDIA A100-SXM4-80GB' }],
    state: InstanceState.READY,
    message: null,
    onOlderSettings: false,
    restartRequested: false,
    exitCode: null,
    startedDate: null,
    reportedDate: null,
    createdDate: new Date('2026-09-22T12:00:00.000Z'),
    ...overrides,
  });

  const deployment = (overrides: Partial<ListDeploymentDto> = {}): ListDeploymentDto => ({
    id: 1,
    name: 'llama-70b-chat',
    modelId: 1,
    modelName: 'Llama 3.1 70B',
    modelLicence: null,
    presetId: null,
    presetName: null,
    backend: BackendId.LLAMA_CPP,
    activationPolicy: ActivationPolicy.ALWAYS,
    enabled: true,
    createdDate: new Date('2026-09-22T12:00:00.000Z'),
    ...overrides,
  });

  it('reads a deployment running nothing as idle', () => {
    expect(deploymentRunState(1, [])).toBe('idle');
  });

  it('reports a failed replica over ready ones', () => {
    expect(deploymentRunState(1, [instance(), instance({ instanceKey: 'b', state: InstanceState.FAILED })])).toBe(
      'failed'
    );
  });

  it('reports a replica still starting over ready ones', () => {
    expect(deploymentRunState(1, [instance(), instance({ instanceKey: 'b', state: InstanceState.STARTING })])).toBe(
      'starting'
    );
  });

  it('reads only its own instances', () => {
    expect(deploymentRunState(1, [instance({ deploymentId: 2, state: InstanceState.FAILED })])).toBe('idle');
  });

  it('counts each deployment once, idle being what the total leaves', () => {
    const instances = [
      instance(),
      instance({ instanceKey: 'b' }),
      instance({ instanceKey: 'c', deploymentId: 2, state: InstanceState.FAILED }),
    ];

    expect(countDeploymentRunStates(5, instances)).toEqual([
      { key: 'ready', count: 1 },
      { key: 'failed', count: 1 },
      { key: 'idle', count: 3 },
    ]);
  });

  it('names the node and the devices each instance serves from', () => {
    expect(describeDeploymentPlacement(deployment(), [instance()])).toBe(
      'Always on · on gpu-1 (NVIDIA A100-SXM4-80GB)'
    );
  });

  it('says where a failed instance exited, and with what, even on a disabled deployment', () => {
    const failed = instance({ state: InstanceState.FAILED, exitCode: 1 });

    expect(describeDeploymentPlacement(deployment({ enabled: false }), [failed])).toBe('Always on · exited 1 on gpu-1');
  });

  it('reads a deployment running nothing as not running', () => {
    expect(describeDeploymentPlacement(deployment({ activationPolicy: ActivationPolicy.ON_DEMAND }), [])).toBe(
      'On demand · not running'
    );
  });
});

describe('placement figures', () => {
  const GIB = 1024 ** 3;

  const usage = (overrides: Partial<ExpectedUsageDto> = {}): ExpectedUsageDto => ({
    bytes: 20 * GIB,
    source: ExpectedUsageSource.ESTIMATED,
    hostWeightsBytes: 0,
    hostResidentBytes: 0,
    hostCacheBytes: 0,
    ...overrides,
  });

  const capacity = (overrides: Partial<PlacementCapacityDto> = {}): PlacementCapacityDto => ({
    expectedBytes: 20 * GIB,
    availableBytes: 23 * GIB,
    hostFreeBytes: null,
    cards: [],
    hostWeights: null,
    ...overrides,
  });

  const node = (overrides: Partial<PlacementNodeDto> = {}): PlacementNodeDto => ({
    nodeId: 1,
    nodeName: 'rig-01',
    devices: [{ deviceKey: 'GPU-a', name: null }],
    replicas: 1,
    running: 0,
    problem: null,
    problemReason: null,
    expectedUsage: usage(),
    measured: null,
    capacity: capacity(),
    evictions: [],
    ...overrides,
  });

  const refused = (
    problemReason: PlacementProblemReason,
    overrides: Partial<PlacementNodeDto> = {}
  ): PlacementNodeDto => node({ problem: 'The server sentence', problemReason, ...overrides });

  const EVICTION = {
    deploymentName: 'qwen-idle',
    instanceKey: 'key-1',
    devices: [{ deviceKey: 'GPU-a', name: null }],
    idleMs: 300_000,
    releasedBytes: 8 * GIB,
  };

  const SHORT_OF_VRAM = capacity({ availableBytes: 13 * GIB });

  const label = (placed: PlacementNodeDto, makingRoom: number[] = []): string =>
    formatPlacementFit(placementFit(placed, makingRoom));

  describe('status', () => {
    it.each([
      [PlacementProblemReason.NOT_ENOUGH_VRAM, 'Not enough VRAM', 'error'],
      [PlacementProblemReason.NOT_ENOUGH_RAM, 'Not enough RAM', 'error'],
      [PlacementProblemReason.MODEL_NOT_ON_NODE, 'Model not on node', 'warning'],
      [PlacementProblemReason.NO_READINGS, 'No readings', 'warning'],
      [PlacementProblemReason.GPU_NOT_MEASURED, 'GPU not measured', 'warning'],
      [PlacementProblemReason.OTHER, 'Cannot run here', 'warning'],
    ])('labels a %s refusal from its reason', (reason, expected, tone) => {
      const placed = refused(reason);

      expect(label(placed)).toBe(expected);
      expect(placementFitTone(placementFit(placed))).toBe(tone);
    });

    it('reads a problem with no reason as one it cannot name', () => {
      expect(label(node({ problem: 'Anything' }))).toBe('Cannot run here');
    });

    it('labels a node that fits, one that fits after evicting, one running and one on its CPU', () => {
      expect(label(node())).toBe('Fits');
      expect(label(node({ evictions: [EVICTION] }))).toBe('Fits after evicting');
      expect(label(node({ running: 1, capacity: null }))).toBe('Running');
      expect(label(node({ devices: [], expectedUsage: null, capacity: null }))).toBe('CPU only');
    });

    it('gives the server sentence as the reason, or names what would be evicted', () => {
      expect(placementReason(refused(PlacementProblemReason.OTHER))).toBe('The server sentence');
      expect(placementReason(node({ evictions: [EVICTION] }))).toBe(
        'Fits after evicting qwen-idle (idle 5m, frees 8 GiB)'
      );
      expect(placementReason(node())).toBeNull();
    });
  });

  describe('while room is being made on a node', () => {
    it('reads the refused node as making room, with nothing marked short', () => {
      const short = refused(PlacementProblemReason.NOT_ENOUGH_VRAM, { capacity: SHORT_OF_VRAM });
      const [row] = placementRows([short], [1]);

      expect(row).toMatchObject({ fit: PlacementFit.MAKING_ROOM, vram: { short: false } });
      expect(row.reason).toBe('Waiting for the node to report freed memory.');
    });

    it('reads another node, refused for itself, as refused', () => {
      const other = refused(PlacementProblemReason.NOT_ENOUGH_VRAM, { nodeId: 2, capacity: SHORT_OF_VRAM });

      expect(placementFit(other, [1])).toBe(PlacementFit.NOT_ENOUGH_VRAM);
    });

    it('reads a node offered more evictions as making room, since no further victims are chosen', () => {
      expect(placementFit(node({ evictions: [EVICTION] }), [1])).toBe(PlacementFit.MAKING_ROOM);
    });

    it('does not read a node with no capacity report, or one holding its replicas, as making room', () => {
      expect(placementFit(refused(PlacementProblemReason.OTHER, { capacity: null }), [1])).toBe(
        PlacementFit.CANNOT_RUN
      );
      expect(placementFit(node({ running: 1 }), [1])).toBe(PlacementFit.FITS);
    });
  });

  describe('memory cells', () => {
    it('reads needed against free, and a dash where nothing is kept in RAM', () => {
      expect(placementMemory(node())).toMatchObject({
        vram: { label: 'VRAM', text: '20 / 23 GiB free', short: false },
        ram: { label: 'RAM', text: '-', short: false, title: null },
      });
    });

    it('reads a dash for an unknown free figure and for a node nothing sized', () => {
      expect(placementMemory(node({ capacity: capacity({ availableBytes: null }) })).vram.text).toBe('20 GiB / -');
      expect(placementMemory(node({ expectedUsage: null, capacity: null })).vram.text).toBe('-');
    });

    it('marks VRAM short where the cards cannot hold the figure, leaving RAM', () => {
      const memory = placementMemory(refused(PlacementProblemReason.NOT_ENOUGH_VRAM, { capacity: SHORT_OF_VRAM }));

      expect(memory.vram).toMatchObject({ text: '20 / 13 GiB free', short: true });
      expect(memory.ram.short).toBe(false);
    });

    it('marks VRAM short for a refusal naming one card, though the pooled figure fits', () => {
      expect(placementMemory(refused(PlacementProblemReason.NOT_ENOUGH_VRAM)).vram.short).toBe(true);
    });

    it('marks RAM short where it cannot hold the weights and cache, leaving VRAM', () => {
      const memory = placementMemory(
        refused(PlacementProblemReason.NOT_ENOUGH_RAM, {
          capacity: capacity({ hostWeights: { neededBytes: 30 * GIB, cacheBytes: 8 * GIB, freeBytes: 12 * GIB } }),
        })
      );

      expect(memory.ram).toMatchObject({ text: '30 / 12 GiB free', short: true });
      expect(memory.vram.short).toBe(false);
    });

    it('reads an offloading pool short of room as RAM short, the overflow counted there', () => {
      const memory = placementMemory(
        refused(PlacementProblemReason.NOT_ENOUGH_RAM, {
          capacity: capacity({
            hostFreeBytes: 16 * GIB,
            hostWeights: { neededBytes: 5 * GIB, cacheBytes: 0, freeBytes: 16 * GIB },
          }),
        })
      );

      expect(memory.vram).toMatchObject({ text: '7 / 7 GiB free', short: false });
      expect(memory.ram).toMatchObject({ text: '18 / 16 GiB free', short: true });
    });

    it('marks a short figure beside an eviction, since it is short until the eviction runs', () => {
      expect(placementMemory(node({ capacity: SHORT_OF_VRAM, evictions: [EVICTION] })).vram.short).toBe(true);
    });

    it('counts what RAM has to hold where the ledger has not checked the node', () => {
      const held = node({
        running: 1,
        expectedUsage: usage({ hostWeightsBytes: 30 * GIB, hostResidentBytes: 4 * GIB, hostCacheBytes: 8 * GIB }),
        capacity: null,
      });

      expect(placementMemory(held).ram.text).toBe('12 GiB / -');
    });

    it.each([
      [ExpectedUsageSource.CONFIGURED, 'Configured'],
      [ExpectedUsageSource.DECLARED, 'Declared'],
      [ExpectedUsageSource.ESTIMATED, 'Estimated'],
    ])('hovers VRAM with its %s source', (source, title) => {
      expect(placementMemory(node({ expectedUsage: usage({ source }) })).vram.title).toBe(title);
    });

    describe('the RAM hover', () => {
      const hovered = (neededBytes: number, cacheBytes: number, hostFreeBytes: number | null = null) =>
        placementMemory(
          node({
            capacity: capacity({
              hostFreeBytes,
              hostWeights: neededBytes === 0 ? null : { neededBytes, cacheBytes, freeBytes: 16 * GIB },
            }),
          })
        ).ram;

      it('reads pinned, overflow and cache in that order, adding up to the cell', () => {
        const ram = hovered(9 * GIB, 8 * GIB, 16 * GIB);

        expect(ram.text).toBe('22 / 16 GiB free');
        expect(ram.title).toBe('CPU pinned 1 GiB · VRAM overflow 13 GiB · Prompt cache ≤8 GiB');
      });

      it('reads each part in its own unit, and says nothing about an eviction', () => {
        const ram = placementMemory(
          node({
            capacity: capacity({
              expectedBytes: 285 * GIB,
              availableBytes: 258 * GIB,
              hostFreeBytes: 208 * GIB,
              hostWeights: { neededBytes: 671 * 1024 ** 2 + GIB, cacheBytes: GIB, freeBytes: 208 * GIB },
            }),
            evictions: [EVICTION],
          })
        ).ram;

        expect(ram.title).toBe('CPU pinned 671 MiB · VRAM overflow 235 GiB · Prompt cache ≤1 GiB');
      });

      it('leaves out a part that is zero', () => {
        expect(hovered(30 * GIB, 0).title).toBe('CPU pinned 30 GiB');
        expect(hovered(8 * GIB, 8 * GIB).title).toBe('Prompt cache ≤8 GiB');
        expect(hovered(0, 0, 16 * GIB).title).toBe('VRAM overflow 13 GiB');
        expect(hovered(0, 0).title).toBeNull();
      });

      it('reads a node the ledger has not checked from its expected usage', () => {
        const held = node({
          running: 1,
          expectedUsage: usage({ hostResidentBytes: 4 * GIB, hostCacheBytes: 8 * GIB }),
          capacity: null,
        });

        expect(placementMemory(held).ram.title).toBe('CPU pinned 4 GiB · Prompt cache ≤8 GiB');
      });
    });

    describe('a node holding its full share', () => {
      const holding = (vramBytes: number | null, ramBytes: number | null) =>
        node({ running: 1, capacity: null, expectedUsage: usage(), measured: { vramBytes, ramBytes } });

      it('reads one measured number per cell, with no hover, and stays Running', () => {
        const memory = placementMemory(holding(83 * GIB, 213 * GIB));

        expect(memory.vram).toMatchObject({ text: '83 GiB', short: false, title: null });
        expect(memory.ram).toMatchObject({ text: '213 GiB', short: false, title: null });
        expect(placementFit(holding(83 * GIB, 213 * GIB))).toBe(PlacementFit.HELD);
      });

      it('leaves a figure with no reading blank rather than falling back to the estimate', () => {
        const memory = placementMemory(holding(null, 213 * GIB));

        expect(memory.vram).toMatchObject({ text: '-', title: null });
        expect(memory.ram.text).toBe('213 GiB');
      });

      it('reads a zero as a dash, as every other figure on the row does', () => {
        expect(placementMemory(holding(0, 213 * GIB)).vram.text).toBe('-');
      });
    });
  });

  describe('placementRows', () => {
    const CARD = {
      deviceKey: 'GPU-a',
      name: 'RTX 4090',
      totalBytes: 24 * GIB,
      usedBytes: 4 * GIB,
      predictedBytes: 6 * GIB,
      headroomBytes: GIB,
      freeBytes: 14 * GIB,
      short: true,
    };

    it('gives each card the refusal was checked on, marking the short one and dashing what is unmeasured', () => {
      const [row] = placementRows([
        refused(PlacementProblemReason.NOT_ENOUGH_VRAM, {
          capacity: capacity({
            hostFreeBytes: 12 * GIB,
            cards: [
              CARD,
              {
                deviceKey: 'GPU-b',
                name: null,
                totalBytes: null,
                usedBytes: null,
                predictedBytes: 0,
                headroomBytes: 0,
                freeBytes: null,
                short: false,
              },
            ],
          }),
        }),
      ]);

      expect(row.cards).toEqual([
        {
          deviceKey: 'GPU-a',
          name: 'RTX 4090',
          total: '24 GiB',
          used: '4 GiB',
          starting: '6 GiB',
          headroom: '1 GiB',
          free: '14 GiB',
          short: true,
        },
        {
          deviceKey: 'GPU-b',
          name: null,
          total: '-',
          used: '-',
          starting: '-',
          headroom: '-',
          free: '-',
          short: false,
        },
      ]);
      expect(row.poolRam).toBe('12 GiB');
      expect(row.expandable).toBe(true);
    });

    it('offers no expansion where there are no figures to expand to, or nothing to explain', () => {
      const [unsized] = placementRows([refused(PlacementProblemReason.OTHER, { expectedUsage: null, capacity: null })]);
      const [fits] = placementRows([node({ capacity: capacity({ cards: [CARD] }) })]);

      expect(unsized).toMatchObject({ fit: PlacementFit.CANNOT_RUN, reason: 'The server sentence', expandable: false });
      expect(fits).toMatchObject({ fit: PlacementFit.FITS, reason: null, expandable: false });
    });
  });

  describe('describePlacementFit', () => {
    it('gives the same cells as the table, leaving out a figure with nothing to say', () => {
      expect(describePlacementFit(node())).toEqual([placementMemory(node()).vram]);
      expect(describePlacementFit(node({ devices: [], expectedUsage: null, capacity: null }))).toEqual([]);
    });

    it('adds RAM where anything is kept there', () => {
      const placed = node({
        capacity: capacity({ hostWeights: { neededBytes: 8 * GIB, cacheBytes: 8 * GIB, freeBytes: 6 * GIB } }),
      });

      expect(describePlacementFit(placed).map(cell => `${cell.label} ${cell.text}`)).toEqual([
        'VRAM 20 / 23 GiB free',
        'RAM 8 / 6 GiB free',
      ]);
    });
  });
});
