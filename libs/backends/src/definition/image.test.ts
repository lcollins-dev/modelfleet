import { describe, expect, it } from 'vitest';

import { ImageVariant, imageVariantOf, sharedImage } from './image';

describe('imageVariantOf', () => {
  it('takes the CPU image where the placement pins the CPU alone', () => {
    expect(imageVariantOf({ cpu: true, gpus: [] })).toBe(ImageVariant.CPU);
  });

  it('takes the CUDA image wherever a card is pinned, offloading or not', () => {
    expect(imageVariantOf({ cpu: false, gpus: ['GPU-0'] })).toBe(ImageVariant.CUDA);
    expect(imageVariantOf({ cpu: true, gpus: ['GPU-0'] })).toBe(ImageVariant.CUDA);
  });
});

describe('sharedImage', () => {
  it('answers the reference every variant names', () => {
    expect(sharedImage({ cuda: 'llama:server', cpu: 'llama:server' })).toBe('llama:server');
  });

  it('answers nothing where a placement could select a variant the definition lacks', () => {
    expect(sharedImage({ cuda: 'engine:cuda' })).toBeUndefined();
  });

  it('ignores the AMD image, which no placement selects yet', () => {
    expect(sharedImage({ cuda: 'llama:server', cpu: 'llama:server', rocm: 'llama:rocm' })).toBe('llama:server');
  });

  it('answers nothing where the variants differ', () => {
    expect(sharedImage({ cuda: 'llama:server-cuda', cpu: 'llama:server' })).toBeUndefined();
  });
});
