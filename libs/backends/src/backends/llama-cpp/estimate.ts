import { IConfiguredValues } from '../../configuration';
import { MIB } from '../../definition';
import {
  IMissingEstimateInput,
  IEstimatedModel,
  IModelTensor,
  IVramEstimate,
  IVramEstimateInput,
  computedEstimate,
  EstimateBasis,
  missingConfiguration,
  missingModelMetadata,
  unavailableEstimate,
  weightsEstimate,
} from '../../runtime/estimate';
import { LlamaCppField } from './declaration';
import {
  IKvLayer,
  isRecurrentArchitecture,
  kvLayers,
  mirrorsWeights,
  paddedCells,
  recurrentLayerCount,
} from './kv-layout';
import { IHostPlacement, expertsOnCpu, hostPlacement, overridesTensors } from './override-tensor';

/** cuBLAS handles, the CUDA context and allocator slack, which llama.cpp takes on each device it holds. */
const RUNTIME_BYTES_PER_DEVICE = 384 * MIB;

/** Fitted to llama.cpp's compute buffer, so coarse. */
const COMPUTE_BYTES_PER_BATCHED_ELEMENT = 64;

/** `GGML_SCHED_MAX_COPIES`, the build default: each card holds this many copies of its inputs when pipelined. */
const PIPELINE_COPIES = 4;

/** The attention mask is f16 under flash attention and f32 without. */
const FLASH_MASK_BYTES = 2;
const MASK_BYTES = 4;

/** Without flash attention the KQ scores are f32, and the matrix and its softmax are live together. */
const SCORE_BYTES = 4;
const LIVE_SCORE_MATRICES = 2;

/** Unset is `auto`, which maps the file wherever the devices support it. */
const MAPPED_LOAD_MODES = new Set(['auto', 'mmap']);

const LOCKED_MAPPED_LOAD_MODE = 'mmap+mlock';

/** Bytes one element of the key or value cache takes, from each ggml type's block size over its 32 elements. */
const CACHE_TYPE_BYTES = new Map<string, number>([
  ['f32', 4],
  ['f16', 2],
  ['bf16', 2],
  ['q8_0', 34 / 32],
  ['q5_1', 24 / 32],
  ['q5_0', 22 / 32],
  ['q4_1', 20 / 32],
  ['q4_0', 18 / 32],
  ['iq4_nl', 18 / 32],
]);

/** llama.cpp gives a draft its own f16 key and value caches, whatever the main model's are. */
const DRAFT_ELEMENT_BYTES = 2;

/** Matches llama.cpp's `--cache-ram` default, since an unset field passes no flag. */
const DEFAULT_PROMPT_CACHE_MIB = 8192;

const NEXTN_SPECULATIVE_TYPE = 'draft-mtp';

const LAYER_INDEX = /^blk\.(\d+)\./;

/** llama.cpp's default `--ctx-checkpoints`, kept per slot. */
const CHECKPOINTS_PER_SLOT = 32;

/** Recurrent state elements per embedding element and layer. They differ by architecture, so this is coarse. */
const RECURRENT_STATE_ELEMENTS = 64;
const RECURRENT_STATE_BYTES = 4;

interface IResolvedInputs {
  embeddingLength: number;
  headCount: number;

  cellsPerSequence: number;
  streams: number;
  ubatchSize: number;

  keyElementBytes: number;
  valueElementBytes: number;

  layers: IKvLayer[];
  recurrentLayers: number;

  kvOffloaded: boolean;
  flashAttention: boolean;

  pipelined: boolean;
}

interface IContext {
  cellsPerSequence: number;
  streams: number;
}

export function llamaCppVramEstimate(input: IVramEstimateInput, values: IConfiguredValues): IVramEstimate {
  const resolved = resolveInputs(input, values);

  return Array.isArray(resolved)
    ? unavailableEstimate(resolved, promptCacheBytes(input.model, values))
    : estimateFrom(input, values, resolved);
}

