import { describe, expect, it } from 'vitest';

import { BackendId } from '@libs/backends';
import type {
  DeploymentResidencyDto,
  EffectiveConfigurationEntryDto,
  ListDeploymentDto,
  ListInstanceDto,
  PlacementNodeDto,
} from '@libs/dto';
import {
  ActivationPolicy,
  ConfigurationSource,
  ExpectedUsageSource,
  InstanceState,
  NodeState,
  ResidencyRule,
} from '@libs/dto';

import {
  countDeploymentRunStates,
  deploymentRunState,
  describeDeploymentPlacement,
  describeExpectedUsage,
  describeLaunchFailures,
  describePlacementFit,
  describeResidency,
  expectedUsageSourceTone,
  formatActivationPolicy,
  formatExpectedUsageSource,
  PlacementFit,
  placementFit,
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
  ...partial,
});

describe('formatActivationPolicy', () => {
  it('names each policy', () => {
    expect(formatActivationPolicy(ActivationPolicy.ALWAYS)).toBe('Always on');
    expect(formatActivationPolicy(ActivationPolicy.ON_DEMAND)).toBe('On demand');
  });
});

describe('describeResidency', () => {
  it('says an always deployment is kept running', () => {
    expect(describeResidency(residency(), true)).toMatch(/keeps this deployment running/);
  });

  it('says an always deployment with no instances will be started', () => {
    expect(describeResidency(residency(), false)).toMatch(/will start this deployment/);
  });

  it('says a disabled deployment runs nothing until it is enabled', () => {
    const line = describeResidency(residency({ rule: ResidencyRule.DISABLED }), false);

    expect(line).toMatch(/Disabled/);
    expect(line).toMatch(/until it is enabled/);
  });

  it('says a disabled deployment still serving will stop after its current requests', () => {
    const line = describeResidency(residency({ rule: ResidencyRule.DISABLED }), true);

    expect(line).toMatch(/after its current requests finish/);
  });

  it('names the inactivity timeout and when the deployment was last used', () => {
    const line = describeResidency(
      residency({
        rule: ResidencyRule.IDLE_TIMEOUT,
        idleTimeoutMs: 900_000,
        lastUsedDate: new Date(Date.now() - 60_000),
      }),
      true
    );

    expect(line).toMatch(/stops after 15m of inactivity/);
    expect(line).toMatch(/Last used/);
  });

  it('says which requests are keeping an idle deployment running', () => {
    const line = describeResidency(
      residency({ rule: ResidencyRule.IDLE_TIMEOUT, idleTimeoutMs: 900_000, inFlight: 2 }),
      true
    );

    expect(line).toMatch(/remain running while serving 2 requests/);
  });

  it('says an on-demand deployment with no instances is started by its first request', () => {
    const line = describeResidency(residency({ rule: ResidencyRule.IDLE_TIMEOUT, idleTimeoutMs: 900_000 }), false);

    expect(line).toMatch(/the first request starts this deployment/);
  });

  it('leaves out failed launches that hold nothing back', () => {
    expect(describeResidency(residency({ launchFailures: 3 }), false)).toBe(
      'Always on: the scheduler will start this deployment during its next pass.'
    );
  });

  it('says a deployment given up on will not be started, in place of the rule promising a start', () => {
    const line = describeResidency(residency({ launchFailures: 10, givenUp: true }), false);

    expect(line).toBe(
      'Given up: the last 10 launches failed, so the scheduler will not start this deployment again until it is ' +
        'started by hand or its configuration changes.'
    );
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

    expect(line).toBe('Its last launch failed, so it is not started again for another 45s.');
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
    outOfDate: false,
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

describe('describeExpectedUsage', () => {
  const node = (overrides: Partial<PlacementNodeDto> = {}): PlacementNodeDto => ({
    nodeId: 1,
    nodeName: 'rig-01',
    devices: [],
    replicas: 1,
    running: 0,
    problem: null,
    expectedUsage: {
      bytes: 14 * 1024 ** 3,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
    },
    capacity: null,
    ...overrides,
  });

  it('names the figure and that it was estimated', () => {
    expect(describeExpectedUsage(node())).toBe(
      'Expected to take 14 GiB on rig-01, estimated from the model and configuration'
    );
  });

  it('names a measured figure as measured', () => {
    const expectedUsage = {
      bytes: 14 * 1024 ** 3,
      source: ExpectedUsageSource.MEASURED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
    };

    expect(describeExpectedUsage(node({ expectedUsage }))).toBe(
      'Expected to take 14 GiB on rig-01, measured on an earlier run'
    );
  });

  it.each([
    [ExpectedUsageSource.CONFIGURED, 'the share of each GPU its backend is configured to take', 'Configured'],
    [ExpectedUsageSource.DECLARED, 'as declared on the deployment', 'Declared'],
  ])('names a %s figure by where it came from', (source, described, label) => {
    const expectedUsage = { bytes: 14 * 1024 ** 3, source, hostWeightsBytes: 0, hostResidentBytes: 0 };

    expect(describeExpectedUsage(node({ expectedUsage }))).toBe(`Expected to take 14 GiB on rig-01, ${described}`);
    expect(formatExpectedUsageSource(source)).toBe(label);
  });

  it('names what the estimate keeps off the GPUs', () => {
    const expectedUsage = {
      bytes: 78 * 1024 ** 3,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 33 * 1024 ** 3,
      hostResidentBytes: 0,
    };

    expect(describeExpectedUsage(node({ expectedUsage }))).toBe(
      'Expected to take 78 GiB on rig-01, estimated from the model and configuration, ' +
        'excluding 33 GiB kept off the GPUs'
    );
  });

  it('says nothing for a node with no figure', () => {
    expect(describeExpectedUsage(node({ expectedUsage: null }))).toBeNull();
  });
});

describe('placementRows', () => {
  const GIB = 1024 ** 3;

  const node = (overrides: Partial<PlacementNodeDto> = {}): PlacementNodeDto => ({
    nodeId: 1,
    nodeName: 'rig-01',
    devices: [{ deviceKey: 'GPU-a', name: null }],
    replicas: 1,
    running: 0,
    problem: null,
    expectedUsage: {
      bytes: 85 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 33 * GIB,
      hostResidentBytes: 0,
    },
    capacity: { expectedBytes: 85 * GIB, availableBytes: 90 * GIB, hostFreeBytes: null, cards: [], hostWeights: null },
    ...overrides,
  });

  it('gives a node that fits its figures and what is free, with a dash for nothing in system memory', () => {
    expect(placementRows([node()])).toEqual([
      {
        nodeId: 1,
        nodeName: 'rig-01',
        source: ExpectedUsageSource.ESTIMATED,
        expected: '85 GiB',
        free: '90 GiB',
        offGpus: '33 GiB',
        systemMemory: '-',
        expectedShort: false,
        systemMemoryShort: false,
        fit: PlacementFit.FITS,
        reason: null,
        cards: [],
        poolSystemMemory: null,
      },
    ]);
  });

  it('gives each card the refusal was checked on, dashing what is unmeasured or zero', () => {
    const [row] = placementRows([
      node({
        problem: 'This deployment needs 40.0 GiB on GPU-a, more than it has free',
        capacity: {
          expectedBytes: 85 * GIB,
          availableBytes: 90 * GIB,
          hostFreeBytes: 12 * GIB,
          cards: [
            {
              deviceKey: 'GPU-a',
              name: 'RTX 4090',
              totalBytes: 24 * GIB,
              usedBytes: 4 * GIB,
              predictedBytes: 6 * GIB,
              headroomBytes: GIB,
              freeBytes: 14 * GIB,
            },
            {
              deviceKey: 'GPU-b',
              name: null,
              totalBytes: null,
              usedBytes: null,
              predictedBytes: 0,
              headroomBytes: 0,
              freeBytes: null,
            },
          ],
          hostWeights: null,
        },
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
      },
      { deviceKey: 'GPU-b', name: null, total: '-', used: '-', starting: '-', headroom: '-', free: '-' },
    ]);
    expect(row.poolSystemMemory).toBe('12 GiB');
  });

  it('marks the expected figure short where the pool cannot hold it, giving the refusal as the reason', () => {
    const [row] = placementRows([
      node({
        problem: 'This deployment needs 85.0 GiB, more than the pinned GPUs have free',
        capacity: {
          expectedBytes: 85 * GIB,
          availableBytes: 60 * GIB,
          hostFreeBytes: null,
          cards: [],
          hostWeights: null,
        },
      }),
    ]);

    expect(row.free).toBe('60 GiB');
    expect(row.expectedShort).toBe(true);
    expect(row.systemMemoryShort).toBe(false);
    expect(row.fit).toBe(PlacementFit.SHORT);
    expect(row.reason).toBe('This deployment needs 85.0 GiB, more than the pinned GPUs have free');
  });

  it('gives the system memory checked beside what is free, marked short where it does not fit', () => {
    const [row] = placementRows([
      node({
        problem: 'This deployment keeps 6.0 GiB of weights in system memory, more than the node has free',
        expectedUsage: {
          bytes: 20 * GIB,
          source: ExpectedUsageSource.ESTIMATED,
          hostWeightsBytes: 30 * GIB,
          hostResidentBytes: 6 * GIB,
        },
        capacity: {
          expectedBytes: 20 * GIB,
          availableBytes: 23 * GIB,
          hostFreeBytes: null,
          cards: [],
          hostWeights: { neededBytes: 6 * GIB, freeBytes: 4 * GIB },
        },
      }),
    ]);

    expect(row.offGpus).toBe('30 GiB');
    expect(row.systemMemory).toBe('6 GiB (4 GiB free)');
    expect(row.systemMemoryShort).toBe(true);
    expect(row.expectedShort).toBe(false);
  });

  it('gives a node already running its share the system memory it holds, with nothing free to compare and no reason', () => {
    const [row] = placementRows([
      node({
        expectedUsage: {
          bytes: 20 * GIB,
          source: ExpectedUsageSource.MEASURED,
          hostWeightsBytes: 30 * GIB,
          hostResidentBytes: 6 * GIB,
        },
        capacity: null,
      }),
    ]);

    expect(row.source).toBe(ExpectedUsageSource.MEASURED);
    expect(row.free).toBe('-');
    expect(row.systemMemory).toBe('6 GiB');
    expect(row.fit).toBe(PlacementFit.HELD);
    expect(row.reason).toBeNull();
  });

  it('keeps a node no source could size, dashing its figures and giving why it cannot be placed', () => {
    const [row] = placementRows([node({ problem: 'The node is offline', expectedUsage: null, capacity: null })]);

    expect(row).toMatchObject({
      source: null,
      expected: '-',
      free: '-',
      offGpus: '-',
      systemMemory: '-',
      fit: PlacementFit.BLOCKED,
      reason: 'The node is offline',
      cards: [],
      poolSystemMemory: null,
    });
  });
});

describe('expected usage source', () => {
  it('labels each source', () => {
    expect(formatExpectedUsageSource(ExpectedUsageSource.MEASURED)).toBe('Measured');
    expect(formatExpectedUsageSource(ExpectedUsageSource.ESTIMATED)).toBe('Estimated');
  });

  it('marks a measured figure out from an estimate', () => {
    expect(expectedUsageSourceTone(ExpectedUsageSource.MEASURED)).toBe('success');
    expect(expectedUsageSourceTone(ExpectedUsageSource.ESTIMATED)).toBe('default');
  });
});

describe('placement fit', () => {
  const GIB = 1024 ** 3;

  const node = (overrides: Partial<PlacementNodeDto> = {}): PlacementNodeDto => ({
    nodeId: 1,
    nodeName: 'rig-01',
    devices: [{ deviceKey: 'GPU-a', name: null }],
    replicas: 1,
    running: 0,
    problem: null,
    expectedUsage: {
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
    },
    capacity: { expectedBytes: 20 * GIB, availableBytes: 23 * GIB, hostFreeBytes: null, cards: [], hostWeights: null },
    ...overrides,
  });

  const tooLarge = node({
    problem: 'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
    capacity: { expectedBytes: 20 * GIB, availableBytes: 13 * GIB, hostFreeBytes: null, cards: [], hostWeights: null },
  });

  it('reads a node the ledger checked and passed as fitting, naming the figure and what is left', () => {
    expect(placementFit(node())).toBe(PlacementFit.FITS);
    expect(describePlacementFit(node())).toEqual([
      'Expected to take 20 GiB on rig-01, estimated from the model and configuration',
      'Needs 20 GiB. Free after headroom: 23 GiB',
    ]);
  });

  it('reads a node refused for room as not fitting, naming the shortfall rather than repeating the refusal', () => {
    expect(placementFit(tooLarge)).toBe(PlacementFit.SHORT);
    expect(describePlacementFit(tooLarge)).toEqual([
      'Expected to take 20 GiB on rig-01, estimated from the model and configuration',
      'Needs 20 GiB. Free after headroom: 13 GiB. Short by 7 GiB',
    ]);
  });

  it('reads a node refused for system memory as not fitting, naming that shortfall', () => {
    const hostShort = node({
      problem: 'This deployment keeps 30.0 GiB of weights in system memory, more than the node has free',
      expectedUsage: {
        bytes: 20 * GIB,
        source: ExpectedUsageSource.ESTIMATED,
        hostWeightsBytes: 30 * GIB,
        hostResidentBytes: 30 * GIB,
      },
      capacity: {
        expectedBytes: 20 * GIB,
        availableBytes: 23 * GIB,
        hostFreeBytes: null,
        cards: [],
        hostWeights: { neededBytes: 30 * GIB, freeBytes: 12 * GIB },
      },
    });

    expect(placementFit(hostShort)).toBe(PlacementFit.SHORT);
    expect(describePlacementFit(hostShort)).not.toContain(hostShort.problem);
  });

  it('reads an offloading node short of room once its host weights join the pool', () => {
    const pooled = node({
      problem: 'This deployment needs 25.0 GiB, more than the pinned GPUs and system memory have free',
      capacity: {
        expectedBytes: 20 * GIB,
        availableBytes: 23 * GIB,
        hostFreeBytes: 16 * GIB,
        cards: [],
        hostWeights: { neededBytes: 5 * GIB, freeBytes: 16 * GIB },
      },
    });

    expect(placementFit(pooled)).toBe(PlacementFit.SHORT);
  });

  it('says why a node that could not be sized cannot be placed, with no figure in its place', () => {
    const unsized = node({
      problem: "This deployment's memory use cannot be estimated without the model's layerCount",
      expectedUsage: null,
      capacity: null,
    });

    expect(placementFit(unsized)).toBe(PlacementFit.BLOCKED);
    expect(describePlacementFit(unsized)).toEqual([
      "This deployment's memory use cannot be estimated without the model's layerCount",
    ]);
  });

  it('reads a node with no reading as unplaceable rather than short, since nothing says how much is free', () => {
    const unread = node({
      problem: 'This node has not reported its GPU memory since it connected',
      capacity: { expectedBytes: 20 * GIB, availableBytes: null, hostFreeBytes: null, cards: [], hostWeights: null },
    });

    expect(placementFit(unread)).toBe(PlacementFit.BLOCKED);
    expect(describePlacementFit(unread)).toContain('Needs 20 GiB. Free after headroom: -');
  });

  it('leaves a node already holding its instances to its expected usage, its status saying the rest', () => {
    const held = node({ running: 1, capacity: null });

    expect(placementFit(held)).toBe(PlacementFit.HELD);
    expect(describePlacementFit(held)).toEqual([
      'Expected to take 20 GiB on rig-01, estimated from the model and configuration',
    ]);
  });

  it('says nothing more of a node pinned on its CPU alone than its status does', () => {
    const onCpu = node({ devices: [], expectedUsage: null, capacity: null });

    expect(placementFit(onCpu)).toBe(PlacementFit.CPU_ONLY);
    expect(describePlacementFit(onCpu)).toEqual([]);
  });
});
