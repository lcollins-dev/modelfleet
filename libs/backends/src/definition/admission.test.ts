import { describe, expect, it } from 'vitest';

import { llamaCppDefinition } from '../backends/llama-cpp/definition';
import { vllmOmniDefinition } from '../backends/vllm-omni/definition';
import { vllmDefinition } from '../backends/vllm/definition';
import { ModelFormat, ModelTask, ProjectorModality } from '../model';
import { ModelRefusal, PinsRefusal, modelRefusals, pinsRefusal, resolveImage, tasksAdmit } from './admission';
import { DevicePresentation, ContainerSettings } from './container';
import { BackendOperation } from './operation';

describe('tasksAdmit', () => {
  it.each([
    [ModelTask.CHAT, BackendOperation.CHAT_COMPLETIONS, true],
    [ModelTask.CHAT, BackendOperation.EMBEDDINGS, false],
    [ModelTask.CHAT, BackendOperation.TRANSCRIPTION, false],
    [ModelTask.EMBEDDING, BackendOperation.EMBEDDINGS, true],
    [ModelTask.EMBEDDING, BackendOperation.CHAT_COMPLETIONS, false],
    [ModelTask.TRANSCRIPTION, BackendOperation.CHAT_COMPLETIONS, false],
    [ModelTask.TRANSCRIPTION, BackendOperation.EMBEDDINGS, false],
    [ModelTask.TRANSCRIPTION, BackendOperation.TRANSCRIPTION, true],
    [ModelTask.TRANSCRIPTION, BackendOperation.TRANSLATION, true],
    [ModelTask.TRANSCRIPTION, BackendOperation.SPEECH, false],
    [ModelTask.SPEECH, BackendOperation.SPEECH, true],
    [ModelTask.SPEECH, BackendOperation.TRANSCRIPTION, false],
    [ModelTask.SPEECH, BackendOperation.CHAT_COMPLETIONS, false],
  ])('answers %s for %s with %s', (task, operation, admitted) => {
    expect(tasksAdmit([task], operation)).toBe(admitted);
  });

  it.each(Object.values(BackendOperation))('admits %s for a model whose tasks are unknown', operation => {
    expect(tasksAdmit([], operation)).toBe(true);
  });

  it('admits what any of several tasks admits, and nothing none of them does', () => {
    const omni = [ModelTask.CHAT, ModelTask.TRANSCRIPTION, ModelTask.SPEECH];

    expect(tasksAdmit(omni, BackendOperation.CHAT_COMPLETIONS)).toBe(true);
    expect(tasksAdmit(omni, BackendOperation.TRANSCRIPTION)).toBe(true);
    expect(tasksAdmit(omni, BackendOperation.SPEECH)).toBe(true);
    expect(tasksAdmit(omni, BackendOperation.EMBEDDINGS)).toBe(false);
  });

  it('adds transcription to the tasks of a model deployed beside an audio projector', () => {
    expect(tasksAdmit([ModelTask.CHAT], BackendOperation.TRANSCRIPTION, [ProjectorModality.AUDIO])).toBe(true);
    expect(tasksAdmit([ModelTask.CHAT], BackendOperation.TRANSLATION, [ProjectorModality.AUDIO])).toBe(true);
    expect(
      tasksAdmit([ModelTask.CHAT], BackendOperation.TRANSCRIPTION, [ProjectorModality.VISION, ProjectorModality.AUDIO])
    ).toBe(true);
  });

  it('adds nothing beside a projector that cannot hear, or for an operation hearing does not give', () => {
    expect(tasksAdmit([ModelTask.CHAT], BackendOperation.TRANSCRIPTION, [ProjectorModality.VISION])).toBe(false);
    expect(tasksAdmit([ModelTask.EMBEDDING], BackendOperation.SPEECH, [ProjectorModality.AUDIO])).toBe(false);
  });
});

const settings = (multiDevice: boolean, cpuOffload: boolean): ContainerSettings => ({
  multiDevice,
  cpuOffload,
  devicePresentation: DevicePresentation.DEVICE_REQUEST,
  stopGraceSeconds: 10,
  sharedMemoryBytes: 0,
});

describe('pinsRefusal', () => {
  it('refuses several cards to a backend that runs on one', () => {
    expect(pinsRefusal(settings(false, true), { cpu: false, gpus: ['GPU-a', 'GPU-b'] })).toBe(
      PinsRefusal.SEVERAL_DEVICES
    );
  });

  it('refuses the CPU beside a card to a backend that cannot offload', () => {
    expect(pinsRefusal(settings(true, false), { cpu: true, gpus: ['GPU-a'] })).toBe(PinsRefusal.CPU_BESIDE_DEVICES);
  });

  it('takes the CPU alone, or one card alone, whatever the backend', () => {
    expect(pinsRefusal(settings(false, false), { cpu: true, gpus: [] })).toBeNull();
    expect(pinsRefusal(settings(false, false), { cpu: false, gpus: ['GPU-a'] })).toBeNull();
  });

  it('takes several cards and the CPU together for a backend that offloads across cards', () => {
    expect(pinsRefusal(settings(true, true), { cpu: true, gpus: ['GPU-a', 'GPU-b'] })).toBeNull();
  });
});

describe('modelRefusals', () => {
  it('refuses a format the backend does not load', () => {
    expect(modelRefusals(vllmDefinition, { format: ModelFormat.GGUF, architecture: null })).toEqual([
      ModelRefusal.FORMAT_NOT_SERVED,
    ]);
  });

  it('refuses an architecture the stage table lacks, or a model with none', () => {
    expect(
      modelRefusals(vllmOmniDefinition, { format: ModelFormat.SAFETENSORS, architecture: 'qwen2_5_omni' })
    ).toEqual([ModelRefusal.STAGES_UNLISTED]);
    expect(modelRefusals(vllmOmniDefinition, { format: ModelFormat.SAFETENSORS, architecture: null })).toEqual([
      ModelRefusal.STAGES_UNLISTED,
    ]);
  });

  it('lists every refusal that applies', () => {
    expect(modelRefusals(vllmOmniDefinition, { format: ModelFormat.GGUF, architecture: 'llama' })).toEqual([
      ModelRefusal.FORMAT_NOT_SERVED,
      ModelRefusal.STAGES_UNLISTED,
    ]);
  });

  it('admits a listed architecture, and any architecture where the backend writes no stage shares', () => {
    expect(modelRefusals(vllmOmniDefinition, { format: ModelFormat.SAFETENSORS, architecture: 'qwen3_tts' })).toEqual(
      []
    );
    expect(modelRefusals(vllmDefinition, { format: ModelFormat.SAFETENSORS, architecture: 'qwen2_5_omni' })).toEqual(
      []
    );
  });
});

describe('resolveImage', () => {
  const cpu = { cpu: true, gpus: [] };
  const card = { cpu: false, gpus: ['GPU-0'] };

  it("takes the document's image wherever it names one", () => {
    expect(resolveImage(vllmOmniDefinition, { image: 'mine:latest' }, cpu)).toBe('mine:latest');
  });

  it("takes the definition's image for the placement's variant where the document names none", () => {
    const images = llamaCppDefinition.images;

    expect(resolveImage(llamaCppDefinition, {}, card)).toBe(images.cuda);
    expect(resolveImage(llamaCppDefinition, { image: '' }, cpu)).toBe(images.cpu);
    expect(resolveImage(llamaCppDefinition, { image: null }, cpu)).toBe(images.cpu);
  });

  it('answers nothing where neither names an image for the variant', () => {
    expect(resolveImage(vllmOmniDefinition, {}, cpu)).toBeNull();
  });
});