function estimateFrom(input: IVramEstimateInput, values: IConfiguredValues, resolved: IResolvedInputs): IVramEstimate {
  const draft = draftInputs(input, values, resolved);
  const model = withLoadedTensors(input.model, values);
  const placement = hostPlacement(model, values);
  const projectorInRamBytes = projectorBytesInRam(input, values);
  const hostWeightsBytes = sizeOf(placement.tensors) + projectorInRamBytes;
  const companions = weightsEstimate({
    bytes: input.companions.reduce((total, companion) => total + companion.sizeBytes, 0) - projectorInRamBytes,
    factor: 1,
    overheadBytesPerDevice: 0,
    deviceCount: input.deviceCount,
  });
  const copies = resolved.kvOffloaded ? kvCopies(input, values) : 1;
  const cacheBytes = kvCacheBytes(resolved, copies) + (draft === null ? 0 : kvCacheBytes(draft, 1));

  return computedEstimate({
    basis: EstimateBasis.METADATA,
    weightsBytes: cardWeightBytes(input, values) * weightCopies(input, values) + companions.weightsBytes,
    kvCacheBytes: resolved.kvOffloaded ? cacheBytes : 0,
    overheadBytes: overheadBytes(input, values, resolved, draft),
    hostWeightsBytes,
    hostResidentBytes:
      residentBytes(placement, values) +
      projectorInRamBytes +
      (resolved.kvOffloaded ? 0 : cacheBytes) +
      (expertsOnCpu(values) ? activationBytes(resolved) : 0),
    hostCacheBytes: promptCacheBytes(input.model, values) + checkpointBytes(resolved),
  });
}

/** llama.cpp reads a projector it does not offload into a host buffer, so all of it is resident. */
function projectorBytesInRam(input: IVramEstimateInput, values: IConfiguredValues): number {
  if (values.boolean(LlamaCppField.NO_MMPROJ_OFFLOAD) !== true) {
    return 0;
  }

  return input.companions
    .filter(companion => companion.field === LlamaCppField.PROJECTOR)
    .reduce((total, companion) => total + companion.sizeBytes, 0);
}

/** llama.cpp loads NextN tensors only with `draft-mtp`. */
function withLoadedTensors(model: IEstimatedModel, values: IConfiguredValues): IEstimatedModel {
  const nextnLayers = model.attention?.nextnLayerCount ?? 0;

  if (model.tensors === null || model.layerCount === null || nextnLayers <= 0 || loadsNextn(values)) {
    return model;
  }

  const trunkLayers = model.layerCount - nextnLayers;

  return { ...model, tensors: model.tensors.filter(tensor => !isLayerFrom(tensor.name, trunkLayers)) };
}

function isLayerFrom(name: string, firstLayer: number): boolean {
  const layer = LAYER_INDEX.exec(name);

  return layer !== null && Number(layer[1]) >= firstLayer;
}

function loadsNextn(values: IConfiguredValues): boolean {
  return values.text(LlamaCppField.SPECULATIVE_TYPE) === NEXTN_SPECULATIVE_TYPE;
}

export function mirroredBytes(input: IVramEstimateInput, values: IConfiguredValues): number {
  const copies = kvCopies(input, values);
  const resolved = resolveInputs(input, values);

  if (copies === 1 || Array.isArray(resolved)) {
    return 0;
  }

  const cache = resolved.kvOffloaded
    ? resolved.layers.filter(layer => layer.mirrored).reduce((total, layer) => total + layerBytes(resolved, layer), 0)
    : 0;
  const weights = mirrorsWeights(input.model.architecture) ? cardWeightBytes(input, values) : 0;

  return Math.round(cache * copies) + weights * copies;
}

function cardWeightBytes(input: IVramEstimateInput, values: IConfiguredValues): number {
  const model = withLoadedTensors(input.model, values);
  const placement = hostPlacement(model, values);
  const skippedBytes = sizeOf(input.model.tensors ?? []) - sizeOf(model.tensors ?? []);

  return input.model.sizeBytes - skippedBytes - sizeOf(placement.tensors) + placement.cardCopyBytes;
}

function kvCopies(input: IVramEstimateInput, values: IConfiguredValues): number {
  return values.text(LlamaCppField.SPLIT_MODE) === 'tensor' ? input.deviceCount : 1;
}

