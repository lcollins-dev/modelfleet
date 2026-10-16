import { FileHandle, open } from 'node:fs/promises';

import { IModelFile } from './types/model-file';

const READ_CHUNK_BYTES = 1024 * 1024;

export interface IShardSegment {
  path: string;

  /** Within the file at `path`. */
  offset: number;

  length: number;
}

/** One byte stream over a model's files, in the order given. Every reader must be closed. */
export class ShardReader {
  readonly sizeBytes: number;

  private readonly handles = new Map<string, FileHandle>();
  private readonly buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);

  constructor(private readonly files: readonly IModelFile[]) {
    this.sizeBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  }

  /**
   * Reuses one buffer, so a caller keeping a chunk past its call must copy it. A range running past
   * the end stops there, and so does one reaching a file that ends before its recorded size.
   */
  async read(offset: number, length: number, onChunk: (chunk: Buffer) => void): Promise<void> {
    for (const segment of this.segments(offset, length)) {
      const handle = await this.handleFor(segment.path);
      let position = segment.offset;
      let remaining = segment.length;

      while (remaining > 0) {
        const { bytesRead } = await handle.read(this.buffer, 0, Math.min(remaining, READ_CHUNK_BYTES), position);

        if (bytesRead === 0) {
          return;
        }

        onChunk(this.buffer.subarray(0, bytesRead));

        position += bytesRead;
        remaining -= bytesRead;
      }
    }
  }

  /** In stream order. A range running past the end stops there. */
  segments(offset: number, length: number): IShardSegment[] {
    const end = Math.min(offset + length, this.sizeBytes);
    const segments: IShardSegment[] = [];
    let start = 0;

    for (const file of this.files) {
      const from = Math.max(offset, start);
      const to = Math.min(end, start + file.sizeBytes);

      if (from < to) {
        segments.push({ path: file.path, offset: from - start, length: to - from });
      }

      start += file.sizeBytes;
    }

    return segments;
  }

  async close(): Promise<void> {
    const handles = [...this.handles.values()];

    this.handles.clear();

    await Promise.all(handles.map(handle => handle.close()));
  }

  private async handleFor(path: string): Promise<FileHandle> {
    const existing = this.handles.get(path);

    if (existing !== undefined) {
      return existing;
    }

    const handle = await open(path, 'r');

    this.handles.set(path, handle);

    return handle;
  }
}
