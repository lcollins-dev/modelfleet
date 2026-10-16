import { Injectable } from '@nestjs/common';

import { SafetensorsMetadata } from '@libs/agent-protocol';

/** The length prefix the format opens with, ahead of that many bytes of JSON. */
const LENGTH_BYTES = 8;

const MAX_HEADER_BYTES = 100 * 1024 * 1024;

/** Free-form strings the format allows, and never a tensor. */
const METADATA_KEY = '__metadata__';

export interface ISafetensorsHeaderRead {
  ok: true;
  metadata: SafetensorsMetadata;
}

export interface ISafetensorsHeaderRefused {
  ok: false;
  reason: string;
  /** The bytes given stop inside the header; the same bytes plus more may parse. */
  truncated: boolean;
}

export type SafetensorsHeaderResult = ISafetensorsHeaderRead | ISafetensorsHeaderRefused;

interface ITensor {
  dtype: unknown;
  shape: unknown;
}

@Injectable()
export class SafetensorsHeaderParserService {
  /** Reads the head of a safetensors file. A `truncated` refusal is worth retrying with more of it. */
  parse(bytes: Buffer): SafetensorsHeaderResult {
    if (bytes.length < LENGTH_BYTES) {
      return { ok: false, reason: 'The header runs past the bytes read', truncated: true };
    }

    const length = Number(bytes.readBigUInt64LE(0));

    if (length <= 0 || length > MAX_HEADER_BYTES) {
      return { ok: false, reason: 'The file opens with no readable safetensors header length', truncated: false };
    }

    if (bytes.length < LENGTH_BYTES + length) {
      return { ok: false, reason: 'The header runs past the bytes read', truncated: true };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(bytes.toString('utf8', LENGTH_BYTES, LENGTH_BYTES + length));
    } catch {
      return { ok: false, reason: 'The safetensors header is not valid JSON', truncated: false };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: 'The safetensors header is not an object', truncated: false };
    }

    return { ok: true, metadata: this.metadataFrom(parsed) };
  }

  private metadataFrom(header: object): SafetensorsMetadata {
    const byDtype = new Map<string, number>();
    let tensorCount = 0;
    let parameterCount = 0;

    for (const [key, value] of Object.entries(header)) {
      if (key === METADATA_KEY || !this.isTensor(value)) {
        continue;
      }

      const parameters = this.parameterCountOf(value.shape);

      tensorCount += 1;
      parameterCount += parameters;

      if (typeof value.dtype === 'string' && value.dtype.length > 0) {
        byDtype.set(value.dtype, (byDtype.get(value.dtype) ?? 0) + parameters);
      }
    }

    return { dtype: this.dominantDtype(byDtype), tensorCount, parameterCount };
  }

  private isTensor(value: unknown): value is ITensor {
    return typeof value === 'object' && value !== null && 'dtype' in value && 'shape' in value;
  }

  private parameterCountOf(shape: unknown): number {
    if (!Array.isArray(shape)) {
      return 0;
    }

    return shape.reduce<number>((product, axis) => (typeof axis === 'number' && axis >= 0 ? product * axis : 0), 1);
  }

  private dominantDtype(byDtype: Map<string, number>): string | null {
    let dominant: string | null = null;
    let best = -1;

    for (const [dtype, parameters] of byDtype) {
      if (parameters > best) {
        dominant = dtype;
        best = parameters;
      }
    }

    return dominant;
  }
}
