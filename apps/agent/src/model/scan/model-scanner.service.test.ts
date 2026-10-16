import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ModelFormat,
  ModelScanErrorScope,
  ModelTask,
  ModelType,
  agentModelInventorySchema,
  MAX_DTYPE_LENGTH,
} from '@libs/agent-protocol';

import { DirectoryWalkerService } from '@/model/scan/directory-walker.service';
import { GgmlReaderService } from '@/model/scan/ggml/ggml-reader.service';
import { GgufHeaderParserService } from '@/model/scan/gguf/gguf-header-parser.service';
import { GgufReaderService } from '@/model/scan/gguf/gguf-reader.service';
import { ModelFingerprintService } from '@/model/scan/model-fingerprint.service';
import { ModelScannerService } from '@/model/scan/model-scanner.service';
import { PytorchReaderService } from '@/model/scan/pytorch/pytorch-reader.service';
import { RepositoryMetadataService } from '@/model/scan/repository-metadata.service';
import { SafetensorsHeaderParserService } from '@/model/scan/safetensors/safetensors-header-parser.service';
import { SafetensorsReaderService } from '@/model/scan/safetensors/safetensors-reader.service';
import { ShardGrouperService } from '@/model/scan/shard-grouper.service';

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

interface IGgufOptions {
  name?: string;
  sizeBytes?: number;
  tensorParameters?: number[];
}

function stringPair(key: string, value: string): Buffer {
  return Buffer.concat([text(key), u32(8), text(value)]);
}

/** A GGUF file naming one architecture and one layer count, padded out to `sizeBytes`. */
function ggufBytes(architecture: string, layerCount: number, options: IGgufOptions = {}): Buffer {
  const pairs = [
    stringPair('general.architecture', architecture),
    Buffer.concat([text(`${architecture}.block_count`), u32(4), u32(layerCount)]),
  ];

  if (options.name !== undefined) {
    pairs.push(stringPair('general.name', options.name));
  }

  const tensors = (options.tensorParameters ?? []).map((parameters, index) =>
    Buffer.concat([text(`blk.${String(index)}.ffn_up.weight`), u32(1), u64(parameters), u32(0), u64(0)])
  );

  const header = Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(tensors.length),
    u64(pairs.length),
    ...pairs,
    ...tensors,
  ]);

  return Buffer.concat([header, Buffer.alloc(Math.max(0, (options.sizeBytes ?? 4096) - header.length), 7)]);
}

function safetensorsBytes(sizeBytes = 4096, dtype = 'BF16'): Buffer {
  const tensors: Record<string, unknown> = {};

  tensors['model.embed.weight'] = { dtype, shape: [64, 32] };

  const json = Buffer.from(JSON.stringify(tensors), 'utf8');
  const length = Buffer.alloc(8);

  length.writeBigUInt64LE(BigInt(json.length));

  const header = Buffer.concat([length, json]);

  return Buffer.concat([header, Buffer.alloc(Math.max(0, sizeBytes - header.length), 5)]);
}

/** whisper.cpp's magic and tiny.en's hyperparameters. */
function ggmlBytes(sizeBytes = 4096): Buffer {
  const header = Buffer.concat([0x67676d6c, 51864, 1500, 384, 6, 4, 448, 384, 6, 4, 80, 1].map(u32));

  return Buffer.concat([header, Buffer.alloc(sizeBytes - header.length, 3)]);
}