function weightCopies(input: IVramEstimateInput, values: IConfiguredValues): number {
  return mirrorsWeights(input.model.architecture) ? kvCopies(input, values) : 1;
}

/** A decision model turns its prompt cache off unless the operator set one. */
function promptCacheBytes(model: IEstimatedModel, values: IConfiguredValues): number {
  const configured = values.number(LlamaCppField.PROMPT_CACHE);

  if (configured !== undefined) {
    return configured * MIB;
  }

  return (model.attention?.decisionType ?? null) === null ? DEFAULT_PROMPT_CACHE_MIB * MIB : 0;
}

/**
 * A table read only by row from a mapped file costs only the few rows each token pages in, and those pages are reclaimable. Every
 * other tensor is read whole each time its layer runs, so it holds its full size. A load mode that reads the file holds
 * every tensor in full, except a lazy table, which stays on a mapping of its own under any of them.
 */
function residentBytes(placement: IHostPlacement, values: IConfiguredValues): number {
  const loadMode = values.text(LlamaCppField.LOAD_MODE) ?? 'auto';

  if (loadMode === LOCKED_MAPPED_LOAD_MODE) {
    return lockedBytes(placement);
  }

  const unheld = MAPPED_LOAD_MODES.has(loadMode) ? placement.readByRow : placement.lazy;

  return sizeOf(placement.tensors.filter(tensor => !unheld.includes(tensor)));
}

/**
 * Every shard is locked from its start to the end of its last host tensor, so card tensors between them stay in RAM
 * too. A lazy table is never locked. A scan with no offsets falls back to the host tensors alone.
 */
function lockedBytes(placement: IHostPlacement): number {
  const locked = placement.tensors.filter(tensor => !placement.lazy.includes(tensor));

  if (placement.tensors.some(tensor => tensor.offsetBytes === undefined)) {
    return sizeOf(placement.tensors);
  }

  const shardEnds = new Map<number, number>();

  for (const tensor of locked) {
    const shard = tensor.shard ?? 0;

    shardEnds.set(shard, Math.max(shardEnds.get(shard) ?? 0, (tensor.offsetBytes ?? 0) + tensor.sizeBytes));
  }

  return [...shardEnds.values()].reduce((total, end) => total + end, 0);
}

function sizeOf(tensors: readonly IModelTensor[]): number {
  return tensors.reduce((total, tensor) => total + tensor.sizeBytes, 0);
}

function streamBytes(resolved: IResolvedInputs, layer: IKvLayer): number {
  return (
    layer.cells * (layer.keyElements * resolved.keyElementBytes + layer.valueElements * resolved.valueElementBytes)
  );
}

function layerBytes(resolved: IResolvedInputs, layer: IKvLayer): number {
  return streamBytes(resolved, layer) * resolved.streams;
}

function kvCacheBytes(resolved: IResolvedInputs, copies: number): number {
  const total = resolved.layers.reduce(
    (sum, layer) => sum + layerBytes(resolved, layer) * (layer.mirrored ? copies : 1),
    0
  );

  return Math.round(total);
}

/** A slot keeps its own checkpoints of what it cannot roll back: its sliding-window cache, or its recurrent state. */
function checkpointBytes(resolved: IResolvedInputs): number {
  const windowed = resolved.layers
    .filter(layer => layer.window)
    .reduce((sum, layer) => sum + streamBytes(resolved, layer), 0);
  const recurrent =
    resolved.recurrentLayers * resolved.embeddingLength * RECURRENT_STATE_ELEMENTS * RECURRENT_STATE_BYTES;

  return Math.round(CHECKPOINTS_PER_SLOT * resolved.streams * (windowed + recurrent));
}

function overheadBytes(
  input: IVramEstimateInput,
  values: IConfiguredValues,
  resolved: IResolvedInputs,
  draft: IResolvedInputs | null
): number {
  const splitMode = values.text(LlamaCppField.SPLIT_MODE);
  const devicesUsed = splitMode === 'none' ? Math.min(input.deviceCount, 1) : input.deviceCount;
  const draftBytes = draft === null ? 0 : computeBytes(draft);

  return devicesUsed * Math.round(RUNTIME_BYTES_PER_DEVICE + computeBytes(resolved) + draftBytes);
}

