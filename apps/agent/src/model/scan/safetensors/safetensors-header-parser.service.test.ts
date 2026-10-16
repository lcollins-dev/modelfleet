import { describe, expect, it } from 'vitest';

import { SafetensorsHeaderParserService } from '@/model/scan/safetensors/safetensors-header-parser.service';

interface ITensor {
  name: string;
  dtype: string;
  shape: number[];
}

function headerOf(tensors: readonly ITensor[], metadata = true): Record<string, unknown> {
  const header: Record<string, unknown> = {};

  if (metadata) {
    header['__metadata__'] = { format: 'pt' };
  }

  for (const tensor of tensors) {
    header[tensor.name] = { dtype: tensor.dtype, shape: tensor.shape };
  }

  return header;
}

function safetensors(header: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(8);

  length.writeBigUInt64LE(BigInt(json.length));

  return Buffer.concat([length, json]);
}

const TENSORS = headerOf([
  { name: 'model.embed_tokens.weight', dtype: 'BF16', shape: [128, 64] },
  { name: 'model.layers.0.mlp.down_proj.weight', dtype: 'BF16', shape: [64, 32] },
  { name: 'model.norm.weight', dtype: 'F32', shape: [16] },
]);

describe('SafetensorsHeaderParserService', () => {
  const parser = new SafetensorsHeaderParserService();

  it('counts the tensors and their parameters, leaving the metadata block out of both', () => {
    const result = parser.parse(safetensors(TENSORS));

    expect(result).toEqual({
      ok: true,
      metadata: { dtype: 'BF16', tensorCount: 3, parameterCount: 128 * 64 + 64 * 32 + 16 },
    });
  });

  it('names the dtype the most parameters are held in', () => {
    const result = parser.parse(
      safetensors(
        headerOf(
          [
            { name: 'small', dtype: 'F32', shape: [2] },
            { name: 'large', dtype: 'F16', shape: [1000] },
          ],
          false
        )
      )
    );

    expect(result.ok && result.metadata.dtype).toBe('F16');
  });

  it('reads a file holding no tensors at all', () => {
    const result = parser.parse(safetensors(headerOf([])));

    expect(result.ok && result.metadata).toEqual({ dtype: null, tensorCount: 0, parameterCount: 0 });
  });

  it('asks for more of the file where the header runs past the bytes given', () => {
    const result = parser.parse(safetensors(TENSORS).subarray(0, 20));

    expect(result).toEqual({ ok: false, reason: 'The header runs past the bytes read', truncated: true });
  });

  it('asks for more where even the length prefix is not there yet', () => {
    const result = parser.parse(Buffer.alloc(4));

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(true);
  });

  it('refuses a length no header could have, rather than asking for more', () => {
    const bytes = Buffer.alloc(16);

    bytes.writeBigUInt64LE(BigInt(500 * 1024 * 1024));

    const result = parser.parse(bytes);

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(false);
  });

  it('refuses a header that is not valid JSON', () => {
    const json = Buffer.from('{ not json', 'utf8');
    const length = Buffer.alloc(8);

    length.writeBigUInt64LE(BigInt(json.length));

    const result = parser.parse(Buffer.concat([length, json]));

    expect(result).toEqual({ ok: false, reason: 'The safetensors header is not valid JSON', truncated: false });
  });

  it('refuses a header that is a list rather than an object', () => {
    const result = parser.parse(safetensors([1, 2, 3]));

    expect(result.ok).toBe(false);
    expect(result.ok || result.truncated).toBe(false);
  });
});
