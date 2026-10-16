import { BackendConfiguration, BackendDeclaration, configuredNumber } from '../configuration';
import { GIB, VramEstimateDefinition, VramSource } from '../definition';

type EstimateOf<TSource extends VramSource> = Extract<VramEstimateDefinition, { source: TSource }>;

export interface IModelMetadata {
  sizeBytes: number;

  architecture: string | null;
  quantisation: string | null;
  layerCount: number | null;
  embeddingLength: number | null;
  headCount: number | null;
  headCountKv: number | null;
  contextLength: number | null;
}

export interface IModelTensor {
  name: string;
  sizeBytes: number;
}

export interface IEstimatedModel extends IModelMetadata {
  /** The largest tensors alone, so a tensor left off the list still counts in full. */
  tensors: readonly IModelTensor[] | null;
}

export interface IEstimatedDevice {
  deviceKey: string;
  totalBytes: number | null;
}

export interface IEstimatedCompanion {
  field: string;
  sizeBytes: number;
}

export interface IVramEstimateInput {
  model: IEstimatedModel;
  companions: readonly IEstimatedCompanion[];
  configuration: BackendConfiguration;

  deviceCount: number;

  /** One per pinned card, in pin order. */
  devices: readonly IEstimatedDevice[];
}

export enum EstimateInputSource {
  MODEL_METADATA = 'modelMetadata',
  CONFIGURATION = 'configuration',
  DEVICE = 'device',
}

export interface IMissingEstimateInput {
  source: EstimateInputSource;

  field: string;
}

export enum EstimateBasis {
  METADATA = 'metadata',

  CONFIGURATION = 'configuration',

  WEIGHTS = 'weights',
}

export interface IComputedVramEstimate {
  computed: true;
  basis: EstimateBasis;

  totalBytes: number;

  weightsBytes: number;
  kvCacheBytes: number;

  overheadBytes: number;

  /** Left out of `weightsBytes` and the total. */
  hostWeightsBytes: number;

  hostResidentBytes: number;
}

export interface IUnavailableVramEstimate {
  computed: false;

  missing: readonly IMissingEstimateInput[];
}

export type IVramEstimate = IComputedVramEstimate | IUnavailableVramEstimate;

export interface IWeightsEstimateParts {
  bytes: number;

  factor: number;

  overheadBytesPerDevice: number;
  deviceCount: number;
}

export function missingModelMetadata(field: keyof IModelMetadata): IMissingEstimateInput {
  return { source: EstimateInputSource.MODEL_METADATA, field };
}

export function missingConfiguration(field: string): IMissingEstimateInput {
  return { source: EstimateInputSource.CONFIGURATION, field };
}

export function missingDeviceTotal(deviceKey: string): IMissingEstimateInput {
  return { source: EstimateInputSource.DEVICE, field: deviceKey };
}

export function unavailableEstimate(missing: readonly IMissingEstimateInput[]): IUnavailableVramEstimate {
  return { computed: false, missing };
}

export function computedEstimate(parts: {
  basis: EstimateBasis;
  weightsBytes: number;
  kvCacheBytes: number;
  overheadBytes: number;
  hostWeightsBytes: number;
  hostResidentBytes: number;
}): IComputedVramEstimate {
  return {
    computed: true,
    totalBytes: parts.weightsBytes + parts.kvCacheBytes + parts.overheadBytes,
    ...parts,
  };
}

export function deviceTotals(input: IVramEstimateInput): number[] | IMissingEstimateInput[] {
  const missing = input.devices
    .filter(device => device.totalBytes === null)
    .map(device => missingDeviceTotal(device.deviceKey));

  if (missing.length > 0) {
    return missing;
  }

  return input.devices.map(device => device.totalBytes ?? 0);
}

export function fractionOfDevices(input: IVramEstimateInput, fraction: number): IVramEstimate {
  const totals = deviceTotals(input);

  if (!totals.every(total => typeof total === 'number')) {
    return unavailableEstimate(totals.filter(total => typeof total !== 'number'));
  }

  return computedEstimate({
    basis: EstimateBasis.CONFIGURATION,
    weightsBytes: 0,
    kvCacheBytes: 0,
    overheadBytes: totals.reduce((sum, total) => sum + Math.round(total * fraction), 0),
    hostWeightsBytes: 0,
    hostResidentBytes: 0,
  });
}

export function weightsEstimate(parts: IWeightsEstimateParts): IComputedVramEstimate {
  return computedEstimate({
    basis: EstimateBasis.WEIGHTS,
    weightsBytes: Math.round(parts.bytes * parts.factor),
    kvCacheBytes: 0,
    overheadBytes: parts.overheadBytesPerDevice * parts.deviceCount,
    hostWeightsBytes: 0,
    hostResidentBytes: 0,
  });
}

export function configuredShareEstimate(
  input: IVramEstimateInput,
  declaration: BackendDeclaration,
  vram: EstimateOf<VramSource.CONFIGURATION>
): IVramEstimate {
  const fraction = configuredNumber(declaration, input.configuration, vram.fractionField);

  return fraction === undefined
    ? unavailableEstimate([missingConfiguration(vram.fractionField)])
    : fractionOfDevices(input, fraction);
}

export function configuredSizeEstimate(
  input: IVramEstimateInput,
  declaration: BackendDeclaration,
  vram: EstimateOf<VramSource.SIZE>
): IVramEstimate {
  const gib = configuredNumber(declaration, input.configuration, vram.gibField);

  if (gib === undefined) {
    return unavailableEstimate([missingConfiguration(vram.gibField)]);
  }

  return computedEstimate({
    basis: EstimateBasis.CONFIGURATION,
    weightsBytes: 0,
    kvCacheBytes: 0,
    overheadBytes: Math.round(gib * GIB),
    hostWeightsBytes: 0,
    hostResidentBytes: 0,
  });
}

export function weightsOnDiskEstimate(input: IVramEstimateInput, vram: EstimateOf<VramSource.WEIGHTS>): IVramEstimate {
  const companionBytes = input.companions.reduce((total, companion) => total + companion.sizeBytes, 0);

  return weightsEstimate({
    bytes: input.model.sizeBytes + companionBytes,
    factor: vram.factor,
    overheadBytesPerDevice: vram.overheadBytesPerDevice,
    deviceCount: input.deviceCount,
  });
}
