import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelFormat, ModelTask, ModelType } from '@libs/agent-protocol';

import { GgmlReaderService } from '@/model/scan/ggml/ggml-reader.service';
import { ShardReader } from '@/model/scan/shard-reader';
import { IDirectoryTree } from '@/model/scan/types/directory-tree';
import { IModelSet } from '@/model/scan/types/format-reader';

const FIXTURES = resolve(process.cwd(), 'src/model/scan/ggml/fixtures');

function tree(path: string, ...names: string[]): IDirectoryTree {
  return {
    directories: [{ path, files: names.map(name => ({ path: `${path}/${name}`, sizeBytes: 64 })) }],
    errors: [],
  };
}

describe('GgmlReaderService', () => {
  const reader = new GgmlReaderService();

  it('claims whisper.cpp files by their ggml- prefix, leaving any other .bin alone', () => {
    const grouping = reader.group(tree('/models/whisper', 'ggml-large-v3.bin', 'pytorch_model.bin', 'GGML-tiny.bin'));

    expect(reader.suffixes).toEqual(['.bin']);
    expect(grouping.gaps).toEqual([]);
    expect(grouping.sets).toEqual([
      {
        format: ModelFormat.GGML,
        path: '/models/whisper/ggml-large-v3.bin',
        directory: false,
        files: [{ path: '/models/whisper/ggml-large-v3.bin', sizeBytes: 64 }],
        sizeBytes: 64,
        name: 'ggml-large-v3',
      },
      expect.objectContaining({ path: '/models/whisper/GGML-tiny.bin', name: 'GGML-tiny' }),
    ]);
  });

  describe('read', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'modelfleet-ggml-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    const setOf = (path: string): IModelSet => ({
      format: ModelFormat.GGML,
      path,
      directory: false,
      files: [{ path, sizeBytes: 64 }],
      sizeBytes: 64,
      name: 'model',
    });

    const readFixture = async (name: string): Promise<unknown> => {
      const path = join(directory, name);

      await copyFile(join(FIXTURES, `${name}.header.bin`), path);

      const set = setOf(path);

      return reader.read(new ShardReader(set.files));
    };

    it('reads a Whisper model as transcription', async () => {
      expect(await readFixture('ggml-tiny.en')).toEqual({
        name: null,
        type: ModelType.MODEL,
        fields: {},
        description: { tasks: [ModelTask.TRANSCRIPTION] },
      });
    });

    it("reads large-v3's 128 mel bins as Whisper too", async () => {
      const path = join(directory, 'ggml-large-v3.bin');
      const header = Buffer.alloc(64);

      [0x67676d6c, 51866, 1500, 1280, 20, 32, 448, 1280, 20, 32, 128, 1].forEach((word, index) =>
        header.writeUInt32LE(word, index * 4)
      );
      await writeFile(path, header);

      expect(await reader.read(new ShardReader(setOf(path).files))).toMatchObject({
        description: { tasks: [ModelTask.TRANSCRIPTION] },
      });
    });

    it('refuses a file too short to hold the hyperparameters', async () => {
      const path = join(directory, 'ggml-short.bin');

      await writeFile(path, Buffer.from('lmgg', 'latin1'));

      await expect(reader.read(new ShardReader([{ path, sizeBytes: 4 }]))).rejects.toThrow('ggml magic');
    });

    it('refuses a ggml file that is not Whisper, such as a voice activity model', async () => {
      await expect(readFixture('ggml-silero-v5.1.2')).rejects.toThrow('does not carry Whisper hyperparameters');
    });

    it('refuses a file that does not open with the ggml magic', async () => {
      const path = join(directory, 'ggml-fake.bin');

      await writeFile(path, Buffer.alloc(64, 1));

      await expect(reader.read(new ShardReader(setOf(path).files))).rejects.toThrow('ggml magic');
    });
  });
});
