import { describe, expect, it } from 'vitest';

import { GIB } from '@libs/backends';

import { launchTimeoutMs } from '@/instance/launch-timeout';

const BASE_MS = 120_000;
const PER_GIB_MS = 20_000;

describe('launchTimeoutMs', () => {
  it('allows the base alone for weights of no size', () => {
    expect(launchTimeoutMs(0, BASE_MS, PER_GIB_MS)).toBe(BASE_MS);
  });

  it('adds the rate for every gibibyte, so a bigger model is given longer to load', () => {
    expect(launchTimeoutMs(4 * GIB, BASE_MS, PER_GIB_MS)).toBe(BASE_MS + 4 * PER_GIB_MS);
  });

  it('scales part of a gibibyte rather than rounding it up', () => {
    expect(launchTimeoutMs(GIB / 2, BASE_MS, PER_GIB_MS)).toBe(BASE_MS + PER_GIB_MS / 2);
  });
});
