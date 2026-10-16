import { describe, expect, it } from 'vitest';

import { readRelayLogsRoute, readRelayRoute, relayLogsPath, relayPath } from './route';

const INSTANCE_KEY = '11111111-2222-4333-8444-555555555555';

describe('readRelayRoute', () => {
  it('reads the instance key and leaves the rest of the target for the backend', () => {
    expect(readRelayRoute(`/instances/${INSTANCE_KEY}/v1/chat/completions`)).toEqual({
      instanceKey: INSTANCE_KEY,
      path: '/v1/chat/completions',
    });
  });

  it('carries the query through untouched', () => {
    expect(readRelayRoute(`/instances/${INSTANCE_KEY}/v1/models?limit=10&after=a%2Fb`)?.path).toBe(
      '/v1/models?limit=10&after=a%2Fb'
    );
  });

  it.each([
    ['a target under no prefix', '/v1/chat/completions'],
    ['an instance key that is not a uuid', '/instances/not-a-key/v1/models'],
    ['a key with no backend path', `/instances/${INSTANCE_KEY}`],
    ['an empty key', '/instances//v1/models'],
  ])('refuses %s', (_, target) => {
    expect(readRelayRoute(target)).toBeNull();
  });

  it('reads the backend root as a path of its own', () => {
    expect(readRelayRoute(`/instances/${INSTANCE_KEY}/`)?.path).toBe('/');
  });

  it('refuses a target carrying control characters, which is what a smuggled request needs', () => {
    expect(readRelayRoute(`/instances/${INSTANCE_KEY}/v1/models\r\nX-Injected: 1`)).toBeNull();
  });
});

describe('readRelayLogsRoute', () => {
  it('reads the instance key and the tail', () => {
    expect(readRelayLogsRoute(`/logs/${INSTANCE_KEY}?tail=1000`)).toEqual({ instanceKey: INSTANCE_KEY, tail: 1000 });
  });

  it.each([
    ['zero', '0', 0],
    ['the most it serves', '10000', 10_000],
  ])('reads a tail of %s', (_, tail, read) => {
    expect(readRelayLogsRoute(`/logs/${INSTANCE_KEY}?tail=${tail}`)?.tail).toBe(read);
  });

  it.each([
    ['no tail', `/logs/${INSTANCE_KEY}`],
    ['an empty tail', `/logs/${INSTANCE_KEY}?tail=`],
    ['a negative tail', `/logs/${INSTANCE_KEY}?tail=-1`],
    ['a tail over the most it serves', `/logs/${INSTANCE_KEY}?tail=10001`],
    ['a fractional tail', `/logs/${INSTANCE_KEY}?tail=1.5`],
    ['an exponent', `/logs/${INSTANCE_KEY}?tail=1e3`],
    ['a word', `/logs/${INSTANCE_KEY}?tail=all`],
    ['two tails', `/logs/${INSTANCE_KEY}?tail=1&tail=2`],
  ])('reads %s as no tail, for the caller to refuse', (_, target) => {
    expect(readRelayLogsRoute(target)).toEqual({ instanceKey: INSTANCE_KEY, tail: null });
  });

  it.each([
    ['a target under another prefix', `/instances/${INSTANCE_KEY}/v1/models`],
    ['an instance key that is not a uuid', '/logs/not-a-key?tail=10'],
    ['a path under the key', `/logs/${INSTANCE_KEY}/more?tail=10`],
    ['an empty key', '/logs/?tail=10'],
    ['a target carrying control characters', `/logs/${INSTANCE_KEY}?tail=10\r\nX-Injected: 1`],
  ])('refuses %s', (_, target) => {
    expect(readRelayLogsRoute(target)).toBeNull();
  });
});

describe('relayPath', () => {
  it('builds the target readRelayRoute reads back', () => {
    expect(readRelayRoute(relayPath(INSTANCE_KEY, '/v1/chat/completions?stream=true'))).toEqual({
      instanceKey: INSTANCE_KEY,
      path: '/v1/chat/completions?stream=true',
    });
  });
});

describe('relayLogsPath', () => {
  it('builds the target readRelayLogsRoute reads back', () => {
    expect(readRelayLogsRoute(relayLogsPath(INSTANCE_KEY, 250))).toEqual({ instanceKey: INSTANCE_KEY, tail: 250 });
  });
});
