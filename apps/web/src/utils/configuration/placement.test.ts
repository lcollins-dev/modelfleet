import { describe, expect, it } from 'vitest';

import type { PlacementNodeDto } from '@libs/dto';

import {
  describePins,
  describePlacement,
  isAnythingPinnedOn,
  isCpuPinned,
  isDevicePinned,
  isNodePartlyPinned,
  isNodePinned,
  PlacementMode,
  placementModeOf,
  readPlacement,
  toggleCpuPin,
  toggleDevicePin,
  toggleNodePin,
  writePlacement,
} from './placement';

const SINGLE_DEVICE = { multiDevice: false, cpuOffload: false };

describe('readPlacement', () => {
  it('reads the pinned devices', () => {
    const configuration = { placement: { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }] } };

    expect(readPlacement(configuration)).toEqual({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] });
  });

  it('reads the node a CPU placement names', () => {
    expect(readPlacement({ placement: { nodeIds: [3] } })).toEqual({ gpus: [], nodeIds: [3] });
  });

  it('names nothing where the deployment holds no placement', () => {
    expect(readPlacement({ placement: { spreadAcrossNodes: true } })).toEqual({ gpus: [], nodeIds: [] });
    expect(readPlacement({})).toEqual({ gpus: [], nodeIds: [] });
  });

  it('drops an entry that is neither a pinned device nor a node id', () => {
    expect(readPlacement({ placement: { gpus: ['GPU-1'], nodeIds: ['3'] } })).toEqual({ gpus: [], nodeIds: [] });
  });
});

describe('placementModeOf', () => {
  it("reads a placement naming neither as the scheduler's own choice", () => {
    expect(placementModeOf({ gpus: [], nodeIds: [] })).toBe(PlacementMode.AUTOMATIC);
  });

  it("reads a placement naming a node's CPU as pinned", () => {
    expect(placementModeOf({ gpus: [], nodeIds: [3] })).toBe(PlacementMode.PIN);
  });

  it('reads a placement naming devices as pinned', () => {
    expect(placementModeOf({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] })).toBe(PlacementMode.PIN);
  });
});

describe('writePlacement', () => {
  it('keeps the placement keys the picker does not model', () => {
    const configuration = { placement: { spreadAcrossNodes: true } };

    expect(writePlacement(configuration, { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] })).toEqual({
      spreadAcrossNodes: true,
      gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }],
    });
  });

  it('writes the node whose CPU the deployment is pinned to', () => {
    expect(writePlacement({}, { gpus: [], nodeIds: [3] })).toEqual({ nodeIds: [3] });
  });

  it('removes placement once it holds nothing', () => {
    const configuration = { placement: { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }] } };

    expect(writePlacement(configuration, { gpus: [], nodeIds: [] })).toBeUndefined();
  });

  it('takes the pins out when the placement becomes a CPU one', () => {
    const configuration = { placement: { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }] } };

    expect(writePlacement(configuration, { gpus: [], nodeIds: [3] })).toEqual({ nodeIds: [3] });
  });

  it('leaves the other placement keys standing when the pins go', () => {
    const configuration = { placement: { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], spreadAcrossNodes: true } };

    expect(writePlacement(configuration, { gpus: [], nodeIds: [] })).toEqual({ spreadAcrossNodes: true });
  });
});

describe('toggleCpuPin', () => {
  it('leaves the GPUs pinned on that node, so an instance can take the CPU and the cards together', () => {
    const selection = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] };

    expect(toggleCpuPin(selection, 1, true)).toEqual({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] });
  });

  it('unticks the CPU without disturbing the GPUs', () => {
    const selection = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] };

    expect(toggleCpuPin(selection, 1, false)).toEqual({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] });
  });

  it('ticks a node once however often it is ticked', () => {
    const once = toggleCpuPin({ gpus: [], nodeIds: [] }, 1, true);

    expect(toggleCpuPin(once, 1, true).nodeIds).toEqual([1]);
  });

  it('leaves the other nodes alone', () => {
    expect(toggleCpuPin({ gpus: [], nodeIds: [2] }, 1, true).nodeIds).toEqual([2, 1]);
  });
});

