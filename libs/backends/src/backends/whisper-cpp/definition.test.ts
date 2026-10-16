import { describe, expect, it } from 'vitest';

import { BackendOperation, GIB, ImageVariant, imageVariantOf, readinessPasses } from '../../definition';
import { backendFor, renderContainer, resolveBackend } from '../../runtime';
import { buildContainerInput, buildEstimatedModel } from '../../test/container.factory';
import { whisperCppDefinition } from './definition';

const GPU = 'GPU-11111111-2222-3333-4444-555555555555';

const input = buildContainerInput({
  servedModel: 'whisper-large',
  weights: { hostPath: '/srv/models/ggml-large-v3.bin', containerPath: '/models/ggml-large-v3.bin' },
  configuration: { threads: 8, extraFlags: ['--no-fallback'] },
  image: whisperCppDefinition.images[ImageVariant.CUDA],
});

describe('whisperCppDefinition', () => {
  it('resolves against an empty hook registry, since it names no hook', () => {
    expect(() => resolveBackend(whisperCppDefinition, new Map())).not.toThrow();
  });

  it('renders the same container from a fixed input', () => {
    expect(renderContainer(whisperCppDefinition, input)).toMatchSnapshot();
  });

  it('runs the server itself, so the arguments never pass through a shell', () => {
    const specification = renderContainer(whisperCppDefinition, input);

    expect(specification.entrypoint).toEqual(['whisper-server']);
    expect(specification.command.slice(0, 2)).toEqual(['--model', '/models/ggml-large-v3.bin']);
  });

  it('serves transcription at the path passthrough relays to, converting any upload', () => {
    const command = renderContainer(whisperCppDefinition, input).command;

    expect(command).toContain('--convert');
    expect(command[command.indexOf('--inference-path') + 1]).toBe(
      whisperCppDefinition.operations[BackendOperation.TRANSCRIPTION]?.path
    );
  });

  it('names a CPU image for a CPU-only placement and a CUDA image wherever a card is pinned', () => {
    const images = whisperCppDefinition.images;

    expect(images[imageVariantOf({ cpu: true, gpus: [] })]).toMatch(/whisper\.cpp:main-[0-9a-f]{40}$/);
    expect(images[imageVariantOf({ cpu: false, gpus: [GPU] })]).toMatch(/whisper\.cpp:main-cuda-[0-9a-f]{40}$/);
  });

  it('passes the probe once the model is loaded, and not while it loads', () => {
    const probe = whisperCppDefinition.readiness.probe;

    expect(readinessPasses(probe, { status: 200, body: { status: 'ok' } })).toBe(true);
    expect(readinessPasses(probe, { status: 503, body: { status: 'loading model' } })).toBe(false);
  });

  it('sizes Whisper large to the published fp16 figure, so two fit in 12 GiB from the first start', () => {
    const estimate = backendFor(whisperCppDefinition.id).sizeVram({
      model: buildEstimatedModel({ sizeBytes: 3_095_033_483 }),
      companions: [],
      configuration: {},
      deviceCount: 1,
      devices: [{ deviceKey: GPU, totalBytes: 12 * GIB }],
    }).estimate;

    expect(estimate.computed).toBe(true);

    const total = estimate.computed ? estimate.totalBytes : 0;

    expect(total / 1e9).toBeCloseTo(4.5, 1);
    expect(2 * total).toBeLessThan(12 * GIB);
  });
});
