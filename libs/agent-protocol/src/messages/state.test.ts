import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { IInstancePins } from '@libs/backends';
import { IModelMetadata } from '@libs/backends/runtime';

import { MAX_MODEL_PATH_LENGTH } from './model';
import {
  DesiredInstance,
  DesiredModel,
  MAX_COMPANIONS_PER_INSTANCE,
  desiredInstanceSchema,
  instancePinsSchema,
} from './state';

const DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';

const desiredInstance = (overrides: Partial<DesiredInstance> = {}): Record<string, unknown> => ({
  instanceKey: '01999999-1111-7111-8111-111111111111',
  revision: 1,
  backend: 'llama.cpp',
  servedModel: 'chat-8b',
  model: {
    sizeBytes: 4_368_439_296,
    architecture: 'llama',
    quantisation: 'Q4_K',
    layerCount: 32,
    embeddingLength: 4096,
    headCount: 32,
    headCountKv: 8,
    contextLength: 8192,
  },
  weightsPath: '/srv/models/llama-3-8b/model.gguf',
  configuration: { contextSize: 8192 },
  pins: { cpu: false, gpus: [DEVICE_KEY] },
  image: null,

  ...overrides,
});

describe('desiredInstanceSchema', () => {
  it('takes each hardware selection a placement can pin', () => {
    expect(desiredInstanceSchema.safeParse(desiredInstance()).success).toBe(true);
    expect(desiredInstanceSchema.safeParse(desiredInstance({ pins: { cpu: true, gpus: [DEVICE_KEY] } })).success).toBe(
      true
    );
    expect(desiredInstanceSchema.safeParse(desiredInstance({ pins: { cpu: true, gpus: [] } })).success).toBe(true);
  });

  it('refuses a desired instance naming no pins, so an agent never guesses the hardware', () => {
    const { pins, ...withoutPins } = desiredInstance();

    expect(pins).toBeDefined();
    expect(desiredInstanceSchema.safeParse(withoutPins).success).toBe(false);
  });

  it('refuses an instance pinned to nothing, which has nowhere to run', () => {
    expect(desiredInstanceSchema.safeParse(desiredInstance({ pins: { cpu: false, gpus: [] } })).success).toBe(false);
  });

  it('refuses a device key the vendor UUID length cannot hold', () => {
    const pins = { cpu: false, gpus: ['x'.repeat(129)] };

    expect(desiredInstanceSchema.safeParse(desiredInstance({ pins })).success).toBe(false);
  });
});

const withCompanions = (companionPaths: unknown) =>
  desiredInstanceSchema.safeParse({ ...desiredInstance(), companionPaths });

describe('the companions a desired instance carries', () => {
  it('accepts an instance naming none, so an older agent reads what it always did', () => {
    expect(desiredInstanceSchema.safeParse(desiredInstance()).success).toBe(true);
  });

  it("carries a companion's field key and this node's path to it", () => {
    const parsed = withCompanions([{ field: 'mmproj', path: '/srv/models/gemma-3-4b/mmproj-F16.gguf' }]);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.companionPaths).toEqual([{ field: 'mmproj', path: '/srv/models/gemma-3-4b/mmproj-F16.gguf' }]);
  });

  it('refuses a field name that would climb out of the container model directory', () => {
    expect(withCompanions([{ field: '../..', path: '/srv/models/mmproj.gguf' }]).success).toBe(false);
    expect(withCompanions([{ field: 'mm/proj', path: '/srv/models/mmproj.gguf' }]).success).toBe(false);
    expect(withCompanions([{ field: 'mm:proj', path: '/srv/models/mmproj.gguf' }]).success).toBe(false);
  });

  it('refuses an empty field name and an empty path', () => {
    expect(withCompanions([{ field: '', path: '/srv/models/mmproj.gguf' }]).success).toBe(false);
    expect(withCompanions([{ field: 'mmproj', path: '' }]).success).toBe(false);
  });

  it('bounds how many companions one instance may carry', () => {
    const entry = (index: number) => ({ field: `companion_${index}`, path: `/srv/models/${index}.gguf` });
    const upTo = (count: number) => Array.from({ length: count }, (_unused, index) => entry(index));

    expect(withCompanions(upTo(MAX_COMPANIONS_PER_INSTANCE)).success).toBe(true);
    expect(withCompanions(upTo(MAX_COMPANIONS_PER_INSTANCE + 1)).success).toBe(false);
  });

  it('bounds a companion path the same way it bounds the weights path', () => {
    const within = `/${'a'.repeat(MAX_MODEL_PATH_LENGTH - 1)}`;

    expect(withCompanions([{ field: 'mmproj', path: within }]).success).toBe(true);
    expect(withCompanions([{ field: 'mmproj', path: `${within}a` }]).success).toBe(false);
  });
});

describe('desiredModelSchema', () => {
  it('states the same shape the estimates in libs/backends read', () => {
    expectTypeOf<DesiredModel>().toEqualTypeOf<IModelMetadata>();
  });
});

describe('instancePinsSchema', () => {
  it('states the same pins the launch rules in libs/backends read', () => {
    expectTypeOf<z.infer<typeof instancePinsSchema>>().toEqualTypeOf<IInstancePins>();
  });
});
