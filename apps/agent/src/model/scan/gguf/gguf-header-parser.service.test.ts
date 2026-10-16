import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ModelTask, ProjectorModality } from '@libs/agent-protocol';

import { GgufHeaderParserService, IGgufHeader } from '@/model/scan/gguf/gguf-header-parser.service';

const STRING = 8;
const UINT32 = 4;
const ARRAY = 9;
const BOOL = 7;

const F32 = 0;
const Q5_0 = 6;
const Q4_K = 12;
const Q6_K = 14;
const UNNAMED_TYPE = 5;

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

function pair(key: string, type: number, value: Buffer): Buffer {
  return Buffer.concat([text(key), u32(type), value]);
}

function tensor(name: string, weights: number, type: number): Buffer {
  return Buffer.concat([text(name), u32(1), u64(weights), u32(type), u64(0)]);
}

function gguf(pairs: Buffer[], tensors: Buffer[] = [], version = 3): Buffer {
  return Buffer.concat([
    Buffer.from('GGUF', 'ascii'),
    u32(version),
    u64(tensors.length),
    u64(pairs.length),
    ...pairs,
    ...tensors,
  ]);
}

/** The head of a published file, trimmed as `fixtures/README.md` describes. */
function fixture(name: string): Buffer {
  return readFileSync(resolve(process.cwd(), 'src/model/scan/gguf/fixtures', `${name}.header.gguf`));
}

function headerOf(bytes: Buffer): IGgufHeader {
  const result = new GgufHeaderParserService().parse(bytes);

  if (!result.ok) {
    throw new Error(result.reason);
  }

  return result.header;
}

const LLAMA = [
  pair('general.architecture', STRING, text('llama')),
  pair('general.name', STRING, text('Llama 3 8B Instruct')),
  pair('general.file_type', UINT32, u32(15)),
  pair('llama.block_count', UINT32, u32(32)),
  pair('llama.embedding_length', UINT32, u32(4096)),
  pair('llama.attention.head_count', UINT32, u32(32)),
  pair('llama.attention.head_count_kv', UINT32, u32(8)),
  pair('llama.context_length', UINT32, u32(8192)),
];

