import { Injectable } from '@nestjs/common';

import {
  GgufTensor,
  MAX_GGUF_TENSORS,
  MAX_GGUF_TENSOR_NAME_LENGTH,
  ModelFormat,
  ModelType,
} from '@libs/agent-protocol';

import { ShardGrouperService } from '../shard-grouper.service';
import { ShardReader } from '../shard-reader';
import { IDirectoryTree } from '../types/directory-tree';
import { IFormatRead, IModelFormatReader, IModelGap, IModelGrouping, IModelSet } from '../types/format-reader';
import { IModelFile } from '../types/model-file';
import { GgufHeaderParserService, GgufHeaderResult, IGgufHeader, IGgufTensor } from './gguf-header-parser.service';

export const GGUF_SUFFIX = '.gguf';

/** `general.architecture` on a multimodal projector, whatever model the file is named after. */
const PROJECTOR_ARCHITECTURE = 'clip';

/** `general.type` on a LoRA adapter. Its `general.architecture` is the base model's own. */
const LORA_DECLARED_TYPE = 'adapter';

const INITIAL_HEADER_BYTES = 512 * 1024;
const MAX_HEADER_BYTES = 32 * 1024 * 1024;

/** A pattern matching only smaller tensors reduces no estimate, which errs high rather than low. */
const RECORDED_TENSOR_FLOOR_BYTES = 64 * 1024 * 1024;

@Injectable()
export class GgufReaderService implements IModelFormatReader {
  readonly format = ModelFormat.GGUF;
  readonly suffixes = [GGUF_SUFFIX];

  constructor(
    private readonly shardGrouperService: ShardGrouperService,
    private readonly ggufHeaderParserService: GgufHeaderParserService
  ) {}

  group(tree: IDirectoryTree): IModelGrouping {
    const sets: IModelSet[] = [];
    const gaps: IModelGap[] = [];

    // Per directory, so two sets sharing a base name in different directories stay apart.
    for (const directory of tree.directories) {
      const grouping = this.shardGrouperService.group(directory.files, GGUF_SUFFIX);

      sets.push(
        ...grouping.sets.map(set => ({
          format: this.format,
          path: set.files[0].path,
          directory: false,
          files: set.files,
          sizeBytes: set.sizeBytes,
          name: set.name,
        }))
      );

      gaps.push(...grouping.gaps.map(gap => ({ path: gap.path, message: this.shardGrouperService.gapMessage(gap) })));
    }

    return { sets, gaps };
  }

  async read(stream: ShardReader, set: IModelSet): Promise<IFormatRead | null> {
    const [first, ...rest] = await this.readShardHeaders(stream, set.files);

    if (!first.ok) {
      throw new Error(first.reason);
    }

    const type = this.typeOf(first.header);

    return {
      name: first.header.name,
      type,
      fields: { ggufMetadata: { ...first.header.metadata, tensors: this.recordedTensors([first, ...rest]) } },
      description: {
        tasks: type === ModelType.MODEL ? first.header.tasks : [],
        licence: first.header.licence,
        modalities: type === ModelType.PROJECTOR ? first.header.modalities : null,
      },
    };
  }

  /** Each shard opens with a header of its own, listing only the tensors that shard holds. Never throws. */
  private async readShardHeaders(stream: ShardReader, files: readonly IModelFile[]): Promise<GgufHeaderResult[]> {
    const results: GgufHeaderResult[] = [];

    let start = 0;

    for (const file of files) {
      try {
        results.push(await this.readHeader(stream, start, file.sizeBytes));
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : `${file.path} could not be read`;

        results.push({ ok: false, reason, truncated: false });
      }

      start += file.sizeBytes;
    }

    return results;
  }

  private async readHeader(stream: ShardReader, start: number, sizeBytes: number): Promise<GgufHeaderResult> {
    for (let wanted = INITIAL_HEADER_BYTES; wanted <= MAX_HEADER_BYTES; wanted *= 2) {
      const chunks: Buffer[] = [];

      await stream.read(start, Math.min(wanted, sizeBytes), chunk => {
        chunks.push(Buffer.from(chunk));
      });

      const result = this.ggufHeaderParserService.parse(Buffer.concat(chunks));

      if (result.ok || !result.truncated || sizeBytes <= wanted) {
        return result;
      }
    }

    return { ok: false, reason: 'The GGUF header runs past the head this agent reads', truncated: false };
  }

  /** Null where any shard's tensors are unknown. */
  private recordedTensors(results: readonly GgufHeaderResult[]): GgufTensor[] | null {
    const tensors: IGgufTensor[] = [];

    for (const result of results) {
      if (!result.ok || result.header.tensors === null) {
        return null;
      }

      tensors.push(...result.header.tensors);
    }

    return tensors
      .filter(tensor => tensor.sizeBytes >= RECORDED_TENSOR_FLOOR_BYTES)
      .filter(tensor => tensor.name.length > 0 && tensor.name.length <= MAX_GGUF_TENSOR_NAME_LENGTH)
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, MAX_GGUF_TENSORS)
      .map(tensor => ({ name: tensor.name, sizeBytes: tensor.sizeBytes }));
  }

  /** An unrecognised marker reads as a model, so the file is still reported. */
  private typeOf(header: IGgufHeader): ModelType {
    if (header.declaredType?.toLowerCase() === LORA_DECLARED_TYPE) {
      return ModelType.LORA;
    }

    if (header.metadata.architecture?.toLowerCase() === PROJECTOR_ARCHITECTURE) {
      return ModelType.PROJECTOR;
    }

    return ModelType.MODEL;
  }
}
