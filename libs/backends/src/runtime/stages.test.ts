import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { vllmOmniDefinition } from '../backends/vllm-omni/definition';
import { vllmDefinition } from '../backends/vllm/definition';
import { GIB } from '../definition';
import { buildContainerInput, buildModelMetadata } from '../test/container.factory';
import { stageSharesArguments } from './stages';

const GPU = 'GPU-11111111-2222-3333-4444-555555555555';

const SHARE_KEY = 'gpu_memory_utilization';

const stagesSchema = z.record(z.string(), z.record(z.string(), z.number()));

describe('stageSharesArguments', () => {
  const input = (gib: number, totalBytes: number) =>
    buildContainerInput({
      model: buildModelMetadata({ architecture: 'nemotron_voicechat' }),
      configuration: { gpuMemoryGib: gib },
      pins: { cpu: false, gpus: [GPU] },
      gpuTotalBytes: new Map([[GPU, totalBytes]]),
    });

  it('writes one entry per stage, keyed by stage id, which together stay within the size', () => {
    const [flag, written] = stageSharesArguments(vllmOmniDefinition, input(10, 80 * GIB));
    const shares = stagesSchema.parse(JSON.parse(written));
    const fractions = Object.values(shares).map(stage => stage[SHARE_KEY]);

    expect(flag).toBe('--stage-overrides');
    expect(Object.keys(shares)).toEqual(['0', '1', '2']);
    expect(fractions.reduce((total, fraction) => total + fraction, 0)).toBeLessThanOrEqual(10 / 80);
  });

  it('refuses a size so small that a stage would be left nothing', () => {
    expect(() => stageSharesArguments(vllmOmniDefinition, input(1, 4096 * GIB))).toThrow('leaves a stage');
  });

  it('writes nothing for a backend with no stage table', () => {
    expect(stageSharesArguments(vllmDefinition, input(10, 80 * GIB))).toEqual([]);
  });

  it('leaves a card short of the size to placement, which refuses it before launch', () => {
    const [flag, written] = stageSharesArguments(vllmOmniDefinition, input(10, 8 * GIB));
    const fractions = Object.values(stagesSchema.parse(JSON.parse(written))).map(stage => stage[SHARE_KEY]);

    expect(flag).toBe('--stage-overrides');
    expect(fractions.reduce((total, fraction) => total + fraction, 0)).toBeGreaterThan(1);
  });
});