describe('GgufHeaderParserService', () => {
  const parser = new GgufHeaderParserService();

  it('reads what the catalogue records about a model', () => {
    const result = parser.parse(gguf(LLAMA, [tensor('output.weight', 4096, Q6_K)]));

    expect(result).toEqual({
      ok: true,
      header: {
        name: 'Llama 3 8B Instruct',
        declaredType: null,
        licence: null,
        modalities: [],
        tasks: [],
        metadata: {
          architecture: 'llama',
          quantisation: 'Q6_K',
          quantisationMixed: false,
          layerCount: 32,
          embeddingLength: 4096,
          headCount: 32,
          headCountKv: 8,
          contextLength: 8192,
        },
        tensors: [{ name: 'output.weight', type: 'Q6_K', parameters: 4096, sizeBytes: 3360 }],
      },
    });
  });

  it('reads the type a header states about itself', () => {
    const result = parser.parse(gguf([...LLAMA, pair('general.type', STRING, text('adapter'))]));

    expect(result.ok && result.header.declaredType).toBe('adapter');
  });

  it('walks past an array to the pairs behind it', () => {
    const tokens = Buffer.concat([u32(STRING), u64(2), text('<s>'), text('</s>')]);
    const result = parser.parse(gguf([pair('tokenizer.ggml.tokens', ARRAY, tokens), ...LLAMA]));

    expect(result.ok).toBe(true);
    expect(result.ok && result.header.metadata.architecture).toBe('llama');
  });

  it('skips a fixed-width array without reading its elements one by one', () => {
    const scores = Buffer.concat([u32(UINT32), u64(3), u32(1), u32(2), u32(3)]);
    const result = parser.parse(gguf([pair('tokenizer.ggml.token_type', ARRAY, scores), ...LLAMA]));

    expect(result.ok && result.header.metadata.layerCount).toBe(32);
  });

  it('leaves a field the file does not carry null', () => {
    const result = parser.parse(gguf([pair('general.architecture', STRING, text('llama'))]));

    expect(result.ok && result.header).toEqual({
      name: null,
      declaredType: null,
      licence: null,
      modalities: [],
      tasks: [],
      metadata: {
        architecture: 'llama',
        quantisation: null,
        quantisationMixed: false,
        layerCount: null,
        embeddingLength: null,
        headCount: null,
        headCountKv: null,
        contextLength: null,
      },
      tensors: [],
    });
  });

  it('refuses a file that does not start with the magic', () => {
    const result = parser.parse(Buffer.concat([Buffer.from('GGML', 'ascii'), u32(3), u64(0), u64(0)]));

    expect(result).toEqual({
      ok: false,
      reason: 'The file does not start with the GGUF magic',
      truncated: false,
    });
  });

  it('refuses a version whose lengths it cannot read', () => {
    const result = parser.parse(gguf(LLAMA, [], 1));

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(false);
  });

  it('asks for more of the file where the header runs past the bytes given', () => {
    const result = parser.parse(gguf(LLAMA).subarray(0, 64));

    expect(result).toEqual({
      ok: false,
      reason: 'The header runs past the bytes read',
      truncated: true,
    });
  });

  it('asks for more of the file where the pairs are in hand but the tensors are not', () => {
    const whole = gguf(LLAMA, [tensor('output.weight', 4096, Q6_K)]);
    const result = parser.parse(whole.subarray(0, whole.length - 8));

    expect(result).toEqual({
      ok: false,
      reason: 'The header runs past the bytes read',
      truncated: true,
    });
  });

  it('asks for more of the file where a string array runs past the bytes given', () => {
    const tokens = Buffer.concat([u32(STRING), u64(3), text('<s>'), text('</s>'), text('<unk>')]);
    const header = gguf([pair('tokenizer.ggml.tokens', ARRAY, tokens)]);
    const result = parser.parse(header.subarray(0, header.length - 2));

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(true);
  });

  it('asks for more of the file where a length is the largest safe integer', () => {
    const tokens = Buffer.concat([u32(STRING), u64(1), u64(Number.MAX_SAFE_INTEGER)]);
    const result = parser.parse(gguf([pair('tokenizer.ggml.tokens', ARRAY, tokens)]));

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(true);
  });

  it('refuses a length past the largest safe integer, rather than asking for more', () => {
    const length = Buffer.alloc(8);

    length.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n);

    const result = parser.parse(
      gguf([pair('tokenizer.ggml.tokens', ARRAY, Buffer.concat([u32(STRING), u64(1), length]))])
    );

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(false);
  });

  it('refuses a value type the format does not define, rather than asking for more', () => {
    const result = parser.parse(gguf([pair('general.architecture', 42, u32(0))]));

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(false);
  });

  describe('quantisation', () => {
    it('names the tensor type holding the most weights', () => {
      const tensors = [tensor('blk.0.ffn_down.weight', 8192, Q4_K), tensor('output.weight', 2048, Q6_K)];

      expect(headerOf(gguf(LLAMA, tensors)).metadata.quantisation).toBe('Q4_K');
    });

    it('counts the norms every file keeps in F32 as no part of a mix', () => {
      const tensors = [tensor('blk.0.ffn_down.weight', 65536, Q4_K), tensor('blk.0.attn_norm.weight', 64, F32)];

      expect(headerOf(gguf(LLAMA, tensors)).metadata.quantisationMixed).toBe(false);
    });

    it('calls a file mixed where a second type holds a share of the weights', () => {
      const tensors = [tensor('blk.0.ffn_down.weight', 8192, Q4_K), tensor('output.weight', 2048, Q6_K)];

      expect(headerOf(gguf(LLAMA, tensors)).metadata.quantisationMixed).toBe(true);
    });

    it('states nothing where a tensor names a type it does not know', () => {
      const tensors = [tensor('blk.0.ffn_down.weight', 8192, Q4_K), tensor('output.weight', 2048, UNNAMED_TYPE)];

      expect(headerOf(gguf(LLAMA, tensors)).metadata).toMatchObject({
        quantisation: null,
        quantisationMixed: false,
      });
    });

    it('states nothing about a file carrying no tensors at all', () => {
      expect(headerOf(gguf(LLAMA)).metadata).toMatchObject({
        quantisation: null,
        quantisationMixed: false,
      });
    });
  });

  describe('tensors', () => {
    it("sizes a tensor by the blocks its type packs, as Qwen3.8-Flash-Next's n-gram table", () => {
      const tensors = [tensor('per_layer_token_embd.weight', 160 * 320_001_536, Q5_0)];

      expect(headerOf(gguf(LLAMA, tensors)).tensors).toEqual([
        { name: 'per_layer_token_embd.weight', type: 'Q5_0', parameters: 51_200_245_760, sizeBytes: 35_200_168_960 },
      ]);
    });

    it('lists none where a tensor names a type it does not know', () => {
      const tensors = [tensor('blk.0.ffn_down.weight', 8192, Q4_K), tensor('output.weight', 2048, UNNAMED_TYPE)];

      expect(headerOf(gguf(LLAMA, tensors)).tensors).toBeNull();
    });
  });

  describe('a real header', () => {
    it('sizes the token embedding as the bytes the file holds for it', () => {
      const embedding = headerOf(fixture('Qwen3-0.6B-Q8_0')).tensors?.find(entry => entry.name === 'token_embd.weight');

      expect(embedding).toEqual({
        name: 'token_embd.weight',
        type: 'Q8_0',
        parameters: 1024 * 151_936,
        sizeBytes: 165_306_368,
      });
    });

    it('reads a plain quant as the one type its tensors hold', () => {
      expect(headerOf(fixture('Qwen3-0.6B-Q8_0')).metadata).toMatchObject({
        architecture: 'qwen3',
        quantisation: 'Q8_0',
        quantisationMixed: false,
        layerCount: 28,
        contextLength: 40960,
      });
    });

    it('separates a dynamic quant from the plain one whose file type it repeats', () => {
      expect(headerOf(fixture('Qwen3-0.6B-UD-Q8_K_XL')).metadata).toMatchObject({
        quantisation: 'Q8_0',
        quantisationMixed: true,
      });
    });

    it('reads a dynamic quant over the file type naming a quantisation it is not', () => {
      // `general.file_type` is 15, which llama.cpp's `llama_ftype` names Q4_K_M.
      expect(headerOf(fixture('Qwen3-0.6B-UD-Q4_K_XL')).metadata).toMatchObject({
        quantisation: 'Q4_K',
        quantisationMixed: true,
      });
    });
  });

  describe('licence', () => {
    it('reads the licence a model states', () => {
      const header = headerOf(gguf([pair('general.license', STRING, text('apache-2.0'))]));

      expect(header.licence).toEqual({ id: 'apache-2.0', name: null, link: null });
    });

    it('reads the name and link a custom licence carries', () => {
      expect(headerOf(fixture('mmproj-Qwen2.5-Omni-3B-Q8_0')).licence).toEqual({
        id: 'other',
        name: 'qwen-research',
        link: 'LICENSE',
      });
    });

    it('states none where the file carries none', () => {
      expect(headerOf(gguf([])).licence).toBeNull();
    });
  });

  describe('projector modalities', () => {
    it("reads an audio projector from its encoder's flag", () => {
      expect(headerOf(fixture('mmproj-Qwen3-ASR-0.6B-Q8_0')).modalities).toEqual([ProjectorModality.AUDIO]);
    });

    it('reads both where an omni projector carries both encoders', () => {
      expect(headerOf(fixture('mmproj-Qwen2.5-Omni-3B-Q8_0')).modalities).toEqual([
        ProjectorModality.VISION,
        ProjectorModality.AUDIO,
      ]);
    });

    it('reads a flag set false as no encoder', () => {
      const header = headerOf(
        gguf([
          pair('clip.has_vision_encoder', BOOL, Buffer.from([1])),
          pair('clip.has_audio_encoder', BOOL, Buffer.from([0])),
        ])
      );

      expect(header.modalities).toEqual([ProjectorModality.VISION]);
    });

    it('states none for a model', () => {
      expect(headerOf(fixture('Qwen3-0.6B-Q8_0')).modalities).toEqual([]);
    });
  });

  describe('tasks', () => {
    const CHAT_TEMPLATE = pair('tokenizer.chat_template', STRING, text('{{ messages }}'));

    it('reads a model carrying a chat template as chat', () => {
      expect(headerOf(fixture('Qwen3-0.6B-Q8_0')).tasks).toEqual([ModelTask.CHAT]);
    });

    it.each([1, 2, 3])('reads pooling type %s as embedding, over a chat template', poolingType => {
      const header = headerOf(
        gguf([
          pair('general.architecture', STRING, text('qwen3')),
          pair('qwen3.pooling_type', UINT32, u32(poolingType)),
          CHAT_TEMPLATE,
        ])
      );

      expect(header.tasks).toEqual([ModelTask.EMBEDDING]);
    });

    it('reads an embedding architecture as embedding where the file states no pooling type', () => {
      expect(headerOf(gguf([pair('general.architecture', STRING, text('nomic-bert'))])).tasks).toEqual([
        ModelTask.EMBEDDING,
      ]);
    });

    it('reads a reranker as no task, though its architecture is an embedding one', () => {
      const header = headerOf(
        gguf([pair('general.architecture', STRING, text('bert')), pair('bert.pooling_type', UINT32, u32(4))])
      );

      expect(header.tasks).toEqual([]);
    });

    it('passes over a pooling type that is not an embedding one, to the chat template', () => {
      const header = headerOf(
        gguf([
          pair('general.architecture', STRING, text('llama')),
          pair('llama.pooling_type', UINT32, u32(0)),
          CHAT_TEMPLATE,
        ])
      );

      expect(header.tasks).toEqual([ModelTask.CHAT]);
    });

    it('states none where the file says neither', () => {
      expect(headerOf(gguf(LLAMA)).tasks).toEqual([]);
    });
  });
});
