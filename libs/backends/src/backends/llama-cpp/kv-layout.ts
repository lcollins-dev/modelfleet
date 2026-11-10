import { IEstimatedModel } from '../../runtime/estimate';

const PAD_CELLS = 256;

/** llama.cpp's `llm_arch_is_recurrent`: no attention, so no KV cache. */
const RECURRENT_ARCHITECTURES: ReadonlySet<string> = new Set([
  'mamba',
  'mamba2',
  'rwkv6',
  'rwkv6qwen2',
  'rwkv7',
  'arwkv7',
]);

/** llama.cpp's default interval between full-attention layers, for files that do not list their recurrent layers. */
const FULL_ATTENTION_INTERVALS = new Map<string, number>([
  ['qwen3next', 4],
  ['qwen35', 4],
  ['qwen35moe', 4],
  ['qwen4exp', 4],
  ['minimax-01', 8],
]);

interface ISwaDefault {
  pattern: number;
  denseFirst?: boolean;
  window?: number;
}

/** llama.cpp's `load_swa_pattern` defaults when the file supplies no pattern. */
const SWA_DEFAULTS = new Map<string, ISwaDefault>([
  ['gemma2', { pattern: 2, window: 4096 }],
  ['gemma3', { pattern: 6 }],
  ['gemma3n', { pattern: 5 }],
  ['gemma-embedding', { pattern: 6 }],
  ['gemma-embedding2', { pattern: 6 }],
  ['cohere2', { pattern: 4 }],
  ['cohere2moe', { pattern: 4, denseFirst: true }],
  ['olmo2', { pattern: 4 }],
  ['llama4', { pattern: 4, window: 8192 }],
  ['muse-glimmer', { pattern: 4 }],
  ['plamo3', { pattern: 8 }],
  ['smallthinker', { pattern: 4, denseFirst: true }],
  ['modern-bert', { pattern: 3, denseFirst: true }],
  ['gpt-oss', { pattern: 2 }],
  ['afmoe', { pattern: 4 }],
  ['laguna', { pattern: 4, denseFirst: true }],
  ['mellum', { pattern: 4 }],
  ['limite', { pattern: 4 }],
  ['exaone4', { pattern: 4 }],
  ['exaone-moe', { pattern: 4, window: 128 }],
]);

/** llama.cpp builds a separate key cache for these architectures' lightning indexers. */
const INDEXER_ARCHITECTURES: ReadonlySet<string> = new Set(['glm-dsa', 'deepseek32', 'hy_v4']);

/** llama.cpp adds an indexer cache to DeepSeek 4 layers with this compression ratio. */
const DEEPSEEK4_CSA_RATIO = 4;
const DEEPSEEK41 = 'deepseek41';
const DEEPSEEK4_ARCHITECTURES: ReadonlySet<string> = new Set(['deepseek4', DEEPSEEK41]);

/** In tensor mode, llama.cpp copies these architectures' whole KV cache to each GPU rather than dividing it. */
const MIRRORED_KV_ARCHITECTURES: ReadonlySet<string> = new Set([...DEEPSEEK4_ARCHITECTURES, 'hrm_text']);

/** In tensor mode, llama.cpp copies every tensor of this architecture to each GPU, weights included. */
const MIRRORED_WEIGHTS_ARCHITECTURE = 'hrm_text';

export interface IKvLayer {
  /** Per stream. */
  cells: number;

  keyElements: number;
  valueElements: number;

  /** llama.cpp cannot roll a sliding window back, so a slot checkpoints it. */
  window: boolean;

  /** Whole on every GPU in tensor mode, rather than divided between them. */
  mirrored: boolean;
}

export interface IKvShape {
  layerCount: number;
  embeddingLength: number;
  headCount: number;
  headCountKv: number;
  cellsPerSequence: number;
  ubatchSize: number;

  nextnLoaded: boolean;
}

