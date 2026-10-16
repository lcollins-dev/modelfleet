import { Injectable } from '@nestjs/common';

import { GgufMetadata, ModelLicence, ModelTask, ProjectorModality } from '@libs/agent-protocol';
import { GGUF_ARCHITECTURE_TASKS, GGUF_CHAT_TEMPLATE_TASKS, GGUF_POOLING_TYPE_TASKS } from '@libs/backends';

import { GgufCursor, RanOut } from './gguf-cursor';
import { TENSOR_TYPES } from './gguf-tensor-type';
import { FIXED_WIDTHS, GgufValueType } from './gguf-value-type';

export const GGUF_MAGIC = 'GGUF';

/** Version 1 wrote lengths and counts as 32-bit rather than 64. */
const SUPPORTED_VERSIONS: readonly number[] = [2, 3];

/** Every GGUF keeps its norms and biases in F32, thousandths of a percent of the weights and no part of a mix. */
const MIXED_SHARE = 0.01;

export interface IGgufHeader {
  /** `general.name`. */
  name: string | null;

  /** `general.type`, verbatim. `adapter` marks a LoRA adapter. A model states `model` or omits the key. */
  declaredType: string | null;

  /** `general.license`, with its `.name` and `.link` where the file carries them. */
  licence: ModelLicence | null;

  /** What a projector's encoders take in, from `clip.has_vision_encoder` and `clip.has_audio_encoder`. */
  modalities: ProjectorModality[];

  /** Empty where the header says too little. A projector's or adapter's mean nothing. */
  tasks: ModelTask[];

  /** Every field but `tensors`, which the reader gathers across the shards. */
  metadata: Omit<GgufMetadata, 'tensors'>;

  /** Only this shard's, in a sharded set. Null where one has a type this agent lacks. */
  tensors: IGgufTensor[] | null;
}

export interface IGgufTensor {
  name: string;
  type: string;
  parameters: number;
  sizeBytes: number;
}

export interface IGgufHeaderRead {
  ok: true;
  header: IGgufHeader;
}

export interface IGgufHeaderRefused {
  ok: false;
  reason: string;
  /** The bytes given stop inside the header; the same bytes plus more may parse. */
  truncated: boolean;
}

export type GgufHeaderResult = IGgufHeaderRead | IGgufHeaderRefused;

type ScalarValues = Map<string, number | string>;

interface IQuantisation {
  quantisation: string | null;
  quantisationMixed: boolean;
}

@Injectable()
export class GgufHeaderParserService {
  /** Reads the head of a GGUF file. A `truncated` refusal is worth retrying with more of the file. */
  parse(bytes: Buffer): GgufHeaderResult {
    const cursor = new GgufCursor(bytes);

    try {
      if (cursor.magic() !== GGUF_MAGIC) {
        return { ok: false, reason: 'The file does not start with the GGUF magic', truncated: false };
      }

      const version = cursor.uint32();

      if (!SUPPORTED_VERSIONS.includes(version)) {
        return { ok: false, reason: `GGUF version ${String(version)} is not one this agent reads`, truncated: false };
      }

      // The tensor count precedes the pair count, and the tensors themselves follow every pair.
      const tensorCount = cursor.uint64();
      const values = this.readKeyValues(cursor);
      const tensors = this.readTensors(cursor, tensorCount);

      return { ok: true, header: this.headerFrom(values, tensors) };
    } catch (error: unknown) {
      if (error instanceof RanOut) {
        return { ok: false, reason: 'The header runs past the bytes read', truncated: true };
      }

      return { ok: false, reason: 'The header is not readable as GGUF', truncated: false };
    }
  }

  private readKeyValues(cursor: GgufCursor): ScalarValues {
    const count = cursor.uint64();
    const values: ScalarValues = new Map<string, number | string>();

    for (let index = 0; index < count; index += 1) {
      const key = cursor.string();
      const type: GgufValueType = cursor.uint32();
      const value = this.readValue(cursor, type);

      if (value !== null) {
        values.set(key, value);
      }
    }

    return values;
  }

  /** Discards an array, having walked it, and returns null in its place. */
  private readValue(cursor: GgufCursor, type: GgufValueType): number | string | null {
    const fixed = cursor.fixed(type);

    if (fixed !== null) {
      return fixed;
    }

    if (type === GgufValueType.STRING) {
      return cursor.string();
    }

    if (type !== GgufValueType.ARRAY) {
      throw new Error(`A GGUF header holds value type ${String(type)}, which the format does not define`);
    }

    const elementType: GgufValueType = cursor.uint32();
    const count = cursor.uint64();
    const width = FIXED_WIDTHS.get(elementType);

    if (width !== undefined) {
      cursor.skip(width * count);

      return null;
    }

    if (elementType === GgufValueType.STRING) {
      for (let index = 0; index < count; index += 1) {
        cursor.skipString();
      }

      return null;
    }

    for (let index = 0; index < count; index += 1) {
      this.readValue(cursor, elementType);
    }

    return null;
  }

