import { Injectable } from '@nestjs/common';
import { basename } from 'node:path';

import { ModelFormat, ModelTask, ModelType } from '@libs/agent-protocol';

import { ShardReader } from '../shard-reader';
import { IDirectoryTree } from '../types/directory-tree';
import { IFormatRead, IModelFormatReader, IModelGrouping, IModelSet } from '../types/format-reader';

export const GGML_SUFFIX = '.bin';

/** whisper.cpp's own naming. A bare `.bin` would also claim every `pytorch_model.bin`. */
const GGML_PREFIX = 'ggml-';

const GGML_MAGIC = 0x67676d6c;

/** The magic, then Whisper's eleven 32-bit hyperparameters, `n_vocab` through `ftype`. */
const HEADER_BYTES = 4 + 11 * 4;

const N_VOCAB = 0;
const N_AUDIO_LAYER = 4;
const N_TEXT_LAYER = 8;
const N_MELS = 9;

/** Whisper's log-mel inputs: 80 bins, and 128 from large-v3 on. */
const WHISPER_MEL_BINS = new Set([80, 128]);

@Injectable()
export class GgmlReaderService implements IModelFormatReader {
  readonly format = ModelFormat.GGML;
  readonly suffixes = [GGML_SUFFIX];

  group(tree: IDirectoryTree): IModelGrouping {
    const sets: IModelSet[] = tree.directories.flatMap(directory =>
      directory.files
        .filter(file => basename(file.path).toLowerCase().startsWith(GGML_PREFIX))
        .map(file => ({
          format: this.format,
          path: file.path,
          directory: false,
          files: [file],
          sizeBytes: file.sizeBytes,
          name: basename(file.path).slice(0, -GGML_SUFFIX.length),
        }))
    );

    return { sets, gaps: [] };
  }

  async read(stream: ShardReader): Promise<IFormatRead | null> {
    const chunks: Buffer[] = [];

    await stream.read(0, HEADER_BYTES, chunk => {
      chunks.push(Buffer.from(chunk));
    });

    const header = Buffer.concat(chunks);

    if (header.length < HEADER_BYTES || header.readUInt32LE(0) !== GGML_MAGIC) {
      throw new Error('The file does not open with the ggml magic');
    }

    if (!this.isWhisper(header)) {
      throw new Error('The ggml file does not carry Whisper hyperparameters, such as a voice activity model does');
    }

    return {
      name: null,
      type: ModelType.MODEL,
      fields: {},
      description: { tasks: [ModelTask.TRANSCRIPTION] },
    };
  }

  private isWhisper(header: Buffer): boolean {
    const parameter = (index: number): number => header.readInt32LE(4 + index * 4);

    return (
      parameter(N_VOCAB) > 0 &&
      parameter(N_AUDIO_LAYER) > 0 &&
      parameter(N_TEXT_LAYER) > 0 &&
      WHISPER_MEL_BINS.has(parameter(N_MELS))
    );
  }
}