type LayoutModel = Pick<IEstimatedModel, 'architecture' | 'attention'>;

export function paddedCells(cells: number): number {
  return Math.ceil(cells / PAD_CELLS) * PAD_CELLS;
}

export function isRecurrentArchitecture(architecture: string | null): boolean {
  return architecture !== null && RECURRENT_ARCHITECTURES.has(architecture);
}

export function mirrorsWeights(architecture: string | null): boolean {
  return architecture === MIRRORED_WEIGHTS_ARCHITECTURE;
}

export function recurrentLayerCount(model: LayoutModel, shape: IKvShape): number {
  const trunk = trunkLayerCount(model, shape);

  if (isRecurrentArchitecture(model.architecture)) {
    return trunk;
  }

  return Array.from({ length: trunk }, (_, layer) => layer).filter(layer => isRecurrentLayer(model, shape, layer))
    .length;
}

export function kvLayers(model: LayoutModel, shape: IKvShape): IKvLayer[] {
  if (isRecurrentArchitecture(model.architecture)) {
    return [];
  }

  if (model.architecture !== null && DEEPSEEK4_ARCHITECTURES.has(model.architecture)) {
    const ratios = model.attention?.compressRatios;

    if (ratios !== null && ratios !== undefined) {
      return deepSeek4Layers(model, shape, ratios);
    }
  }

  return [...attentionLayers(model, shape), ...indexerLayers(model, shape)];
}

function trunkLayerCount(model: LayoutModel, shape: IKvShape): number {
  const nextn = model.attention?.nextnLayerCount ?? 0;

  return shape.layerCount - (shape.nextnLoaded ? 0 : nextn);
}

function attentionLayers(model: LayoutModel, shape: IKvShape): IKvLayer[] {
  const attention = model.attention;
  const mla = (attention?.keyLengthMla ?? 0) > 0 && (attention?.valueLengthMla ?? 0) > 0;
  const mirrored = model.architecture !== null && MIRRORED_KV_ARCHITECTURES.has(model.architecture);
  const windowCells = slidingWindowCells(model, shape);
  const layers: IKvLayer[] = [];

  for (let layer = 0; layer < trunkLayerCount(model, shape); layer += 1) {
    const headsKv = headCountKvOf(model, shape, layer);

    if (headsKv === 0 || isRecurrentLayer(model, shape, layer)) {
      continue;
    }

    const window = windowCells > 0 && isWindowLayer(model, shape, layer);

    layers.push({
      cells: window ? windowCells : shape.cellsPerSequence,
      keyElements: keyLengthOf(model, shape, window) * headsKv,
      valueElements: mla ? 0 : valueLengthOf(model, shape, window) * headsKv,
      window,
      mirrored,
    });
  }

  return layers;
}

/** Each indexed layer also holds a cache of the indexer's keys, which tensor mode mirrors on every architecture. */
function indexerLayers(model: LayoutModel, shape: IKvShape): IKvLayer[] {
  const keyElements = model.attention?.indexerKeyLength ?? 0;

  if (model.architecture === null || !INDEXER_ARCHITECTURES.has(model.architecture) || keyElements <= 0) {
    return [];
  }

  return Array.from({ length: trunkLayerCount(model, shape) }, () => ({
    cells: shape.cellsPerSequence,
    keyElements,
    valueElements: 0,
    window: false,
    mirrored: true,
  }));
}

/**
 * llama.cpp stores DeepSeek 4 as K-only caches: a raw sliding window on every layer, and a cache compressed by each
 * layer's ratio. The compressor's state planes are left out, at a few MiB per stream.
 */
