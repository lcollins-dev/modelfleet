import * as crypto from 'node:crypto';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelFingerprintService, SAMPLE_BYTES, SAMPLE_SPAN_BYTES } from '@/model/scan/model-fingerprint.service';
import { ShardReader } from '@/model/scan/shard-reader';
import { IModelFile } from '@/model/scan/types/model-file';

vi.mock('node:crypto', async importOriginal => {
  const original = await importOriginal<typeof import('node:crypto')>();

  return { ...original, createHash: vi.fn(original.createHash) };
});

vi.mock('node:worker_threads', async importOriginal => {
  const original = await importOriginal<typeof import('node:worker_threads')>();

  return {
    ...original,
    Worker: vi.fn(function (...args: ConstructorParameters<typeof original.Worker>) {
      return new original.Worker(...args);
    }),
  };
});

describe('ModelFingerprintService', () => {
  const fingerprinter = new ModelFingerprintService();

  it('reads a stream shorter than the sample span whole', () => {
    expect(fingerprinter.sampleRanges(1024)).toEqual([{ offset: 0, length: 1024 }]);
  });

  it('reads a stream exactly the sample span whole', () => {
    expect(fingerprinter.sampleRanges(SAMPLE_SPAN_BYTES)).toEqual([{ offset: 0, length: SAMPLE_SPAN_BYTES }]);
  });

  it('takes the head, then the middle, then the tail', () => {
    const size = SAMPLE_SPAN_BYTES * 10;

    expect(fingerprinter.sampleRanges(size)).toEqual([
      { offset: 0, length: SAMPLE_BYTES },
      { offset: size / 2 - SAMPLE_BYTES / 2, length: SAMPLE_BYTES },
      { offset: size - SAMPLE_BYTES, length: SAMPLE_BYTES },
    ]);
  });

  it('keeps every sample inside the stream', () => {
    for (const size of [SAMPLE_SPAN_BYTES + 1, SAMPLE_SPAN_BYTES * 3, SAMPLE_SPAN_BYTES * 1000]) {
      for (const range of fingerprinter.sampleRanges(size)) {
        expect(range.offset).toBeGreaterThanOrEqual(0);
        expect(range.offset + range.length).toBeLessThanOrEqual(size);
      }
    }
  });

  describe('digest', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'modelfleet-fingerprint-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    async function write(name: string, bytes: Buffer): Promise<IModelFile> {
      const path = join(directory, name);

      await writeFile(path, bytes);

      return { path, sizeBytes: bytes.length };
    }

    async function digest(files: readonly IModelFile[]): Promise<string> {
      const reader = new ShardReader(files);

      try {
        return await fingerprinter.digest(reader);
      } finally {
        await reader.close();
      }
    }

    it('digests a file shorter than the sample span whole', async () => {
      const bytes = randomBytes(4096);
      const file = await write('small.gguf', bytes);

      expect(await digest([file])).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('gives the same digest to the same bytes at another path', async () => {
      const bytes = randomBytes(4096);
      const here = await write('here.gguf', bytes);
      const there = await write('there.gguf', bytes);

      expect(await digest([here])).toBe(await digest([there]));
    });

    it('digests a shard set as the concatenation of its members, in shard order', async () => {
      const head = randomBytes(2048);
      const tail = randomBytes(1024);
      const first = await write('set-00001-of-00002.gguf', head);
      const second = await write('set-00002-of-00002.gguf', tail);
      const whole = await write('whole.gguf', Buffer.concat([head, tail]));

      expect(await digest([first, second])).toBe(await digest([whole]));
    });

    it('reads a byte a shard boundary falls across from the right member', async () => {
      const bytes = randomBytes(3072);
      const shards = [await write('a-00001-of-00002.gguf', bytes.subarray(0, 1000))];
      const reader = new ShardReader([...shards, await write('a-00002-of-00002.gguf', bytes.subarray(1000))]);
      const chunks: Buffer[] = [];

      try {
        await reader.read(900, 200, chunk => {
          chunks.push(Buffer.from(chunk));
        });
      } finally {
        await reader.close();
      }

      expect(Buffer.concat(chunks)).toEqual(bytes.subarray(900, 1100));
    });

    /** Xorshift32. The golden digests below are taken over exactly this sequence. */
    function seededBytes(length: number, seed: number): Buffer {
      const bytes = Buffer.alloc(length);
      let state = seed;

      for (let offset = 0; offset < length; offset += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[offset] = state & 0xff;
      }

      return bytes;
    }

    /** Taken from the main-thread fingerprinter. A changed digest splits every catalogued model in two. */
    describe('stays byte-identical to the fingerprints already catalogued', () => {
      const LARGE_BYTES = SAMPLE_SPAN_BYTES * 2 + 12_345;

      it('over a file shorter than the sample span', async () => {
        const file = await write('small.gguf', seededBytes(4096, 1));

        expect(await digest([file])).toBe('af2ba40f7dde30b5c1e477a74dcd61d850b9121fd92a68659a1865b2580dcb80');
      });

      it('over a file exactly the sample span', async () => {
        const file = await write('span.gguf', seededBytes(SAMPLE_SPAN_BYTES, 2));

        expect(await digest([file])).toBe('f818e6e9e6e03b3545fa68c183382d0c794171d7205ed19ab555471413199f23');
      });

      it('over a file past the sample span, whose middle sample starts at an odd offset', async () => {
        const file = await write('large.gguf', seededBytes(LARGE_BYTES, 3));

        expect(await digest([file])).toBe('9a1819489ee50e369154409f3906bbb94adc1b6bb879ade5fc4e6fd65135676f');
      });

      it('over a shard set whose boundaries fall inside each sample', async () => {
        const bytes = seededBytes(LARGE_BYTES, 3);
        const boundaries = [SAMPLE_BYTES / 2, Math.floor(LARGE_BYTES / 2), LARGE_BYTES - SAMPLE_BYTES / 2];
        const shards = [
          await write('set-00001-of-00004.gguf', bytes.subarray(0, boundaries[0])),
          await write('set-00002-of-00004.gguf', bytes.subarray(boundaries[0], boundaries[1])),
          await write('set-00003-of-00004.gguf', bytes.subarray(boundaries[1], boundaries[2])),
          await write('set-00004-of-00004.gguf', bytes.subarray(boundaries[2])),
        ];

        expect(await digest(shards)).toBe('9a1819489ee50e369154409f3906bbb94adc1b6bb879ade5fc4e6fd65135676f');
      });
    });

    it('hashes nothing on the main thread', async () => {
      const file = await write('small.gguf', seededBytes(4096, 1));

      vi.mocked(crypto.createHash).mockClear();

      expect(await digest([file])).toBe('af2ba40f7dde30b5c1e477a74dcd61d850b9121fd92a68659a1865b2580dcb80');
      expect(crypto.createHash).not.toHaveBeenCalled();
    });

    it('rejects where its worker stops without a result, so the scan goes on', async () => {
      const file = await write('small.gguf', seededBytes(4096, 1));
      const worker = Object.assign(new EventEmitter(), { terminate: vi.fn() });

      vi.mocked(Worker).mockImplementationOnce(function () {
        return worker as unknown as Worker;
      });

      const reading = digest([file]);

      worker.emit('exit', 1);

      await expect(reading).rejects.toThrow('its worker stopped without a result');
    });

    it('ends a sample where a file proves shorter than its recorded size, and goes on to the next', async () => {
      const size = SAMPLE_SPAN_BYTES * 2;
      const bytes = seededBytes(size - SAMPLE_BYTES / 2, 4);
      const file = { ...(await write('shrunk.gguf', bytes)), sizeBytes: size };
      const middle = size / 2 - SAMPLE_BYTES / 2;
      const expected = createHash('sha256')
        .update(bytes.subarray(0, SAMPLE_BYTES))
        .update(bytes.subarray(middle, middle + SAMPLE_BYTES))
        .update(bytes.subarray(size - SAMPLE_BYTES))
        .digest('hex');

      expect(await digest([file])).toBe(expected);
    });

    it('rejects with the reason where a member cannot be read', async () => {
      const file = await write('gone.gguf', randomBytes(4096));

      await rm(file.path);

      await expect(digest([file])).rejects.toThrow(/ENOENT/);
    });

    it('maps a range onto the members it falls across, skipping an empty one', async () => {
      const reader = new ShardReader([
        { path: 'a', sizeBytes: 1000 },
        { path: 'empty', sizeBytes: 0 },
        { path: 'b', sizeBytes: 1000 },
        { path: 'c', sizeBytes: 1000 },
      ]);

      expect(reader.segments(900, 1200)).toEqual([
        { path: 'a', offset: 900, length: 100 },
        { path: 'b', offset: 0, length: 1000 },
        { path: 'c', offset: 0, length: 100 },
      ]);
      expect(reader.segments(2500, 1000)).toEqual([{ path: 'c', offset: 500, length: 500 }]);

      await reader.close();
    });

    it('tells two files apart that differ only in their tail', async () => {
      const head = randomBytes(SAMPLE_SPAN_BYTES);
      const left = await write('left.gguf', Buffer.concat([head, Buffer.alloc(SAMPLE_BYTES, 1)]));
      const right = await write('right.gguf', Buffer.concat([head, Buffer.alloc(SAMPLE_BYTES, 2)]));

      expect(await digest([left])).not.toBe(await digest([right]));
    });
  });
});