describe('ModelScannerService', () => {
  let directory: string;
  let scanner: ModelScannerService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'modelfleet-scan-'));
    const shardGrouperService = new ShardGrouperService();

    scanner = new ModelScannerService(
      [
        new GgufReaderService(shardGrouperService, new GgufHeaderParserService()),
        new SafetensorsReaderService(
          shardGrouperService,
          new SafetensorsHeaderParserService(),
          new RepositoryMetadataService()
        ),
        new GgmlReaderService(),
        new PytorchReaderService(new RepositoryMetadataService()),
      ],
      new DirectoryWalkerService(),
      new ModelFingerprintService()
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reports each model it finds with its size, format and parsed metadata', async () => {
    await writeFile(join(directory, 'llama.gguf'), ggufBytes('llama', 32));

    const inventory = await scanner.scan([directory]);

    expect(inventory.directories).toEqual([directory]);
    expect(inventory.errors).toEqual([]);
    expect(inventory.models).toHaveLength(1);
    expect(inventory.models[0]).toMatchObject({
      format: ModelFormat.GGUF,
      sizeBytes: 4096,
      path: join(directory, 'llama.gguf'),
      shardCount: 1,
      name: 'llama',
      ggufMetadata: { architecture: 'llama', layerCount: 32 },
    });
    expect(inventory.models[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a shard set as one model, sized as the sum, at the first shard', async () => {
    await writeFile(join(directory, 'qwen-00001-of-00002.gguf'), ggufBytes('qwen3', 48));
    await writeFile(join(directory, 'qwen-00002-of-00002.gguf'), Buffer.alloc(1024, 9));

    const inventory = await scanner.scan([directory]);

    expect(inventory.errors).toEqual([]);
    expect(inventory.models).toHaveLength(1);
    expect(inventory.models[0]).toMatchObject({
      sizeBytes: 5120,
      path: join(directory, 'qwen-00001-of-00002.gguf'),
      shardCount: 2,
      name: 'qwen',
      ggufMetadata: { architecture: 'qwen3', layerCount: 48 },
    });
  });

  it('names a model from its header where the file carries one', async () => {
    await writeFile(join(directory, 'llama.gguf'), ggufBytes('llama', 32, { name: 'Llama 3 8B Instruct' }));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models[0].name).toBe('Llama 3 8B Instruct');
  });

  it('falls back to the file own name where the header names nothing', async () => {
    await writeFile(join(directory, 'llama-3-8b-instruct.gguf'), ggufBytes('llama', 32));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models[0].name).toBe('llama-3-8b-instruct');
  });

  it('leaves the shard numbering out of a fallback name', async () => {
    await writeFile(join(directory, 'mixtral-8x7b-00001-of-00002.gguf'), ggufBytes('llama', 32));
    await writeFile(join(directory, 'mixtral-8x7b-00002-of-00002.gguf'), Buffer.alloc(512, 9));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models[0].name).toBe('mixtral-8x7b');
  });

  it('leaves a shard set missing a member out and reports the gap', async () => {
    await writeFile(join(directory, 'qwen-00001-of-00003.gguf'), ggufBytes('qwen3', 48));
    await writeFile(join(directory, 'qwen-00003-of-00003.gguf'), ggufBytes('qwen3', 48));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models).toEqual([]);
    expect(inventory.errors).toHaveLength(1);
    expect(inventory.errors[0].scope).toBe(ModelScanErrorScope.MODEL_SET);
    expect(inventory.errors[0].message).toContain('missing shard 2 of 3');
  });

  it('gives the same weights at two paths one fingerprint and reports them once', async () => {
    const bytes = ggufBytes('llama', 32);

    await writeFile(join(directory, 'a.gguf'), bytes);
    await writeFile(join(directory, 'b.gguf'), bytes);

    const inventory = await scanner.scan([directory]);

    expect(inventory.models).toHaveLength(1);
    expect(inventory.models[0].path).toBe(join(directory, 'a.gguf'));
  });

  it('keeps two models apart that share a size and a quantisation', async () => {
    await writeFile(join(directory, 'a.gguf'), ggufBytes('llama', 32));
    await writeFile(join(directory, 'b.gguf'), ggufBytes('llama', 33));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models).toHaveLength(2);
    expect(inventory.models[0].fingerprint).not.toBe(inventory.models[1].fingerprint);
  });

  it('reports a file that is not GGUF as an error and keeps the rest', async () => {
    await writeFile(join(directory, 'good.gguf'), ggufBytes('llama', 32));
    await writeFile(join(directory, 'bad.gguf'), Buffer.alloc(512, 3));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models.map(model => model.path)).toEqual([join(directory, 'good.gguf')]);
    expect(inventory.errors[0].scope).toBe(ModelScanErrorScope.MODEL);
    expect(inventory.errors[0].path).toBe(join(directory, 'bad.gguf'));
  });

  it('reports a directory it cannot read against the node', async () => {
    const inventory = await scanner.scan([join(directory, 'absent')]);

    expect(inventory.models).toEqual([]);
    expect(inventory.errors[0].scope).toBe(ModelScanErrorScope.DIRECTORY);
  });

  it('covers every directory it is handed', async () => {
    const other = await mkdtemp(join(tmpdir(), 'modelfleet-scan-'));

    await writeFile(join(directory, 'llama.gguf'), ggufBytes('llama', 32));
    await writeFile(join(other, 'qwen.gguf'), ggufBytes('qwen3', 48));

    try {
      const inventory = await scanner.scan([directory, other]);

      expect(inventory.models).toHaveLength(2);
      expect(inventory.directories).toEqual([directory, other]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("reports a safetensors directory as one model, at the directory, with its config's model type", async () => {
    await mkdir(join(directory, 'llama-3-8b'));
    await writeFile(join(directory, 'llama-3-8b', 'config.json'), '{"model_type":"llama"}');
    await writeFile(join(directory, 'llama-3-8b', 'model.safetensors'), safetensorsBytes());

    const inventory = await scanner.scan([directory]);

    expect(inventory.errors).toEqual([]);
    expect(inventory.models).toHaveLength(1);
    expect(inventory.models[0]).toMatchObject({
      format: ModelFormat.SAFETENSORS,
      type: ModelType.MODEL,
      path: join(directory, 'llama-3-8b'),
      name: 'llama-3-8b',
      ggufMetadata: null,
      safetensorsMetadata: { dtype: 'BF16', tensorCount: 1, parameterCount: 2048, architecture: 'llama' },
    });
  });

  it("reads a repository's task and licence from its model card", async () => {
    const whisper = join(directory, 'whisper-large-v3-turbo');

    await mkdir(whisper);
    await writeFile(join(whisper, 'README.md'), '---\nlicense: mit\npipeline_tag: automatic-speech-recognition\n---\n');
    await writeFile(join(whisper, 'config.json'), '{"architectures":["WhisperForConditionalGeneration"]}');
    await writeFile(join(whisper, 'model.safetensors'), safetensorsBytes());

    const inventory = await scanner.scan([directory]);

    expect(inventory.models[0]).toMatchObject({
      tasks: [ModelTask.TRANSCRIPTION],
      licence: { id: 'mit', name: null, link: null },
      modalities: null,
    });
  });

  it('drops a licence string past the protocol cap, so the node still reports its inventory', async () => {
    const repository = join(directory, 'tts');

    await mkdir(repository);
    await writeFile(
      join(repository, 'README.md'),
      `---\nlicense: other\nlicense_name: custom\nlicense_link: https://example.com/${'x'.repeat(2000)}\n---\n`
    );
    await writeFile(join(repository, 'config.json'), '{}');
    await writeFile(join(repository, 'model.safetensors'), safetensorsBytes());

    const inventory = await scanner.scan([directory]);

    expect(inventory.models[0].licence).toEqual({ id: 'other', name: 'custom', link: null });
    expect(agentModelInventorySchema.safeParse(inventory).success).toBe(true);
  });

  it('drops a header string past the protocol cap, so the node still reports its inventory', async () => {
    const repository = join(directory, 'odd');

    await mkdir(repository);
    await writeFile(join(repository, 'config.json'), '{}');
    await writeFile(join(repository, 'model.safetensors'), safetensorsBytes(4096, 'F'.repeat(MAX_DTYPE_LENGTH + 1)));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models[0].safetensorsMetadata?.dtype).toBeNull();
    expect(agentModelInventorySchema.safeParse(inventory).success).toBe(true);
  });

  it('reports a gguf model whose header states no task with none', async () => {
    await writeFile(join(directory, 'llama.gguf'), ggufBytes('llama', 32));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models[0]).toMatchObject({ tasks: [], licence: null, modalities: null });
  });

  it('reports a repository with a nested model as one model, fingerprinted as it was and sized whole', async () => {
    const voxtral = join(directory, 'voxtral');

    await mkdir(voxtral);
    await writeFile(join(voxtral, 'config.json'), '{}');
    await writeFile(join(voxtral, 'model.safetensors'), safetensorsBytes());

    const [before] = (await scanner.scan([directory])).models;

    await mkdir(join(voxtral, 'codec'));
    await writeFile(join(voxtral, 'codec', 'config.json'), '{}');
    await writeFile(join(voxtral, 'codec', 'codec.safetensors'), safetensorsBytes(2048));

    const inventory = await scanner.scan([directory]);

    expect(inventory.errors).toEqual([]);
    expect(inventory.models).toHaveLength(1);
    expect(inventory.models[0]).toMatchObject({
      fingerprint: before.fingerprint,
      path: voxtral,
      sizeBytes: 4096 + 2048,
      shardCount: 1,
    });
  });

  it('reports a whisper.cpp model and a Kokoro checkpoint with their tasks, passing over a PyTorch .bin', async () => {
    const kokoro = join(directory, 'Kokoro-82M');

    await writeFile(join(directory, 'ggml-tiny.en.bin'), ggmlBytes());
    await writeFile(join(directory, 'pytorch_model.bin'), Buffer.alloc(4096, 9));
    await mkdir(kokoro);
    await writeFile(join(kokoro, 'README.md'), '---\nlicense: apache-2.0\npipeline_tag: text-to-speech\n---\n');
    await writeFile(join(kokoro, 'config.json'), '{"istftnet":{},"plbert":{}}');
    await writeFile(join(kokoro, 'kokoro-v1_0.pth'), Buffer.alloc(4096, 4));

    const inventory = await scanner.scan([directory]);

    expect(inventory.errors).toEqual([]);
    expect(inventory.models).toEqual([
      expect.objectContaining({
        format: ModelFormat.GGML,
        path: join(directory, 'ggml-tiny.en.bin'),
        name: 'ggml-tiny.en',
        tasks: [ModelTask.TRANSCRIPTION],
        ggufMetadata: null,
        safetensorsMetadata: null,
      }),
      expect.objectContaining({
        format: ModelFormat.PYTORCH,
        path: kokoro,
        name: 'Kokoro-82M',
        tasks: [ModelTask.SPEECH],
        licence: { id: 'apache-2.0', name: null, link: null },
        ggufMetadata: null,
        safetensorsMetadata: null,
      }),
    ]);
  });

  it('reports models of both formats out of one sweep, each with its own block', async () => {
    await writeFile(join(directory, 'llama.gguf'), ggufBytes('llama', 32));
    await writeFile(join(directory, 'mistral.safetensors'), safetensorsBytes());

    const inventory = await scanner.scan([directory]);

    expect(inventory.errors).toEqual([]);
    expect(inventory.models.map(model => model.format)).toEqual([ModelFormat.GGUF, ModelFormat.SAFETENSORS]);
    expect(inventory.models[0].safetensorsMetadata).toBeNull();
    expect(inventory.models[1].ggufMetadata).toBeNull();
  });

  it('fingerprints the same tensor bytes alike whatever format claimed them', async () => {
    await writeFile(join(directory, 'loose.safetensors'), safetensorsBytes());
    await mkdir(join(directory, 'packaged'));
    await writeFile(join(directory, 'packaged', 'config.json'), '{}');
    await writeFile(join(directory, 'packaged', 'model.safetensors'), safetensorsBytes());

    const inventory = await scanner.scan([directory]);

    expect(inventory.models).toHaveLength(1);
  });

  it('reports a vision model and its projector as two entries, each carrying its own type', async () => {
    await writeFile(join(directory, 'Qwen3-VL-8B-Q8_0.gguf'), ggufBytes('qwen3vl', 36));
    await writeFile(join(directory, 'mmproj-F32.gguf'), ggufBytes('clip', 24));

    const inventory = await scanner.scan([directory]);

    expect(inventory.errors).toEqual([]);
    expect(inventory.models.map(model => [model.path, model.type])).toEqual([
      [join(directory, 'mmproj-F32.gguf'), ModelType.PROJECTOR],
      [join(directory, 'Qwen3-VL-8B-Q8_0.gguf'), ModelType.MODEL],
    ]);
    expect(inventory.models[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the node's largest tensors where its models list more than one inventory holds", async () => {
    const mib = 1024 * 1024;
    const listed = (parameters: number): number[] => new Array<number>(1000).fill(parameters);

    await writeFile(join(directory, 'a.gguf'), ggufBytes('llama', 32, { tensorParameters: listed(30 * mib) }));
    await writeFile(join(directory, 'b.gguf'), ggufBytes('llama', 32, { tensorParameters: listed(20 * mib) }));
    await writeFile(join(directory, 'c.gguf'), ggufBytes('llama', 32, { tensorParameters: listed(17 * mib) }));

    const inventory = await scanner.scan([directory]);

    expect(inventory.models.map(model => model.ggufMetadata?.tensors?.length)).toEqual([1000, 1000, 48]);
  });

  it('reports an empty set for no directories at all', async () => {
    const inventory = await scanner.scan([]);

    expect(inventory).toMatchObject({ directories: [], models: [], errors: [] });
  });
});