describe('toggleDevicePin', () => {
  it('leaves the CPU pinned on that node, so ticking a card does not take the offload away', () => {
    const selection = { gpus: [], nodeIds: [1] };

    expect(toggleDevicePin(selection, 1, 'GPU-1')).toEqual({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] });
  });

  it('unticks a card that is already pinned', () => {
    const selection = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] };

    expect(toggleDevicePin(selection, 1, 'GPU-1')).toEqual({ gpus: [], nodeIds: [1] });
  });

  it('tells one card from a card of the same key on another node', () => {
    const selection = { gpus: [{ nodeId: 2, deviceKey: 'GPU-1' }], nodeIds: [] };

    expect(toggleDevicePin(selection, 1, 'GPU-1').gpus).toEqual([
      { nodeId: 2, deviceKey: 'GPU-1' },
      { nodeId: 1, deviceKey: 'GPU-1' },
    ]);
  });
});

describe('toggleNodePin', () => {
  it('ticks every card on the node and leaves the CPU as it was', () => {
    const selection = { gpus: [], nodeIds: [1] };

    expect(toggleNodePin(selection, 1, ['GPU-1', 'GPU-2'], true)).toEqual({
      gpus: [
        { nodeId: 1, deviceKey: 'GPU-1' },
        { nodeId: 1, deviceKey: 'GPU-2' },
      ],
      nodeIds: [1],
    });
  });

  it('unticks every card on the node and leaves the CPU as it was', () => {
    const selection = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] };

    expect(toggleNodePin(selection, 1, ['GPU-1'], false)).toEqual({ gpus: [], nodeIds: [1] });
  });

  it('ticks the CPU of a node with no card, which is the only thing it can run on', () => {
    expect(toggleNodePin({ gpus: [], nodeIds: [] }, 1, [], true)).toEqual({ gpus: [], nodeIds: [1] });
  });

  it('leaves the cards of the other nodes pinned', () => {
    const selection = { gpus: [{ nodeId: 2, deviceKey: 'GPU-9' }], nodeIds: [] };

    expect(toggleNodePin(selection, 1, ['GPU-1'], true).gpus).toEqual([
      { nodeId: 2, deviceKey: 'GPU-9' },
      { nodeId: 1, deviceKey: 'GPU-1' },
    ]);
  });
});

describe('isCpuPinned and isDevicePinned', () => {
  it('reads a node carrying both its CPU and a card as carrying each', () => {
    const selection = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] };

    expect(isCpuPinned(selection, 1)).toBe(true);
    expect(isDevicePinned(selection, 1, 'GPU-1')).toBe(true);
  });

  it('answers false for a node and a card nothing pinned', () => {
    const selection = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] };

    expect(isCpuPinned(selection, 2)).toBe(false);
    expect(isDevicePinned(selection, 1, 'GPU-2')).toBe(false);
    expect(isDevicePinned(selection, 2, 'GPU-1')).toBe(false);
  });
});

describe('isAnythingPinnedOn', () => {
  it('reads a node carrying its CPU alone, or a card alone, as carrying something', () => {
    expect(isAnythingPinnedOn({ gpus: [], nodeIds: [1] }, 1)).toBe(true);
    expect(isAnythingPinnedOn({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] }, 1)).toBe(true);
  });

  it('answers false for a node only others are pinned beside', () => {
    expect(isAnythingPinnedOn({ gpus: [{ nodeId: 2, deviceKey: 'GPU-1' }], nodeIds: [2] }, 1)).toBe(false);
  });
});

describe('isNodePinned and isNodePartlyPinned', () => {
  const both = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] };

  it('reads the GPUs alone, so a ticked CPU cannot hold the node checkbox down', () => {
    expect(isNodePinned(both, 1, ['GPU-1'])).toBe(true);
    expect(isNodePartlyPinned(both, 1, ['GPU-1'])).toBe(false);
  });

  it('clears once the GPUs go, even with the CPU still ticked', () => {
    const cpuOnly = { gpus: [], nodeIds: [1] };

    expect(isNodePinned(cpuOnly, 1, ['GPU-1', 'GPU-2'])).toBe(false);
    expect(isNodePartlyPinned(cpuOnly, 1, ['GPU-1', 'GPU-2'])).toBe(false);
  });

  it('is partly pinned where some of the GPUs are ticked', () => {
    const one = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] };

    expect(isNodePinned(one, 1, ['GPU-1', 'GPU-2'])).toBe(false);
    expect(isNodePartlyPinned(one, 1, ['GPU-1', 'GPU-2'])).toBe(true);
  });

  it('is the CPU for a node with no GPU to pin', () => {
    expect(isNodePinned({ gpus: [], nodeIds: [1] }, 1, [])).toBe(true);
    expect(isNodePinned({ gpus: [], nodeIds: [] }, 1, [])).toBe(false);
  });
});

