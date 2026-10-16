import { IConfiguredValues } from '../../configuration';
import { IModelTensor } from '../../runtime/estimate';
import { LlamaCppField } from './declaration';

/** llama.cpp's name for host memory, the one buffer that takes a tensor off the cards. */
const HOST_BUFFER = 'CPU';

/** llama.cpp's `LLM_FFN_EXPS_REGEX`: every expert tensor, leaving the router and any shared expert on the cards. */
const EXPERT_TENSORS = '\\.ffn_(up|down|gate|gate_up)_(ch|)exps';

const ANY_EXPERT = new RegExp(EXPERT_TENSORS);

/** llama.cpp writes one `blk\.<i>` pattern per layer, which never matches a zero-padded number. */
const LAYER_EXPERT = new RegExp(`blk\\.(0|[1-9]\\d*)${EXPERT_TENSORS}`);

/** llama.cpp's input layer, the tables it reads by row. It keeps them in host memory unless an override moves them. */
const LOOKUP_TABLES: ReadonlySet<string> = new Set([
  'token_embd.weight',
  'position_embd.weight',
  'token_types.weight',
  'per_layer_token_embd.weight',
]);

const TOKEN_TABLE = 'token_embd.weight';

/** Where a model has none, llama.cpp reads the token table as its output layer too. */
const OUTPUT_LAYER = 'output.weight';

interface ITensorOverride {
  matches: (name: string) => boolean;
  buffer: string;
}

export interface IHostPlacement {
  /** Needs no VRAM in any load mode. */
  tensors: IModelTensor[];

  /** The share of `tensors` llama.cpp only ever reads by row. */
  readByRow: IModelTensor[];

  /** The token table's second copy, which a model with no output layer loads onto the cards to read as one. */
  cardCopyBytes: number;
}

/**
 * llama.cpp gathers `--cpu-moe`, `--n-cpu-moe` and `--override-tensor` into one list in the order they are passed,
 * which is the declaration's, and places a tensor by the first pattern found anywhere in its name, so a tensor another
 * card claims first stays on it. A lookup table no pattern places stays in host memory. A flag in `extraFlags` is
 * never read.
 */
export function hostPlacement(tensors: readonly IModelTensor[] | null, values: IConfiguredValues): IHostPlacement {
  const overrides = tensorOverrides(values);

  if (tensors === null || overrides === null) {
    return { tensors: [], readByRow: [], cardCopyBytes: 0 };
  }

  const placements = [...expertOverrides(values), ...overrides];
  const bufferOf = (name: string): string | undefined => placements.find(override => override.matches(name))?.buffer;

  const host = tensors.filter(tensor => (bufferOf(tensor.name) ?? defaultBuffer(tensor.name)) === HOST_BUFFER);
  const tokenTable = tensors.find(tensor => tensor.name === TOKEN_TABLE);
  const tied = tensors.every(tensor => tensor.name !== OUTPUT_LAYER);
  const tokenTableBuffer = bufferOf(TOKEN_TABLE);

  /**
   * The output layer's copy follows the token table's overrides, and shares the table where they send both to the CPU.
   * An output layer left off the list reads as missing, which errs high.
   */
  const sharedWithOutput = tied && tokenTableBuffer === HOST_BUFFER;
  const copiedToCards = tied && tokenTableBuffer === undefined;

  return {
    tensors: host,
    readByRow: host.filter(tensor => LOOKUP_TABLES.has(tensor.name) && !(tensor === tokenTable && sharedWithOutput)),
    cardCopyBytes: tokenTable !== undefined && copiedToCards ? tokenTable.sizeBytes : 0,
  };
}

function defaultBuffer(name: string): string | undefined {
  return LOOKUP_TABLES.has(name) ? HOST_BUFFER : undefined;
}

/** One override stands in for the N `--n-cpu-moe` patterns, which sit together and share a buffer. */
function expertOverrides(values: IConfiguredValues): ITensorOverride[] {
  const overrides: ITensorOverride[] = [];

  if (values.boolean(LlamaCppField.CPU_MOE) === true) {
    overrides.push({ matches: name => ANY_EXPERT.test(name), buffer: HOST_BUFFER });
  }

  const layers = values.number(LlamaCppField.CPU_MOE_LAYERS) ?? 0;

  if (layers > 0) {
    overrides.push({ matches: name => expertLayer(name) < layers, buffer: HOST_BUFFER });
  }

  return overrides;
}

function expertLayer(name: string): number {
  const match = LAYER_EXPERT.exec(name);

  return match === null ? Infinity : Number(match[1]);
}

/** Null where any entry will not parse, since llama.cpp then refuses to start and moves nothing. */
function tensorOverrides(values: IConfiguredValues): ITensorOverride[] | null {
  const entries = values.textList(LlamaCppField.TENSOR_OVERRIDES) ?? [];
  const overrides: ITensorOverride[] = [];

  for (const entry of entries.flatMap(written => written.split(','))) {
    const override = parseOverride(entry);

    if (override === null) {
      return null;
    }

    overrides.push(override);
  }

  return overrides;
}

/** Splits on the first `=`, as llama.cpp does. An empty pattern matches every tensor. */
function parseOverride(entry: string): ITensorOverride | null {
  const separator = entry.indexOf('=');

  if (separator < 0) {
    return null;
  }

  try {
    const pattern = new RegExp(entry.slice(0, separator));

    return { matches: name => pattern.test(name), buffer: entry.slice(separator + 1) };
  } catch {
    return null;
  }
}

/** `--cpu-moe` and `--n-cpu-moe` are tensor overrides too, and any override turns off fit and pipelining. */
export function overridesTensors(values: IConfiguredValues): boolean {
  return (
    (values.textList(LlamaCppField.TENSOR_OVERRIDES) ?? []).length > 0 ||
    values.boolean(LlamaCppField.CPU_MOE) === true ||
    (values.number(LlamaCppField.CPU_MOE_LAYERS) ?? 0) > 0
  );
}
