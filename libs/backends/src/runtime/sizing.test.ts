import { describe, expect, it } from 'vitest';

import { GIB } from '../definition';
import { buildEstimatedModel } from '../test/container.factory';
import { configuredShares, evenShares } from './sizing';

const input = (totals: (number | null)[]) => ({
  model: buildEstimatedModel(),
  companions: [],
  configuration: {},
  deviceCount: totals.length,
  devices: totals.map((totalBytes, card) => ({ deviceKey: `GPU-${card}`, totalBytes })),
});

describe('configuredShares', () => {
  it('takes the same fraction of each card, so a larger card holds more', () => {
    expect(configuredShares(input([24 * GIB, 48 * GIB]))).toEqual([24 * GIB, 48 * GIB]);
  });

  it('places nothing where a card has not reported its total', () => {
    expect(configuredShares(input([24 * GIB, null]))).toBeNull();
  });
});

describe('evenShares', () => {
  it('puts the same amount on every card, whatever its total', () => {
    expect(evenShares(input([24 * GIB, null]))).toEqual([1, 1]);
  });
});
