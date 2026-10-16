import { describe, expect, it } from 'vitest';

import { asksForStream } from './stream';

describe('asksForStream', () => {
  it.each(['text/event-stream', 'Text/Event-Stream', 'application/json, text/event-stream;q=0.9'])(
    'reads %j as asking for a stream',
    accept => {
      expect(asksForStream(accept)).toBe(true);
    }
  );

  it.each(['', '*/*', 'application/json'])('reads %j as asking for a whole answer', accept => {
    expect(asksForStream(accept)).toBe(false);
  });
});
