import { describe, expect, it, vi } from 'vitest';

import { SseChunkMapper } from './sse-chunk-mapper';

const collect = async (mapper: SseChunkMapper, writes: (string | Buffer)[]): Promise<string> => {
  const chunks: string[] = [];

  mapper.setEncoding('utf8');
  mapper.on('data', (chunk: string) => chunks.push(chunk));

  for (const write of writes) {
    mapper.write(write);
  }

  mapper.end();

  await new Promise<void>(resolve => mapper.on('end', resolve));

  return chunks.join('');
};

const upperCased = (chunk: unknown): unknown => ({ ...(chunk as object), mapped: true });

describe('SseChunkMapper', () => {
  it('maps each payload and keeps the event framing', async () => {
    const mapper = new SseChunkMapper(upperCased);

    const out = await collect(mapper, ['data: {"id":"a"}\n\ndata: {"id":"b"}\n\n']);

    expect(out).toBe('data: {"id":"a","mapped":true}\n\ndata: {"id":"b","mapped":true}\n\n');
  });

  it('holds a partial event back until the rest of it arrives', async () => {
    const mapChunk = vi.fn(upperCased);
    const mapper = new SseChunkMapper(mapChunk);

    const out = await collect(mapper, ['data: {"id"', ':"a"}\n', '\n']);

    expect(out).toBe('data: {"id":"a","mapped":true}\n\n');
    expect(mapChunk).toHaveBeenCalledTimes(1);
  });

  it('passes the terminator and a keepalive comment through untouched', async () => {
    const mapChunk = vi.fn(upperCased);
    const mapper = new SseChunkMapper(mapChunk);

    const out = await collect(mapper, [': keepalive\n\ndata: [DONE]\n\n']);

    expect(out).toBe(': keepalive\n\ndata: [DONE]\n\n');
    expect(mapChunk).not.toHaveBeenCalled();
  });

  it('passes an unparseable payload through rather than breaking the stream', async () => {
    const mapChunk = vi.fn(upperCased);
    const mapper = new SseChunkMapper(mapChunk);

    const out = await collect(mapper, ['data: not json\n\n']);

    expect(out).toBe('data: not json\n\n');
    expect(mapChunk).not.toHaveBeenCalled();
  });

  it('marks the first payload once and leaves the mark null where none arrived', async () => {
    const empty = new SseChunkMapper(upperCased);
    await collect(empty, ['data: [DONE]\n\n']);

    expect(empty.firstPayloadAt).toBeNull();

    const streamed = new SseChunkMapper(upperCased);
    await collect(streamed, ['data: {"id":"a"}\n\ndata: {"id":"b"}\n\n']);

    expect(streamed.firstPayloadAt).not.toBeNull();
  });

  it('keeps a character whose bytes arrive in two chunks', async () => {
    const mapper = new SseChunkMapper(chunk => chunk);
    const event = Buffer.from('data: {"content":"🦙"}\n\n', 'utf8');
    const splitAt = event.indexOf(Buffer.from('🦙', 'utf8')) + 2;

    const out = await collect(mapper, [event.subarray(0, splitAt), event.subarray(splitAt)]);

    expect(out).toBe('data: {"content":"🦙"}\n\n');
  });
});
