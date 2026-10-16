import { describe, expect, it } from 'vitest';

import { BackendId } from '../../backend-id';
import { GIB } from '../../definition';
import { EstimateBasis, backendFor, renderContainer } from '../../runtime';
import { buildContainerInput, buildEstimatedModel } from '../../test/container.factory';
import { vllmDefinition } from './definition';

const FIRST_GPU = 'GPU-11111111-2222-3333-4444-555555555555';
const SECOND_GPU = 'GPU-66666666-7777-8888-9999-000000000000';

const whisperInput = buildContainerInput({
  servedModel: 'whisper',
  weights: {
    hostPath: '/srv/models/huggingface/openai/whisper-large-v3',
    containerPath: '/models/whisper-large-v3',
  },
  configuration: {},
  pins: { cpu: false, gpus: [FIRST_GPU, SECOND_GPU] },
  image: 'vllm/vllm-openai:v0.31.0',
});

describe('vllmDefinition', () => {
  it('renders the same container from a fixed input', () => {
    expect(renderContainer(vllmDefinition, whisperInput)).toMatchSnapshot();
  });

  it('shards the model across every pinned card', () => {
    const command = renderContainer(vllmDefinition, whisperInput).command;

    expect(command[command.indexOf('--tensor-parallel-size') + 1]).toBe('2');
  });

  it('passes no tensor parallel size where no card is pinned', () => {
    const command = renderContainer(vllmDefinition, { ...whisperInput, pins: { cpu: true, gpus: [] } }).command;

    expect(command).not.toContain('--tensor-parallel-size');
  });

  it('passes its declared memory share on every launch', () => {
    const command = renderContainer(vllmDefinition, whisperInput).command;

    expect(command[command.indexOf('--gpu-memory-utilization') + 1]).toBe('0.92');
  });

  it('runs offline, so a missing file fails the launch rather than downloading', () => {
    expect(renderContainer(vllmDefinition, whisperInput).environment).toMatchObject({ HF_HUB_OFFLINE: '1' });
  });

  it('is sized by its memory share of each pinned card', () => {
    const estimate = backendFor(BackendId.VLLM).sizeVram({
      model: buildEstimatedModel(),
      companions: [],
      configuration: { gpuMemoryUtilization: 0.25 },
      deviceCount: 2,
      devices: [
        { deviceKey: FIRST_GPU, totalBytes: 24 * GIB },
        { deviceKey: SECOND_GPU, totalBytes: 48 * GIB },
      ],
    }).estimate;

    expect(estimate).toMatchObject({ computed: true, basis: EstimateBasis.CONFIGURATION, totalBytes: 18 * GIB });
  });
});
