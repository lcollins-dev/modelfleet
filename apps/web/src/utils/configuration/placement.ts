import type {
  ConfigurationDocument,
  ConfigurationValue,
  GpuTelemetryDto,
  IPinnedGpu,
  NodeState,
  PlacementNodeDto,
} from '@libs/dto';

const PLACEMENT_FIELD = 'placement';
const PLACEMENT_GPUS_KEY = 'gpus';
const PLACEMENT_NODE_IDS_KEY = 'nodeIds';

export enum PlacementMode {
  AUTOMATIC = 'automatic',
  PIN = 'pin',
}

/** Both lists are empty where the deployment names no placement, which is the scheduler's own choice. */
export interface IPlacementSelection {
  gpus: IPinnedGpu[];
  nodeIds: number[];
}

export interface IPinRules {
  multiDevice: boolean;
  cpuOffload: boolean;
}

export const ANY_PINS: IPinRules = { multiDevice: true, cpuOffload: true };

export interface IPinnableNode {
  id: number;
  name: string;
  state: NodeState;
  devices: GpuTelemetryDto[];
  headroomBytes: number;
}

export const readPlacement = (configuration: ConfigurationDocument): IPlacementSelection => {
  const placement = configuration[PLACEMENT_FIELD];

  if (!isConfigurationObject(placement)) {
    return { gpus: [], nodeIds: [] };
  }

  const gpus = placement[PLACEMENT_GPUS_KEY];
  const nodeIds = placement[PLACEMENT_NODE_IDS_KEY];

  return {
    gpus: Array.isArray(gpus) ? gpus.filter(isPinnedGpu) : [],
    nodeIds: Array.isArray(nodeIds) ? nodeIds.filter(isNodeId) : [],
  };
};

