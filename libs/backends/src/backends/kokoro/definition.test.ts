import { describe, expect, it } from 'vitest';

import { GIB, ImageVariant, imageVariantOf, readinessPasses } from '../../definition';
import { backendFor, renderContainer, resolveBackend } from '../../runtime';
import { buildContainerInput, buildEstimatedModel } from '../../test/container.factory';
import { kokoroDefinition } from './definition';

const GPU = 'GPU-11111111-2222-3333-4444-555555555555';

const input = buildContainerInput({
  servedModel: 'kokoro-voice',
  weights: { hostPath: '/srv/models/Kokoro-82M', containerPath: '/models/v1_0' },
  configuration: {},
  image: kokoroDefinition.images[ImageVariant.CUDA],
});

describe('kokoroDefinition', () => {
  it('resolves against an empty hook registry, since it names no hook', () => {
    expect(() => resolveBackend(kokoroDefinition, new Map())).not.toThrow();
  });

  it('renders the same container from a fixed input', () => {
    expect(renderContainer(kokoroDefinition, input)).toMatchSnapshot();
  });

  it('keeps automatic unloading off, so the ledger figure holds while idle', () => {
    expect(renderContainer(kokoroDefinition, input).environment.MODEL_AUTO_UNLOAD_TIMEOUT_SECONDS).toBe('0');
  });

  it('reads the weights from the mount rather than fetching them', () => {
    const environment = renderContainer(kokoroDefinition, input).environment;

    expect(environment.DOWNLOAD_MODEL).toBe('false');
    expect(environment.MODEL_DIR).toBe(kokoroDefinition.modelMount);
    expect(kokoroDefinition.weightsName).toBe('v1_0');
  });

  it('names a CPU image for a CPU-only placement and a CUDA image wherever a card is pinned', () => {
    const images = kokoroDefinition.images;

    expect(images[imageVariantOf({ cpu: true, gpus: [] })]).toBe('ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0');
    expect(images[imageVariantOf({ cpu: false, gpus: [GPU] })]).toBe('ghcr.io/remsky/kokoro-fastapi-gpu:v0.9.0');
  });

  it('passes the probe on a healthy answer alone', () => {
    const probe = kokoroDefinition.readiness.probe;

    expect(readinessPasses(probe, { status: 200, body: { status: 'healthy' } })).toBe(true);
    expect(readinessPasses(probe, { status: 200, body: undefined })).toBe(false);
  });

  it('sizes the published checkpoint inside its 3-4 GB peak, so two fit in 8 GiB from the first start', () => {
    const estimate = backendFor(kokoroDefinition.id).sizeVram({
      model: buildEstimatedModel({ sizeBytes: 327_212_226 }),
      companions: [],
      configuration: {},
      deviceCount: 1,
      devices: [{ deviceKey: GPU, totalBytes: 8 * GIB }],
    }).estimate;

    expect(estimate.computed).toBe(true);

    const total = estimate.computed ? estimate.totalBytes : 0;

    expect(total / 1e9).toBeGreaterThan(3);
    expect(total / 1e9).toBeLessThan(4);
    expect(2 * total).toBeLessThan(8 * GIB);
  });
});
