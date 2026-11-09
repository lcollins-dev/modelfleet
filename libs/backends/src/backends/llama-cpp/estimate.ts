import { IConfiguredValues } from '../../configuration';
import {
  IMissingEstimateInput,
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
import { IHostPlacement, hostPlacement, overridesTensors } from './override-tensor';

const MIB = 1024 * 1024;

/** cuBLAS handles, the CUDA context and allocator slack, which llama.cpp takes on each device it holds. */
const RUNTIME_BYTES_PER_DEVICE = 384 * MIB;

/** Fitted to llama.cpp's compute buffer, so coarse. A measured high-water mark replaces it once an instance has run. */
const COMPUTE_BYTES_PER_BATCHED_ELEMENT = 64;

/** `GGML_SCHED_MAX_COPIES`, the build default: each card holds this many copies of its inputs when pipelined. */
const PIPELINE_COPIES = 4;

/** The attention mask is f16 under flash attention and f32 without. */
const FLASH_MASK_BYTES = 2;
const MASK_BYTES = 4;

/** Unset is `auto`, which maps the file wherever the devices support it. */
const MAPPED_LOAD_MODES = new Set(['auto', 'mmap']);

/** Its lock grows from the start of the file, so it can catch a lazy table, and the tensor list holds no offsets to tell. */
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
const DRAFT_KV_BYTES_PER_ELEMENT = 4;

/** Matches llama.cpp's `--cache-ram` default, since an unset field passes no flag. */
const DEFAULT_PROMPT_CACHE_MIB = 8192;

/** In tensor mode, llama.cpp copies the full KV cache to each GPU for these architectures. */
const MIRRORED_KV_ARCHITECTURES: ReadonlySet<string> = new Set(['deepseek4', 'deepseek41', 'hrm_text']);

interface IResolvedInputs {
  layerCount: number;
  embeddingLength: number;
  headCount: number;
  headCountKv: number;
  totalContext: number;
  ubatchSize: number;

  /** One key element plus one value element, since the two caches hold the same number of each. */
  kvBytesPerElement: number;

  kvOffloaded: boolean;
  flashAttention: boolean;

  pipelined: boolean;
}

export function llamaCppVramEstimate(input: IVramEstimateInput, values: IConfiguredValues): IVramEstimate {
  const resolved = resolveInputs(input, values);

  return Array.isArray(resolved)
    ? unavailableEstimate(resolved, promptCacheBytes(values))
    : estimateFrom(input, values, resolved);
}

function estimateFrom(input: IVramEstimateInput, values: IConfiguredValues, resolved: IResolvedInputs): IVramEstimate {
  const draft = draftInputs(input, values, resolved);
  const placement = hostPlacement(input.model, values);
  const hostWeightsBytes = sizeOf(placement.tensors);
  const companions = weightsEstimate({
    bytes: input.companions.reduce((total, companion) => total + companion.sizeBytes, 0),
    factor: 1,
    overheadBytesPerDevice: 0,
    deviceCount: input.deviceCount,
  });

  return computedEstimate({
    basis: EstimateBasis.METADATA,
    weightsBytes: input.model.sizeBytes - hostWeightsBytes + placement.cardCopyBytes + companions.weightsBytes,
    kvCacheBytes: kvCacheBytes(resolved) * kvCopies(input, values) + (draft === null ? 0 : kvCacheBytes(draft)),
    overheadBytes: overheadBytes(input, values, resolved, draft),
    hostWeightsBytes,
    hostResidentBytes: sizeOf(residentTensors(placement, values)),
    hostCacheBytes: promptCacheBytes(values),
  });
}

export function mirroredKvBytes(input: IVramEstimateInput, values: IConfiguredValues): number {
  const copies = kvCopies(input, values);
  const resolved = resolveInputs(input, values);

  return copies === 1 || Array.isArray(resolved) ? 0 : kvCacheBytes(resolved) * copies;
}

function kvCopies(input: IVramEstimateInput, values: IConfiguredValues): number {
  const architecture = input.model.architecture;
  const mirrored =
    values.text(LlamaCppField.SPLIT_MODE) === 'tensor' &&
    architecture !== null &&
    MIRRORED_KV_ARCHITECTURES.has(architecture);

  return mirrored ? input.deviceCount : 1;
}

function promptCacheBytes(values: IConfiguredValues): number {
  return (values.number(LlamaCppField.PROMPT_CACHE) ?? DEFAULT_PROMPT_CACHE_MIB) * MIB;
}

/**
 * A table read only by row from a mapped file costs only the few rows each token pages in, and those pages are reclaimable. Every
 * other tensor is read whole each time its layer runs, so it holds its full size. A load mode that reads or locks the
 * file holds every tensor in full, except a lazy table, which stays on a mapping of its own under any of them.
 */
function residentTensors(placement: IHostPlacement, values: IConfiguredValues): IModelTensor[] {
  const loadMode = values.text(LlamaCppField.LOAD_MODE) ?? 'auto';

  if (loadMode === LOCKED_MAPPED_LOAD_MODE) {
    return placement.tensors;
  }

  const unheld = MAPPED_LOAD_MODES.has(loadMode) ? placement.readByRow : placement.lazy;

  return placement.tensors.filter(tensor => !unheld.includes(tensor));
}

function sizeOf(tensors: IModelTensor[]): number {
  return tensors.reduce((total, tensor) => total + tensor.sizeBytes, 0);
}

function kvCacheBytes(resolved: IResolvedInputs): number {
  if (!resolved.kvOffloaded) {
    return 0;
  }

  const kvWidth = (resolved.embeddingLength / resolved.headCount) * resolved.headCountKv;

  return Math.round(resolved.totalContext * resolved.layerCount * kvWidth * resolved.kvBytesPerElement);
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
  const tokens = Math.min(resolved.totalContext, resolved.ubatchSize);
  const maskBytes = resolved.flashAttention ? FLASH_MASK_BYTES : MASK_BYTES;
  const mask = resolved.kvOffloaded ? resolved.totalContext * tokens * maskBytes : 0;
  const copies = resolved.pipelined ? PIPELINE_COPIES : 1;
  const activations = resolved.ubatchSize * resolved.embeddingLength * COMPUTE_BYTES_PER_BATCHED_ELEMENT;

  return copies * mask + activations;
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
    layerCount,
    embeddingLength,
    headCount,
    headCountKv,
    kvBytesPerElement: DRAFT_KV_BYTES_PER_ELEMENT,
    pipelined: splitsAcrossCards(input, values, resolved.kvOffloaded),
  };
}

