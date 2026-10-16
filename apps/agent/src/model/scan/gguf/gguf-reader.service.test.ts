import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelFormat, ModelTask, ModelType, ProjectorModality } from '@libs/agent-protocol';

import { GgufHeaderParserService } from '@/model/scan/gguf/gguf-header-parser.service';
import { GgufReaderService } from '@/model/scan/gguf/gguf-reader.service';
import { ShardGrouperService } from '@/model/scan/shard-grouper.service';
import { ShardReader } from '@/model/scan/shard-reader';
import { IDirectoryTree } from '@/model/scan/types/directory-tree';
import { IModelSet } from '@/model/scan/types/format-reader';
import { IModelFile } from '@/model/scan/types/model-file';

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);

  bytes.writeUInt32LE(value);

  return bytes;
}

function u64(value: number): Buffer {
  const bytes = Buffer.alloc(8);

  bytes.writeBigUInt64LE(BigInt(value));

  return bytes;
}

function text(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');

  return Buffer.concat([u64(bytes.length), bytes]);
}

const STRING_VALUE = 8;

const F32 = 0;
const Q4_K = 12;
const UNNAMED_TYPE = 5;

const MIB = 1024 * 1024;

function pair(key: string, value: string): Buffer {
  return Buffer.concat([text(key), u32(STRING_VALUE), text(value)]);
}

function architecture(value: string): Buffer {
  return pair('general.architecture', value);
}

function declaredType(value: string): Buffer {
  return pair('general.type', value);
}

function tensor(name: string, parameters: number, type = F32): Buffer {
  return Buffer.concat([text(name), u32(1), u64(parameters), u32(type), u64(0)]);
}

function ggufBytes(pairs: readonly Buffer[], tensors: readonly Buffer[] = []): Buffer {
  return Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(tensors.length),
    u64(pairs.length),
    ...pairs,
    ...tensors,
  ]);
}

function setOf(files: readonly IModelFile[]): IModelSet {
  return {
    format: ModelFormat.GGUF,
    directory: false,
    path: files[0].path,
    files,
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    name: 'weights',
  };
}

function tree(...directories: { path: string; names: string[] }[]): IDirectoryTree {
  return {
    directories: directories.map(directory => ({
      path: directory.path,
      files: directory.names.map(name => ({ path: `${directory.path}/${name}`, sizeBytes: 100 })),
    })),
    errors: [],
  };
}