function deepSeek4Layers(model: LayoutModel, shape: IKvShape, ratios: readonly number[]): IKvLayer[] {
  const isV41 = model.architecture === DEEPSEEK41;
  const windowCells = slidingWindowCells(model, shape);
  const indexerLength = model.attention?.indexerKeyLength ?? 0;
  const layers: IKvLayer[] = [];

  for (let layer = 0; layer < trunkLayerCount(model, shape); layer += 1) {
    const headsKv = headCountKvOf(model, shape, layer);
    const key = keyLengthOf(model, shape, false);

    layers.push({
      cells: windowCells > 0 ? windowCells : shape.cellsPerSequence,
      keyElements: keyLengthOf(model, shape, true) * headsKv,
      valueElements: 0,
      window: true,
      mirrored: true,
    });

    const ratio = ratios[layer] ?? 0;

    if (ratio <= 0) {
      continue;
    }

    const compressedCells = paddedCells(Math.max(Math.ceil(shape.cellsPerSequence / ratio), 1));

    layers.push({
      cells: compressedCells,
      keyElements: isV41 ? key + indexerLength : key * headsKv,
      valueElements: 0,
      window: false,
      mirrored: true,
    });

    if (!isV41 && ratio === DEEPSEEK4_CSA_RATIO && indexerLength > 0) {
      layers.push({
        cells: compressedCells,
        keyElements: indexerLength,
        valueElements: 0,
        window: false,
        mirrored: true,
      });
    }
  }

  return layers;
}

function headCountKvOf(model: LayoutModel, shape: IKvShape, layer: number): number {
  return model.attention?.headCountKvByLayer?.[layer] ?? shape.headCountKv;
}

/** Without a stated length, llama.cpp divides the embedding by the first layer's head count alone. */
function inferredLength(model: LayoutModel, shape: IKvShape): number {
  const firstHeads = model.attention?.headCountByLayer?.[0] ?? shape.headCount;

  return firstHeads > 0 ? Math.floor(shape.embeddingLength / firstHeads) : 0;
}

function keyLengthOf(model: LayoutModel, shape: IKvShape, window: boolean): number {
  const full = model.attention?.keyLength ?? inferredLength(model, shape);

  return window ? (model.attention?.keyLengthSwa ?? full) : full;
}

function valueLengthOf(model: LayoutModel, shape: IKvShape, window: boolean): number {
  const full = model.attention?.valueLength ?? inferredLength(model, shape);

  return window ? (model.attention?.valueLengthSwa ?? full) : full;
}

function slidingWindowCells(model: LayoutModel, shape: IKvShape): number {
  const window = model.attention?.slidingWindow ?? swaDefaultOf(model)?.window ?? 0;

  return window > 0 ? paddedCells(Math.min(shape.cellsPerSequence, window + shape.ubatchSize)) : 0;
}

function swaDefaultOf(model: LayoutModel): ISwaDefault | undefined {
  return model.architecture === null ? undefined : SWA_DEFAULTS.get(model.architecture);
}

function isWindowLayer(model: LayoutModel, shape: IKvShape, layer: number): boolean {
  const stated = model.attention?.slidingWindowPattern;

  if (Array.isArray(stated)) {
    return (stated[layer] ?? 0) !== 0;
  }

  const fallback = swaDefaultOf(model);
  const pattern = typeof stated === 'number' ? stated : fallback?.pattern;

  if (pattern === undefined || layer >= trunkLayerCount(model, shape)) {
    return false;
  }

  if (pattern === 0) {
    return true;
  }

  return fallback?.denseFirst === true ? layer % pattern !== 0 : layer % pattern < pattern - 1;
}

function isRecurrentLayer(model: LayoutModel, shape: IKvShape, layer: number): boolean {
  const listed = model.attention?.recurrentLayers;

  if (listed !== null && listed !== undefined) {
    return (listed[layer] ?? 0) !== 0;
  }

  const interval =
    model.attention?.fullAttentionInterval ??
    (model.architecture === null ? undefined : FULL_ATTENTION_INTERVALS.get(model.architecture));

  return interval !== undefined && interval > 0 && layer < shape.layerCount && (layer + 1) % interval !== 0;
}
