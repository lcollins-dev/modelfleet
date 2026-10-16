import { describe, expect, it } from 'vitest';

import { llamaCppDefinition } from '../backends/llama-cpp/definition';
import { BackendDefinition } from '../definition';
import { buildContainerInput } from '../test/container.factory';
import { renderContainer } from './render';
import { BACKEND_LABEL, INSTANCE_LABEL } from './specification';

const GPUS = ['GPU-bbbbbbbb-0000-0000-0000-000000000000', 'GPU-aaaaaaaa-0000-0000-0000-000000000000'];

const FINGERPRINT = 'a'.repeat(64);

const MMPROJ = {
  field: 'mmproj',
  hostPath: '/srv/models/mmproj-F16.gguf',
  containerPath: '/models/mmproj/mmproj-F16.gguf',
};

const definitionWith = (overrides: Partial<BackendDefinition>): BackendDefinition => ({
  ...llamaCppDefinition,
  argv: [],
  launchModeArgv: {},
  ...overrides,
});

const leadingArguments = (definition: BackendDefinition, input = buildContainerInput()): readonly string[] => {
  const command = renderContainer(definition, input).command;

  return command.slice(0, command.indexOf('--ctx-size'));
};

describe('renderContainer', () => {
  it('keeps a deployment name holding a space and a placeholder as exactly one element', () => {
    const command = renderContainer(llamaCppDefinition, buildContainerInput({ servedModel: 'a b {{port}}' })).command;

    expect(command[command.indexOf('--alias') + 1]).toBe('a b {{port}}');
    expect(command.filter(element => element.includes('{{port}}'))).toEqual(['a b {{port}}']);
  });

  it('drops a whole group where any placeholder in it has no value', () => {
    const definition = definitionWith({
      argv: [
        ['--port', '{{port}}'],
        ['--devices', '{{gpu_ids}}', '--tp', '{{gpu_count}}'],
      ],
    });

    expect(leadingArguments(definition, buildContainerInput({ pins: { cpu: true, gpus: [] } }))).toEqual([
      '--port',
      '8080',
    ]);
  });

  it('fills the pinned cards in pin order, and how many there are', () => {
    const definition = definitionWith({ argv: [['--devices', '{{gpu_ids}}', '--tp', '{{gpu_count}}']] });

    expect(leadingArguments(definition, buildContainerInput({ pins: { cpu: false, gpus: GPUS } }))).toEqual([
      '--devices',
      GPUS.join(','),
      '--tp',
      '2',
    ]);
  });

  it("fills a param with the field's value, its default where the document sets none", () => {
    const definition = definitionWith({ argv: [['--ctx', '{{param.contextSize}}', '--templates', '{{param.jinja}}']] });

    expect(leadingArguments(definition, buildContainerInput({ configuration: {} }))).toEqual([
      '--ctx',
      '4096',
      '--templates',
      'true',
    ]);
  });

  it('drops a param group where the field has neither a value nor a default', () => {
    const definition = definitionWith({ argv: [['--threads', '{{param.threads}}']] });

    expect(leadingArguments(definition)).toEqual([]);
  });

  it('fills a companion with its container path, and drops the group where the document names none', () => {
    const definition = definitionWith({ argv: [['--projector', '{{companion.mmproj}}']] });
    const named = buildContainerInput({ companions: [MMPROJ], configuration: { mmproj: FINGERPRINT } });

    expect(leadingArguments(definition, named)).toEqual(['--projector', MMPROJ.containerPath]);
    expect(leadingArguments(definition)).toEqual([]);
  });

  it('fills the environment, leaving a variable whose placeholder has no value unset', () => {
    const definition = definitionWith({
      environment: { HF_HUB_OFFLINE: '1', SERVED: '{{served_model}}', DEVICES: '{{gpu_ids}}' },
    });
    const input = buildContainerInput({ servedModel: 'chat', pins: { cpu: true, gpus: [] } });

    expect(renderContainer(definition, input).environment).toEqual({ HF_HUB_OFFLINE: '1', SERVED: 'chat' });
  });

  it("replaces the image's entrypoint only where the definition names one", () => {
    const entrypoint = ['/usr/bin/server'];

    expect(renderContainer(definitionWith({ entrypoint }), buildContainerInput()).entrypoint).toEqual(entrypoint);
    expect(renderContainer(llamaCppDefinition, buildContainerInput())).not.toHaveProperty('entrypoint');
  });

  it('runs the image it is given', () => {
    expect(renderContainer(llamaCppDefinition, buildContainerInput({ image: 'engine:pinned' })).image).toBe(
      'engine:pinned'
    );
  });

  it('requests exactly the placement devices in pin order, mounts every file read-only and labels for adoption', () => {
    const input = buildContainerInput({
      instanceKey: 'inst_42',
      pins: { cpu: false, gpus: GPUS },
      companions: [MMPROJ],
    });
    const specification = renderContainer(llamaCppDefinition, input);

    expect(specification.devices).toEqual(GPUS.map(deviceKey => ({ deviceKey })));
    expect(specification.mounts).toEqual(
      [input.weights, MMPROJ].map(file => ({
        hostPath: file.hostPath,
        containerPath: file.containerPath,
        readOnly: true,
      }))
    );
    expect(specification.labels).toEqual({ [INSTANCE_LABEL]: 'inst_42', [BACKEND_LABEL]: 'llama.cpp' });
    expect(specification.port).toBe(llamaCppDefinition.port);
  });
});