/** Keeps the placement keys the picker does not model, and removes `placement` once it holds nothing. */
export const writePlacement = (
  configuration: ConfigurationDocument,
  selection: IPlacementSelection
): ConfigurationValue | undefined => {
  const placement = configuration[PLACEMENT_FIELD];
  const existing = isConfigurationObject(placement) ? placement : {};

  const kept: Record<string, ConfigurationValue> = Object.fromEntries(
    Object.entries(existing).filter(([key]) => key !== PLACEMENT_GPUS_KEY && key !== PLACEMENT_NODE_IDS_KEY)
  );

  if (selection.gpus.length > 0) {
    kept[PLACEMENT_GPUS_KEY] = selection.gpus.map(gpu => ({ nodeId: gpu.nodeId, deviceKey: gpu.deviceKey }));
  }

  if (selection.nodeIds.length > 0) {
    kept[PLACEMENT_NODE_IDS_KEY] = [...selection.nodeIds];
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
};

export const placementModeOf = (selection: IPlacementSelection): PlacementMode =>
  selection.gpus.length > 0 || selection.nodeIds.length > 0 ? PlacementMode.PIN : PlacementMode.AUTOMATIC;

export const isCpuPinned = (selection: IPlacementSelection, nodeId: number): boolean =>
  selection.nodeIds.includes(nodeId);

export const isDevicePinned = (selection: IPlacementSelection, nodeId: number, deviceKey: string): boolean =>
  selection.gpus.some(gpu => gpu.nodeId === nodeId && gpu.deviceKey === deviceKey);

export const isAnythingPinnedOn = (selection: IPlacementSelection, nodeId: number): boolean =>
  isCpuPinned(selection, nodeId) || selection.gpus.some(gpu => gpu.nodeId === nodeId);

/** The node checkbox covers that node's GPUs, so its state reads them alone and never the CPU beside them. */
export const isNodePinned = (selection: IPlacementSelection, nodeId: number, deviceKeys: string[]): boolean =>
  deviceKeys.length === 0
    ? isCpuPinned(selection, nodeId)
    : deviceKeys.every(deviceKey => isDevicePinned(selection, nodeId, deviceKey));

export const isNodePartlyPinned = (selection: IPlacementSelection, nodeId: number, deviceKeys: string[]): boolean =>
  !isNodePinned(selection, nodeId, deviceKeys) &&
  deviceKeys.some(deviceKey => isDevicePinned(selection, nodeId, deviceKey));

/** Everything ticked on one node, so a collapsed row still shows what an instance on it would take. */
export const describePins = (selection: IPlacementSelection, nodeId: number, deviceKeys: string[]): string => {
  const cards = deviceKeys.filter(deviceKey => isDevicePinned(selection, nodeId, deviceKey)).length;
  const pinned = [
    ...(isCpuPinned(selection, nodeId) ? ['CPU'] : []),
    ...(cards > 0 ? [cards === 1 ? '1 GPU' : `${cards} GPUs`] : []),
  ];

  return pinned.join(' and ');
};

/**
 * One line per pinned node, naming its GPUs as the placement picker does. A node or device `nodes` does not carry
 * reads by its id or key.
 */
export const describePlacement = (value: ConfigurationValue, nodes: PlacementNodeDto[]): string => {
  const selection = readPlacement({ [PLACEMENT_FIELD]: value });

  if (placementModeOf(selection) === PlacementMode.AUTOMATIC) {
    return 'Automatic';
  }

  const nodeIds = [...new Set([...selection.nodeIds, ...selection.gpus.map(gpu => gpu.nodeId)])];

  return nodeIds
    .map(nodeId => {
      const node = nodes.find(candidate => candidate.nodeId === nodeId);
      const gpus = selection.gpus
        .filter(gpu => gpu.nodeId === nodeId)
        .map(gpu => node?.devices.find(device => device.deviceKey === gpu.deviceKey)?.name ?? gpu.deviceKey);
      const pinned = [...(isCpuPinned(selection, nodeId) ? ['CPU'] : []), ...gpus];

      return `${node?.nodeName ?? `Node ${nodeId}`}: ${pinned.join(', ')}`;
    })
    .join('\n');
};

export const toggleCpuPin = (
  selection: IPlacementSelection,
  nodeId: number,
  checked: boolean,
  rules: IPinRules = ANY_PINS
): IPlacementSelection => {
  const without = selection.nodeIds.filter(id => id !== nodeId);
  const gpus = checked && !rules.cpuOffload ? selection.gpus.filter(gpu => gpu.nodeId !== nodeId) : selection.gpus;

  return { gpus, nodeIds: checked ? [...without, nodeId] : without };
};

export const toggleDevicePin = (
  selection: IPlacementSelection,
  nodeId: number,
  deviceKey: string,
  rules: IPinRules = ANY_PINS
): IPlacementSelection => {
  if (isDevicePinned(selection, nodeId, deviceKey)) {
    return {
      gpus: selection.gpus.filter(gpu => gpu.nodeId !== nodeId || gpu.deviceKey !== deviceKey),
      nodeIds: selection.nodeIds,
    };
  }

  const kept = rules.multiDevice ? selection.gpus : selection.gpus.filter(gpu => gpu.nodeId !== nodeId);

  return { gpus: [...kept, { nodeId, deviceKey }], nodeIds: withoutCpuUnlessOffload(selection, nodeId, rules) };
};

export const toggleNodePin = (
  selection: IPlacementSelection,
  nodeId: number,
  deviceKeys: string[],
  checked: boolean,
  rules: IPinRules = ANY_PINS
): IPlacementSelection => {
  if (deviceKeys.length === 0) {
    return toggleCpuPin(selection, nodeId, checked, rules);
  }

  const others = selection.gpus.filter(gpu => gpu.nodeId !== nodeId);

  if (!checked) {
    return { gpus: others, nodeIds: selection.nodeIds };
  }

  const own = (rules.multiDevice ? deviceKeys : deviceKeys.slice(0, 1)).map(deviceKey => ({ nodeId, deviceKey }));

  return { gpus: [...others, ...own], nodeIds: withoutCpuUnlessOffload(selection, nodeId, rules) };
};

const withoutCpuUnlessOffload = (selection: IPlacementSelection, nodeId: number, rules: IPinRules): number[] =>
  rules.cpuOffload ? selection.nodeIds : selection.nodeIds.filter(id => id !== nodeId);

const isConfigurationObject = (value: ConfigurationValue | undefined): value is Record<string, ConfigurationValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPinnedGpu = (value: ConfigurationValue): value is IPinnedGpu & Record<string, ConfigurationValue> =>
  isConfigurationObject(value) && typeof value['nodeId'] === 'number' && typeof value['deviceKey'] === 'string';

const isNodeId = (value: ConfigurationValue): value is number => typeof value === 'number';