describe('GgufReaderService', () => {
  const reader = new GgufReaderService(new ShardGrouperService(), new GgufHeaderParserService());

  it('claims the gguf suffix and no other', () => {
    expect(reader.format).toBe(ModelFormat.GGUF);
    expect(reader.suffixes).toEqual(['.gguf']);
  });

  it('keeps two sets sharing a base name in different directories apart', () => {
    const grouping = reader.group(
      tree(
        { path: '/models/a', names: ['llama-70b-00001-of-00002.gguf', 'llama-70b-00002-of-00002.gguf'] },
        { path: '/models/b', names: ['llama-70b-00001-of-00002.gguf', 'llama-70b-00002-of-00002.gguf'] }
      )
    );

    expect(grouping.gaps).toEqual([]);
    expect(grouping.sets.map(set => set.files[0].path)).toEqual([
      '/models/a/llama-70b-00001-of-00002.gguf',
      '/models/b/llama-70b-00001-of-00002.gguf',
    ]);
  });

  it('reports a set split across two directories as gaps rather than as one model', () => {
    const grouping = reader.group(
      tree(
        { path: '/models/a', names: ['llama-00001-of-00002.gguf'] },
        { path: '/models/b', names: ['llama-00002-of-00002.gguf'] }
      )
    );

    expect(grouping.sets).toEqual([]);
    expect(grouping.gaps.map(gap => gap.path)).toEqual(['/models/a/llama', '/models/b/llama']);
  });

  it('claims nothing out of a tree holding no gguf files', () => {
    const grouping = reader.group(tree({ path: '/models', names: [] }));

    expect(grouping).toEqual({ sets: [], gaps: [] });
  });

  describe('the type it reads out of a header', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'gguf-reader-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    const typeOf = async (pairs: readonly Buffer[]): Promise<ModelType> => {
      const path = join(directory, 'weights.gguf');
      const bytes = ggufBytes(pairs);

      await writeFile(path, bytes);

      const files = [{ path, sizeBytes: bytes.length }];
      const stream = new ShardReader(files);

      try {
        const read = await reader.read(stream, setOf(files));

        if (read === null) {
          throw new Error('The reader read nothing out of the header');
        }

        return read.type;
      } finally {
        await stream.close();
      }
    };

    it('reads a model out of a header stating an ordinary architecture', async () => {
      await expect(typeOf([architecture('llama')])).resolves.toBe(ModelType.MODEL);
    });

    it('reads a projector out of the clip architecture, whatever name the file carries', async () => {
      const read = typeOf([architecture('clip'), pair('general.name', 'Qwen3-VL-8B')]);

      await expect(read).resolves.toBe(ModelType.PROJECTOR);
    });

    it('reads a LoRA adapter out of the type it declares, over the architecture of the model it adapts', async () => {
      await expect(typeOf([architecture('llama'), declaredType('adapter')])).resolves.toBe(ModelType.LORA);
    });

    it('reads a marker whatever case it is written in', async () => {
      await expect(typeOf([architecture('CLIP')])).resolves.toBe(ModelType.PROJECTOR);
      await expect(typeOf([architecture('llama'), declaredType('Adapter')])).resolves.toBe(ModelType.LORA);
    });

    it('reads a LoRA adapter out of the type it declares even where the architecture says clip', async () => {
      await expect(typeOf([architecture('clip'), declaredType('adapter')])).resolves.toBe(ModelType.LORA);
    });

    it('reads a model out of a type this agent does not recognise, rather than refusing the file', async () => {
      await expect(typeOf([architecture('llama'), declaredType('reranker')])).resolves.toBe(ModelType.MODEL);
    });

    it('reads a model out of the type a plain model states', async () => {
      await expect(typeOf([architecture('llama'), declaredType('model')])).resolves.toBe(ModelType.MODEL);
    });
  });

  describe('what it reads beside the type', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'gguf-reader-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    const readFixture = async (name: string) => {
      const path = join(directory, `${name}.gguf`);

      await copyFile(resolve(process.cwd(), 'src/model/scan/gguf/fixtures', `${name}.header.gguf`), path);

      const files = [{ path, sizeBytes: (await stat(path)).size }];
      const stream = new ShardReader(files);

      try {
        return await reader.read(stream, setOf(files));
      } finally {
        await stream.close();
      }
    };

    it("reports an audio projector's modalities and licence, and no task", async () => {
      const read = await readFixture('mmproj-Qwen3-ASR-0.6B-Q8_0');

      expect(read?.type).toBe(ModelType.PROJECTOR);
      expect(read?.description).toEqual({
        tasks: [],
        licence: { id: 'apache-2.0', name: null, link: null },
        modalities: [ProjectorModality.AUDIO],
      });
    });

    it('reports no modalities for a model', async () => {
      const read = await readFixture('Qwen3-0.6B-Q8_0');

      expect(read?.description.modalities).toBeNull();
    });

    it('reports the tasks its header states for a model', async () => {
      const read = await readFixture('Qwen3-0.6B-Q8_0');

      expect(read?.description.tasks).toEqual([ModelTask.CHAT]);
    });
  });

  describe('the tensors it records', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'gguf-tensors-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    const shard = async (name: string, bytes: Buffer): Promise<IModelFile> => {
      const path = join(directory, name);

      await writeFile(path, bytes);

      return { path, sizeBytes: bytes.length };
    };

    const tensorsOf = async (files: readonly IModelFile[]): Promise<unknown> => {
      const stream = new ShardReader(files);

      try {
        const read = await reader.read(stream, setOf(files));

        return read?.fields.ggufMetadata?.tensors;
      } finally {
        await stream.close();
      }
    };

    it("lists every shard's tensors, the largest first", async () => {
      const files = [
        await shard(
          'model-00001-of-00002.gguf',
          ggufBytes([architecture('llama')], [tensor('token_embd.weight', 20 * MIB)])
        ),
        await shard('model-00002-of-00002.gguf', ggufBytes([], [tensor('per_layer_token_embd.weight', 40 * MIB)])),
      ];

      await expect(tensorsOf(files)).resolves.toEqual([
        { name: 'per_layer_token_embd.weight', sizeBytes: 160 * MIB },
        { name: 'token_embd.weight', sizeBytes: 80 * MIB },
      ]);
    });

    it('leaves out a tensor under 64 MiB', async () => {
      const tensors = [tensor('token_embd.weight', 16 * MIB), tensor('blk.0.attn_norm.weight', 16 * MIB - 1)];
      const files = [await shard('model.gguf', ggufBytes([architecture('llama')], tensors))];

      await expect(tensorsOf(files)).resolves.toEqual([{ name: 'token_embd.weight', sizeBytes: 64 * MIB }]);
    });

    it('lists none where a shard holds a tensor type it does not know', async () => {
      const files = [
        await shard(
          'model-00001-of-00002.gguf',
          ggufBytes([architecture('llama')], [tensor('token_embd.weight', 20 * MIB)])
        ),
        await shard('model-00002-of-00002.gguf', ggufBytes([], [tensor('output.weight', 20 * MIB, UNNAMED_TYPE)])),
      ];

      await expect(tensorsOf(files)).resolves.toBeNull();
    });

    it("lists none where a later shard's header will not read, and still reports the model", async () => {
      const files = [
        await shard(
          'model-00001-of-00002.gguf',
          ggufBytes([architecture('llama')], [tensor('token_embd.weight', 20 * MIB, Q4_K)])
        ),
        await shard('model-00002-of-00002.gguf', Buffer.from('not a gguf header')),
      ];

      await expect(tensorsOf(files)).resolves.toBeNull();
    });

    it('lists none where a later shard cannot be opened, and still reports the model', async () => {
      const first = await shard('model-00001-of-00002.gguf', ggufBytes([architecture('llama')]));
      const files = [first, { path: join(directory, 'model-00002-of-00002.gguf'), sizeBytes: 1024 }];

      await expect(tensorsOf(files)).resolves.toBeNull();
    });
  });
});
