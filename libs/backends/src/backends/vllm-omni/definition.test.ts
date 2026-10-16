import { describe, expect, it } from 'vitest';

import { BackendId } from '../../backend-id';
import { BackendOperation, GIB, readinessPasses } from '../../definition';
import { EstimateBasis, IContainerInput, backendFor, renderContainer, resolveBackend } from '../../runtime';
import { buildContainerInput, buildEstimatedModel, buildModelMetadata } from '../../test/container.factory';
import { vllmOmniDefinition } from './definition';

const GPU = 'GPU-11111111-2222-3333-4444-555555555555';

const SHARE_KEY = 'gpu_memory_utilization';

const qwenInput = buildContainerInput({
  servedModel: 'qwen-tts',
  model: buildModelMetadata({ architecture: 'qwen3_tts' }),
  weights: {
    hostPath: '/srv/models/huggingface/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    containerPath: '/models/Qwen3-TTS-12Hz-0.6B-CustomVoice',
  },
  configuration: {},
  pins: { cpu: false, gpus: [GPU] },
  gpuTotalBytes: new Map([[GPU, 24 * GIB]]),
  image: 'vllm/vllm-omni:v0.30.0',
});

const stageOverrides = (input: IContainerInput): unknown => {
  const command = renderContainer(vllmOmniDefinition, input).command;
  const index = command.indexOf('--stage-overrides');

  return index === -1 ? undefined : JSON.parse(command[index + 1]);
};

const architectureInput = (architecture: string, configuration: Record<string, unknown> = {}): IContainerInput => ({
  ...qwenInput,
  model: buildModelMetadata({ architecture }),
  configuration,
});

describe('vllmOmniDefinition', () => {
  it('resolves against an empty hook registry, since it names no hook', () => {
    expect(() => resolveBackend(vllmOmniDefinition, new Map())).not.toThrow();
  });

  it('renders the same container from a fixed input', () => {
    expect(renderContainer(vllmOmniDefinition, qwenInput)).toMatchSnapshot();
  });

  it('starts vllm serve itself, since the image clears the entrypoint, in its multi-stage mode', () => {
    const specification = renderContainer(vllmOmniDefinition, qwenInput);

    expect(specification.entrypoint).toEqual(['vllm', 'serve']);
    expect(specification.command.slice(0, 2)).toEqual(['/models/Qwen3-TTS-12Hz-0.6B-CustomVoice', '--omni']);
  });

  it('answers under the deployment name, so a request needs no model rewrite', () => {
    const command = renderContainer(vllmOmniDefinition, qwenInput).command;

    expect(command[command.indexOf('--served-model-name') + 1]).toBe('qwen-tts');
    expect(vllmOmniDefinition.operations[BackendOperation.SPEECH]?.upstreamModel).toBeUndefined();
  });

  it("gives Qwen3-TTS's two stages the same share, its default 12 GiB being half of a 24 GiB card", () => {
    expect(stageOverrides(qwenInput)).toEqual({
      0: { [SHARE_KEY]: 0.25 },
      1: { [SHARE_KEY]: 0.25 },
    });
  });

  it("splits the size in the proportions the pipeline's own config gives its stages", () => {
    expect(stageOverrides(architectureInput('cosyvoice3', { gpuMemoryGib: 12 }))).toEqual({
      0: { [SHARE_KEY]: 0.3333 },
      1: { [SHARE_KEY]: 0.1666 },
    });
  });

  it('scales the fraction to the card the instance landed on', () => {
    const input = { ...qwenInput, gpuTotalBytes: new Map([[GPU, 48 * GIB]]) };

    expect(stageOverrides(input)).toEqual({
      0: { [SHARE_KEY]: 0.125 },
      1: { [SHARE_KEY]: 0.125 },
    });
  });

  it('never passes the flag vLLM-Omni would hand every stage alike', () => {
    expect(renderContainer(vllmOmniDefinition, qwenInput).command).not.toContain('--gpu-memory-utilization');
  });

  it("passes no overrides where the document states no size, leaving the pipeline its config's own shares", () => {
    expect(stageOverrides({ ...qwenInput, configuration: { gpuMemoryGib: null } })).toBeUndefined();
  });

  it('refuses to launch a model whose architecture the table lacks, naming it, even with no size stated', () => {
    expect(() => renderContainer(vllmOmniDefinition, architectureInput('qwen2_5_omni'))).toThrow('qwen2_5_omni');
    expect(() =>
      renderContainer(vllmOmniDefinition, architectureInput('qwen2_5_omni', { gpuMemoryGib: null }))
    ).toThrow('qwen2_5_omni');
  });

  it('refuses to launch on a card it has no total for, naming the card', () => {
    expect(() => renderContainer(vllmOmniDefinition, { ...qwenInput, gpuTotalBytes: new Map() })).toThrow(GPU);
  });

  it('lists every stage share within one card, each pipeline together on one card', () => {
    const architectures = vllmOmniDefinition.vram.launch?.architectures ?? [];

    for (const entry of architectures) {
      expect(entry.shares.reduce((total, share) => total + share, 0)).toBeLessThanOrEqual(1);
    }

    expect(architectures.map(entry => entry.architecture)).toContain('qwen3_tts');
  });

  it('runs offline, so a missing file fails the launch rather than downloading', () => {
    expect(renderContainer(vllmOmniDefinition, qwenInput).environment).toMatchObject({ HF_HUB_OFFLINE: '1' });
  });

  it('refuses aac, which vLLM-Omni cannot write', () => {
    expect(vllmOmniDefinition.operations[BackendOperation.SPEECH]?.responseFormats).not.toContain('aac');
  });

  it('passes the probe on any 200, since it listens only once every stage is up', () => {
    expect(readinessPasses(vllmOmniDefinition.readiness.probe, { status: 200, body: undefined })).toBe(true);
    expect(readinessPasses(vllmOmniDefinition.readiness.probe, { status: 503, body: undefined })).toBe(false);
  });

  it('is sized at the GiB it states, whatever the card', () => {
    const estimate = backendFor(BackendId.VLLM_OMNI).sizeVram({
      model: buildEstimatedModel(),
      companions: [],
      configuration: { gpuMemoryGib: 10 },
      deviceCount: 1,
      devices: [{ deviceKey: GPU, totalBytes: 80 * GIB }],
    }).estimate;

    expect(estimate).toMatchObject({ computed: true, basis: EstimateBasis.CONFIGURATION, totalBytes: 10 * GIB });
  });
});