function computeBytes(resolved: IResolvedInputs): number {
  const totalContext = resolved.cellsPerSequence * resolved.streams;
  const tokens = Math.min(totalContext, resolved.ubatchSize);
  const maskBytes = resolved.flashAttention ? FLASH_MASK_BYTES : MASK_BYTES;
  const mask = resolved.kvOffloaded ? totalContext * tokens * maskBytes : 0;
  const copies = resolved.pipelined ? PIPELINE_COPIES : 1;

  return copies * mask + activationBytes(resolved) + scoreBytes(resolved);
}

function activationBytes(resolved: IResolvedInputs): number {
  return resolved.ubatchSize * resolved.embeddingLength * COMPUTE_BYTES_PER_BATCHED_ELEMENT;
}

/** Flash attention computes its scores in place. Without it the graph holds them as a matrix per stream of cells. */
function scoreBytes(resolved: IResolvedInputs): number {
  if (resolved.flashAttention || !resolved.kvOffloaded) {
    return 0;
  }

  const tokens = Math.min(resolved.cellsPerSequence, resolved.ubatchSize);

  return resolved.cellsPerSequence * tokens * resolved.headCount * SCORE_BYTES * LIVE_SCORE_MATRICES;
}

function pipelines(input: IVramEstimateInput, values: IConfiguredValues, kvOffloaded: boolean): boolean {
  return splitsAcrossCards(input, values, kvOffloaded) && !overridesTensors(values);
}

function splitsAcrossCards(input: IVramEstimateInput, values: IConfiguredValues, kvOffloaded: boolean): boolean {
  const splitMode = values.text(LlamaCppField.SPLIT_MODE) ?? 'layer';

  return input.deviceCount > 1 && kvOffloaded && splitMode === 'layer';
}

/**
 * The draft takes the main context's length and the main launch's split, but not its tensor overrides, so it pipelines
 * where the main model may not. Null where the draft's header lacks what the sizing needs, which leaves its file alone.
 */
function draftInputs(
  input: IVramEstimateInput,
  values: IConfiguredValues,
  resolved: IResolvedInputs
): IResolvedInputs | null {
  const metadata = input.companions.find(companion => companion.field === LlamaCppField.DRAFT_MODEL)?.metadata;

  if (metadata === undefined || metadata === null) {
    return null;
  }

  const { layerCount, embeddingLength, headCount, headCountKv } = metadata;

  if (
    layerCount === null ||
    embeddingLength === null ||
    headCount === null ||
    headCountKv === null ||
    layerCount <= 0 ||
    embeddingLength <= 0 ||
    headCount <= 0 ||
    headCountKv <= 0
  ) {
    return null;
  }

  return {
    ...resolved,
    embeddingLength,
    headCount,
    keyElementBytes: DRAFT_ELEMENT_BYTES,
    valueElementBytes: DRAFT_ELEMENT_BYTES,
    layers: kvLayers(
      { architecture: null, attention: null },
      {
        layerCount,
        embeddingLength,
        headCount,
        headCountKv,
        cellsPerSequence: resolved.cellsPerSequence,
        ubatchSize: resolved.ubatchSize,
        nextnLoaded: true,
      }
    ),
    recurrentLayers: 0,
    pipelined: splitsAcrossCards(input, values, resolved.kvOffloaded),
  };
}