  /** Walks the whole block, leaving the cursor on the tensor data. Null where a tensor names a type this agent lacks. */
  private readTensors(cursor: GgufCursor, count: number): IGgufTensor[] | null {
    const tensors: IGgufTensor[] = [];

    let named = true;

    for (let index = 0; index < count; index += 1) {
      const name = cursor.string();
      const dimensions = cursor.uint32();

      let parameters = 1;

      for (let axis = 0; axis < dimensions; axis += 1) {
        parameters *= cursor.uint64();
      }

      const type = TENSOR_TYPES.get(cursor.uint32());

      cursor.uint64();

      if (type === undefined) {
        named = false;

        continue;
      }

      tensors.push({
        name,
        type: type.name,
        parameters,
        sizeBytes: Math.ceil(parameters / type.blockSize) * type.blockBytes,
      });
    }

    return named ? tensors : null;
  }

  private headerFrom(values: ScalarValues, tensors: IGgufTensor[] | null): IGgufHeader {
    const architecture = this.textAt(values, 'general.architecture');
    const prefixed = (suffix: string): number | null =>
      architecture === null ? null : this.countAt(values, `${architecture}.${suffix}`);

    return {
      name: this.textAt(values, 'general.name'),
      declaredType: this.textAt(values, 'general.type'),
      licence: this.licenceFrom(values),
      modalities: this.modalitiesFrom(values),
      tasks: this.tasksFrom(values, architecture),
      metadata: {
        architecture,
        ...this.quantisationFrom(tensors),
        layerCount: prefixed('block_count'),
        embeddingLength: prefixed('embedding_length'),
        headCount: prefixed('attention.head_count'),
        headCountKv: prefixed('attention.head_count_kv'),
        contextLength: prefixed('context_length'),
      },
      tensors,
    };
  }

  private licenceFrom(values: ScalarValues): ModelLicence | null {
    const id = this.textAt(values, 'general.license');

    if (id === null) {
      return null;
    }

    return { id, name: this.textAt(values, 'general.license.name'), link: this.textAt(values, 'general.license.link') };
  }

  private modalitiesFrom(values: ScalarValues): ProjectorModality[] {
    const modalities: ProjectorModality[] = [];

    if (values.get('clip.has_vision_encoder') === 1) {
      modalities.push(ProjectorModality.VISION);
    }

    if (values.get('clip.has_audio_encoder') === 1) {
      modalities.push(ProjectorModality.AUDIO);
    }

    return modalities;
  }

  /** The order `task-detection.ts` in `@libs/backends` sets. */
  private tasksFrom(values: ScalarValues, architecture: string | null): ModelTask[] {
    const poolingType = architecture === null ? null : this.countAt(values, `${architecture}.pooling_type`);
    const pooled = poolingType === null ? undefined : GGUF_POOLING_TYPE_TASKS.get(poolingType);

    if (pooled !== undefined) {
      return [...pooled];
    }

    const architectural = architecture === null ? undefined : GGUF_ARCHITECTURE_TASKS.get(architecture);

    if (architectural !== undefined) {
      return [...architectural];
    }

    return this.textAt(values, 'tokenizer.chat_template') === null ? [] : [...GGUF_CHAT_TEMPLATE_TASKS];
  }

  private quantisationFrom(tensors: IGgufTensor[] | null): IQuantisation {
    const unknown: IQuantisation = { quantisation: null, quantisationMixed: false };

    if (tensors === null) {
      return unknown;
    }

    const weights = new Map<string, number>();

    for (const tensor of tensors) {
      weights.set(tensor.type, (weights.get(tensor.type) ?? 0) + tensor.parameters);
    }

    const ranked = [...weights].sort((left, right) => right[1] - left[1]);
    const parameters = ranked.reduce((total, [, held]) => total + held, 0);

    if (ranked.length === 0 || parameters === 0) {
      return unknown;
    }

    const shares = ranked.filter(([, held]) => held / parameters >= MIXED_SHARE);

    return { quantisation: ranked[0][0], quantisationMixed: shares.length > 1 };
  }

  private textAt(values: ScalarValues, key: string): string | null {
    const value = values.get(key);

    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private countAt(values: ScalarValues, key: string): number | null {
    const value = values.get(key);

    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  }
}
