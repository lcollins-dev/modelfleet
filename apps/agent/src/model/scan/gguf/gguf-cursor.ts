import { FIXED_WIDTHS, GgufValueType } from './gguf-value-type';

export class RanOut extends Error {}

/** The high word of `Number.MAX_SAFE_INTEGER`. */
const MAX_SAFE_HIGH_WORD = 0x1f_ffff;

/** Walks a little-endian GGUF header, raising `RanOut` the moment a read passes the last byte. */
export class GgufCursor {
  private offset = 0;

  constructor(private readonly bytes: Buffer) {}

  fixed(type: GgufValueType): number | null {
    const width = FIXED_WIDTHS.get(type);

    if (width === undefined) {
      return null;
    }

    const at = this.take(width);

    switch (type) {
      case GgufValueType.UINT8:
      case GgufValueType.BOOL:
        return this.bytes.readUInt8(at);
      case GgufValueType.INT8:
        return this.bytes.readInt8(at);
      case GgufValueType.UINT16:
        return this.bytes.readUInt16LE(at);
      case GgufValueType.INT16:
        return this.bytes.readInt16LE(at);
      case GgufValueType.UINT32:
        return this.bytes.readUInt32LE(at);
      case GgufValueType.INT32:
        return this.bytes.readInt32LE(at);
      case GgufValueType.FLOAT32:
        return this.bytes.readFloatLE(at);
      case GgufValueType.FLOAT64:
        return this.bytes.readDoubleLE(at);
      default:
        return this.safeNumber(
          type === GgufValueType.INT64 ? this.bytes.readBigInt64LE(at) : this.bytes.readBigUInt64LE(at)
        );
    }
  }

  magic(): string {
    const at = this.take(4);

    return this.bytes.toString('ascii', at, at + 4);
  }

  uint32(): number {
    return this.bytes.readUInt32LE(this.take(4));
  }

  /** Two words rather than a BigInt, which across a vocabulary's worth of lengths costs milliseconds. */
  uint64(): number {
    const at = this.take(8);
    const high = this.bytes.readUInt32LE(at + 4);

    if (high > MAX_SAFE_HIGH_WORD) {
      return this.safeNumber(this.bytes.readBigUInt64LE(at));
    }

    return high * 2 ** 32 + this.bytes.readUInt32LE(at);
  }

  string(): string {
    const length = this.uint64();
    const at = this.take(length);

    return this.bytes.toString('utf8', at, at + length);
  }

  skipString(): void {
    this.take(this.uint64());
  }

  skip(count: number): void {
    this.take(count);
  }

  private take(count: number): number {
    if (count < 0 || this.offset + count > this.bytes.length) {
      throw new RanOut();
    }

    const at = this.offset;

    this.offset += count;

    return at;
  }

  private safeNumber(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`A GGUF header holds ${String(value)}, which no safe integer covers`);
    }

    return Number(value);
  }
}