function resolveInputs(
  input: IVramEstimateInput,
  values: IConfiguredValues
): IResolvedInputs | IMissingEstimateInput[] {
  const missing: IMissingEstimateInput[] = [];
  const recurrent = isRecurrentArchitecture(input.model.architecture);

  const layerCount = requiredMetadata(input, 'layerCount', missing);
  const embeddingLength = requiredMetadata(input, 'embeddingLength', missing);
  const headCount = recurrent ? (input.model.headCount ?? 0) : requiredMetadata(input, 'headCount', missing);
  const headCountKv = recurrent ? (input.model.headCountKv ?? 0) : requiredMetadata(input, 'headCountKv', missing);

  const ubatchSize = requiredConfiguration(values, LlamaCppField.UBATCH_SIZE, missing);
  const context = resolveContext(input, values, missing);
  const keyElementBytes = cacheTypeBytes(values, LlamaCppField.CACHE_TYPE_K, missing);
  const valueElementBytes = cacheTypeBytes(values, LlamaCppField.CACHE_TYPE_V, missing);
  const kvOffloaded = values.boolean(LlamaCppField.NO_KV_OFFLOAD) !== true;
  const flashAttention = values.text(LlamaCppField.FLASH_ATTN) !== 'off';

  if (
    layerCount === undefined ||
    embeddingLength === undefined ||
    headCount === undefined ||
    headCountKv === undefined ||
    ubatchSize === undefined ||
    context === undefined ||
    keyElementBytes === undefined ||
    valueElementBytes === undefined
  ) {
    return missing;
  }

  const shape = {
    layerCount,
    embeddingLength,
    headCount,
    headCountKv,
    cellsPerSequence: context.cellsPerSequence,
    ubatchSize,
    nextnLoaded: loadsNextn(values),
  };

  return {
    embeddingLength,
    headCount,
    cellsPerSequence: context.cellsPerSequence,
    streams: context.streams,
    ubatchSize,
    keyElementBytes,
    valueElementBytes,
    layers: kvLayers(input.model, shape),
    recurrentLayers: recurrentLayerCount(input.model, shape),
    kvOffloaded,
    flashAttention,
    pipelined: pipelines(input, values, kvOffloaded),
  };
}

/** llama.cpp pads the context, then pads each sequence's share of it. */
function resolveContext(
  input: IVramEstimateInput,
  values: IConfiguredValues,
  missing: IMissingEstimateInput[]
): IContext | undefined {
  const streams = Math.max(values.number(LlamaCppField.PARALLEL) ?? 1, 1);
  const requested = requestedContext(input, values, missing);

  if (requested === undefined) {
    return undefined;
  }

  return { cellsPerSequence: paddedCells(Math.floor(paddedCells(requested) / streams)), streams };
}

/**
 * With context size zero, fit allocates one trained context length per slot before placement decisions.
 * Tensor mode disables fit and shares one trained context length across all slots.
 */
function requestedContext(
  input: IVramEstimateInput,
  values: IConfiguredValues,
  missing: IMissingEstimateInput[]
): number | undefined {
  const contextSize = values.number(LlamaCppField.CONTEXT_SIZE);

  if (contextSize === undefined) {
    missing.push(missingConfiguration(LlamaCppField.CONTEXT_SIZE));

    return undefined;
  }

  if (contextSize > 0) {
    return contextSize;
  }

  const contextLength = requiredMetadata(input, 'contextLength', missing);

  if (values.text(LlamaCppField.SPLIT_MODE) === 'tensor') {
    return contextLength;
  }

  const parallel = requiredConfiguration(values, LlamaCppField.PARALLEL, missing);

  return parallel === undefined || contextLength === undefined ? undefined : contextLength * parallel;
}

function cacheTypeBytes(
  values: IConfiguredValues,
  name: LlamaCppField,
  missing: IMissingEstimateInput[]
): number | undefined {
  const type = values.text(name);
  const bytes = type === undefined ? undefined : CACHE_TYPE_BYTES.get(type);

  if (bytes === undefined) {
    missing.push(missingConfiguration(name));
  }

  return bytes;
}

function requiredMetadata(
  input: IVramEstimateInput,
  field: 'layerCount' | 'embeddingLength' | 'headCount' | 'headCountKv' | 'contextLength',
  missing: IMissingEstimateInput[]
): number | undefined {
  const value = input.model[field];

  if (value === null || value <= 0) {
    missing.push(missingModelMetadata(field));

    return undefined;
  }

  return value;
}

function requiredConfiguration(
  values: IConfiguredValues,
  name: LlamaCppField,
  missing: IMissingEstimateInput[]
): number | undefined {
  const value = values.number(name);

  if (value === undefined) {
    missing.push(missingConfiguration(name));
  }

  return value;
}
