import { describe, expect, it } from 'vitest';

import { LaunchMode, launchModeOf } from './launch';

const DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';

describe('launchModeOf', () => {
  it('offloads nowhere where the cards were pinned on their own', () => {
    expect(launchModeOf({ cpu: false, gpus: [DEVICE_KEY] })).toBe(LaunchMode.GPU_ONLY);
  });

  it('offloads to the host where the CPU was pinned beside the cards', () => {
    expect(launchModeOf({ cpu: true, gpus: [DEVICE_KEY] })).toBe(LaunchMode.CPU_OFFLOAD);
  });

  it('takes the CPU alone where no card was pinned', () => {
    expect(launchModeOf({ cpu: true, gpus: [] })).toBe(LaunchMode.CPU_ONLY);
  });

  it('follows the cards rather than the flag, so a card pinned without the CPU never offloads', () => {
    expect(launchModeOf({ cpu: false, gpus: [DEVICE_KEY, 'GPU-2'] })).toBe(LaunchMode.GPU_ONLY);
  });
});