describe('describePins', () => {
  it('names the CPU and the cards a node holds', () => {
    const both = {
      gpus: [
        { nodeId: 1, deviceKey: 'GPU-1' },
        { nodeId: 1, deviceKey: 'GPU-2' },
      ],
      nodeIds: [1],
    };

    expect(describePins(both, 1, ['GPU-1', 'GPU-2'])).toBe('CPU and 2 GPUs');
  });

  it('names one card in the singular and the CPU on its own', () => {
    expect(describePins({ gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [] }, 1, ['GPU-1'])).toBe('1 GPU');
    expect(describePins({ gpus: [], nodeIds: [1] }, 1, ['GPU-1'])).toBe('CPU');
  });

  it('is empty where the node holds nothing, so the row shows no trailing note', () => {
    expect(describePins({ gpus: [], nodeIds: [] }, 1, ['GPU-1'])).toBe('');
  });

  it('counts only the cards the node still reports', () => {
    const stale = { gpus: [{ nodeId: 1, deviceKey: 'GPU-gone' }], nodeIds: [] };

    expect(describePins(stale, 1, ['GPU-1'])).toBe('');
  });
});

describe('placement round trip', () => {
  it('writes and reads back a node holding its CPU and its GPUs together', () => {
    const selection = { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }], nodeIds: [1] };
    const placement = writePlacement({}, selection) ?? null;

    expect(readPlacement({ placement })).toEqual(selection);
  });
});

describe('pinning for a backend that runs on one GPU and cannot offload', () => {
  const selection = {
    gpus: [
      { nodeId: 1, deviceKey: 'GPU-1' },
      { nodeId: 2, deviceKey: 'GPU-9' },
    ],
    nodeIds: [3],
  };

  it("replaces the node's GPUs when its CPU is ticked, leaving other nodes alone", () => {
    expect(toggleCpuPin(selection, 1, true, SINGLE_DEVICE)).toEqual({
      gpus: [{ nodeId: 2, deviceKey: 'GPU-9' }],
      nodeIds: [3, 1],
    });
  });

  it("replaces the node's other GPU and its CPU when a GPU is ticked", () => {
    const withCpu = { ...selection, nodeIds: [1, 3] };

    expect(toggleDevicePin(withCpu, 1, 'GPU-2', SINGLE_DEVICE)).toEqual({
      gpus: [
        { nodeId: 2, deviceKey: 'GPU-9' },
        { nodeId: 1, deviceKey: 'GPU-2' },
      ],
      nodeIds: [3],
    });
  });

  it('unticks a GPU as it would for any backend', () => {
    expect(toggleDevicePin(selection, 1, 'GPU-1', SINGLE_DEVICE).gpus).toEqual([{ nodeId: 2, deviceKey: 'GPU-9' }]);
  });

  it('ticks a whole node onto its first GPU alone, clearing its CPU', () => {
    expect(toggleNodePin({ gpus: [], nodeIds: [1] }, 1, ['GPU-1', 'GPU-2'], true, SINGLE_DEVICE)).toEqual({
      gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }],
      nodeIds: [],
    });
  });

  it('ticks a node with no GPU onto its CPU', () => {
    expect(toggleNodePin({ gpus: [], nodeIds: [] }, 4, [], true, SINGLE_DEVICE)).toEqual({ gpus: [], nodeIds: [4] });
  });
});

describe('describePlacement', () => {
  const NODES: PlacementNodeDto[] = [
    {
      nodeId: 1,
      nodeName: 'rig-a',
      devices: [
        { deviceKey: 'GPU-1', name: 'NVIDIA GeForce RTX 5090' },
        { deviceKey: 'GPU-2', name: null },
      ],
      replicas: 1,
      running: 0,
      problem: null,
      expectedUsage: null,
      capacity: null,
    },
  ];

  it('reads a placement holding no pins as automatic', () => {
    expect(describePlacement({}, NODES)).toBe('Automatic');
  });

  it('names a pinned node and its devices as the picker does', () => {
    const placement = {
      nodeIds: [1],
      gpus: [
        { nodeId: 1, deviceKey: 'GPU-1' },
        { nodeId: 1, deviceKey: 'GPU-2' },
      ],
    };

    expect(describePlacement(placement, NODES)).toBe('rig-a: CPU, NVIDIA GeForce RTX 5090, GPU-2');
  });

  it('gives each node its own line, reading one it cannot name by its id', () => {
    const placement = { nodeIds: [1], gpus: [{ nodeId: 7, deviceKey: 'GPU-9' }] };

    expect(describePlacement(placement, NODES)).toBe('rig-a: CPU\nNode 7: GPU-9');
  });
});