function resolveInputs(
  input: IVramEstimateInput,
  values: IConfiguredValues
): IResolvedInputs | IMissingEstimateInput[] {
  const missing: IMissingEstimateInput[] = [];

  const layerCount = requiredMetadata(input, 'layerCount', missing);
  const embeddingLength = requiredMetadata(input, 'embeddingLength', missing);
  const headCount = requiredMetadata(input, 'headCount', missing);
  const headCountKv = requiredMetadata(input, 'headCountKv', missing);

  const ubatchSize = requiredConfiguration(values, LlamaCppField.UBATCH_SIZE, missing);
  const totalContext = resolveTotalContext(input, values, missing);
  const kvBytesPerElement = resolveKvBytes(values, missing);
  const kvOffloaded = values.boolean(LlamaCppField.NO_KV_OFFLOAD) !== true;
  const flashAttention = values.text(LlamaCppField.FLASH_ATTN) !== 'off';

  if (
    layerCount === undefined ||
    embeddingLength === undefined ||
    headCount === undefined ||
    headCountKv === undefined ||
    ubatchSize === undefined ||
    totalContext === undefined ||
    kvBytesPerElement === undefined
  ) {
    return missing;
  }

  return {
    layerCount,
    embeddingLength,
    headCount,
    headCountKv,
    totalContext,
    ubatchSize,
    kvBytesPerElement,
    kvOffloaded,
    flashAttention,
    pipelined: pipelines(input, values, kvOffloaded),
  };
}

/** A context of zero takes the model's own trained length for each slot, so the pool is that length per slot. */
function resolveTotalContext(
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

  const parallel = requiredConfiguration(values, LlamaCppField.PARALLEL, missing);
  const contextLength = requiredMetadata(input, 'contextLength', missing);

  return parallel === undefined || contextLength === undefined ? undefined : contextLength * parallel;
}

function resolveKvBytes(values: IConfiguredValues, missing: IMissingEstimateInput[]): number | undefined {
  const key = cacheTypeBytes(values, LlamaCppField.CACHE_TYPE_K, missing);
  const value = cacheTypeBytes(values, LlamaCppField.CACHE_TYPE_V, missing);

  return key === undefined || value === undefined ? undefined : key + value;
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
