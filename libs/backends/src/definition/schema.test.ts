import { describe, expect, it } from 'vitest';

import { llamaCppDefinition } from '../backends/llama-cpp/definition';
import { vllmOmniDefinition } from '../backends/vllm-omni/definition';
import { vllmDefinition } from '../backends/vllm/definition';
import { LaunchMode } from '../launch';
import { BackendDefinition } from './definition';
import { BackendOperation, StreamDialect } from './operation';
import { IDefinitionIssue, validateDefinition } from './schema';
import { StageSharesLaunch, VramDefinition, VramLaunchKind, VramSource } from './vram';

const issuesOf = (overrides: Partial<BackendDefinition>): readonly unknown[] =>
  validateDefinition({ ...llamaCppDefinition, ...overrides }).issues;

const stageShares = (overrides: Partial<StageSharesLaunch> = {}): VramDefinition => ({
  estimate: { source: VramSource.SIZE, gibField: 'gpuMemoryGib' },
  launch: {
    kind: VramLaunchKind.STAGE_SHARES,
    flag: '--stage-overrides',
    shareKey: 'gpu_memory_utilization',
    architectures: [{ architecture: 'qwen3_tts', shares: [0.3, 0.3] }],
    ...overrides,
  },
});

const issuesOfOmni = (overrides: Partial<BackendDefinition>): readonly IDefinitionIssue[] =>
  validateDefinition({ ...vllmOmniDefinition, ...overrides }).issues;

describe('validateDefinition', () => {
  it('answers the definition it parsed where there is no issue', () => {
    expect(validateDefinition(llamaCppDefinition)).toEqual({ definition: llamaCppDefinition, issues: [] });
  });

  it('names an unknown placeholder by its group and element', () => {
    expect(
      issuesOf({
        argv: [
          ['--model', '{{model_path}}'],
          ['--alias', '{{model}}'],
        ],
      })
    ).toEqual([{ path: 'argv[1][1]', message: '{{model}} is not a placeholder' }]);
  });

  it('names a param naming no declared field, in a launch mode group', () => {
    expect(issuesOf({ launchModeArgv: { [LaunchMode.CPU_ONLY]: [['--ctx', '{{param.ctx}}']] } })).toEqual([
      { path: 'launchModeArgv.cpuOnly[0][1]', message: '{{param.ctx}} names no declared field' },
    ]);
  });

  it.each([
    'NVIDIA_VISIBLE_DEVICES',
    'NVIDIA_DRIVER_CAPABILITIES',
    'CUDA_VISIBLE_DEVICES',
    'HIP_VISIBLE_DEVICES',
    'ROCR_VISIBLE_DEVICES',
  ])('refuses %s, since the agent owns device presentation', name => {
    expect(issuesOf({ environment: { [name]: 'all' } })).toEqual([
      { path: `environment.${name}`, message: "is reserved for the agent's device presentation" },
    ]);
  });

  it('names a placeholder problem in an environment value', () => {
    expect(issuesOf({ environment: { HF_HOME: '{{cache}}' } })).toEqual([
      { path: 'environment.HF_HOME', message: '{{cache}} is not a placeholder' },
    ]);
  });

  it('refuses a placeholder in the entrypoint, which is passed as written', () => {
    expect(issuesOf({ entrypoint: ['/bin/serve', '{{port}}'] })).toEqual([
      { path: 'entrypoint[1]', message: 'is passed as written, so it takes no placeholder' },
    ]);
  });

  it('refuses a configured share read from a field that is not a number', () => {
    expect(issuesOf({ vram: { estimate: { source: VramSource.CONFIGURATION, fractionField: 'flashAttn' } } })).toEqual([
      { path: 'vram.estimate.fractionField', message: 'flashAttn names no declared number field' },
    ]);
  });

  it('refuses a size read from a field not bounded above zero', () => {
    const fields = vllmOmniDefinition.declaration.fields.map(field =>
      field.name === 'gpuMemoryGib' ? { ...field, min: 0 } : field
    );
    const declaration = { ...vllmOmniDefinition.declaration, fields };

    expect(issuesOfOmni({ declaration })).toEqual([
      { path: 'vram.estimate.gibField', message: 'gpuMemoryGib must be bounded above 0' },
    ]);
  });

  it('refuses a stage share above one or a stage list that is empty', () => {
    const vram = stageShares({
      architectures: [
        { architecture: 'qwen3_tts', shares: [1.5] },
        { architecture: 'cosyvoice3', shares: [] },
      ],
    });

    expect(issuesOfOmni({ vram }).map(issue => issue.path)).toEqual([
      'vram.launch.architectures[0].shares[0]',
      'vram.launch.architectures[1].shares',
    ]);
  });

  it('refuses a stage table naming an architecture twice', () => {
    const vram = stageShares({
      architectures: [
        { architecture: 'qwen3_tts', shares: [0.3, 0.3] },
        { architecture: 'qwen3_tts', shares: [0.3] },
      ],
    });

    expect(issuesOfOmni({ vram })).toEqual([
      { path: 'vram.launch.architectures', message: 'names an architecture twice' },
    ]);
  });

  it('refuses a share key that is not a plain snake_case key', () => {
    expect(issuesOfOmni({ vram: stageShares({ shareKey: 'gpu"memory' }) }).map(issue => issue.path)).toEqual([
      'vram.launch.shareKey',
    ]);
  });

  it('refuses a stage share flag that is not a flag', () => {
    expect(issuesOfOmni({ vram: stageShares({ flag: 'stage-overrides' }) }).map(issue => issue.path)).toEqual([
      'vram.launch.flag',
    ]);
  });

  it('refuses stage shares beside an estimate other than a stated size', () => {
    const vram: VramDefinition = { ...stageShares(), estimate: { source: VramSource.NONE } };

    expect(issuesOfOmni({ vram })).toEqual([
      { path: 'vram.launch', message: 'splits a stated size, so it takes a size estimate' },
    ]);
  });

  it('takes no stage share placeholder, since the launch block writes its own flag', () => {
    expect(issuesOfOmni({ argv: [['--stage-overrides', '{{stage_shares}}']] })).toEqual([
      { path: 'argv[0][1]', message: '{{stage_shares}} is not a placeholder' },
    ]);
  });

  it('refuses a voice listing on an operation other than speech', () => {
    const transcription = vllmDefinition.operations[BackendOperation.TRANSCRIPTION];
    const operations = {
      [BackendOperation.TRANSCRIPTION]: transcription && {
        ...transcription,
        voices: { path: '/v1/audio/voices', list: 'voices' },
      },
    };

    expect(validateDefinition({ ...vllmDefinition, operations }).issues).toEqual([
      { path: 'operations.transcription.voices', message: 'is listed for speech alone' },
    ]);
  });

  it('names a field whose group the declaration does not list', () => {
    const declaration = { ...llamaCppDefinition.declaration, groups: [] };

    expect(issuesOf({ declaration })[0]).toEqual({
      path: 'declaration.fields[0].group',
      message: 'container is not a listed group',
    });
  });

  it('names a structural failure by its path', () => {
    expect(validateDefinition({ ...llamaCppDefinition, port: '8080' }).issues.map(issue => issue.path)).toEqual([
      'port',
    ]);
  });

  it('refuses a key the format does not have, so nothing is carried that JSON would drop', () => {
    const issues = validateDefinition({ ...llamaCppDefinition, specifyContainer: () => null }).issues;

    expect(issues.map(issue => issue.path)).toEqual(['']);
    expect(issues[0].message).toContain('specifyContainer');
  });

  it('refuses a definition naming no image', () => {
    expect(issuesOf({ images: {} })).toContainEqual({ path: 'images', message: 'must name a cuda or a cpu image' });
  });

  it('refuses a definition naming only an image no placement selects', () => {
    expect(issuesOf({ images: { rocm: 'engine:rocm' } })).toContainEqual({
      path: 'images',
      message: 'must name a cuda or a cpu image',
    });
  });

  it('refuses an image default other than the one image every variant names', () => {
    const imageIndex = llamaCppDefinition.declaration.fields.findIndex(field => field.name === 'image');

    expect(issuesOf({ images: { cuda: 'engine:cuda', cpu: 'engine:cpu' } })).toEqual([
      {
        path: `declaration.fields[${imageIndex}].default`,
        message: 'must be unset, since no one image serves every placement',
      },
    ]);
  });

  it('refuses a model mount that climbs out with ..', () => {
    expect(issuesOf({ modelMount: '/models/../etc' })).toEqual([
      { path: 'modelMount', message: 'must not climb out with ..' },
    ]);
  });

  it('refuses a weights name that is more than one path segment', () => {
    expect(issuesOf({ weightsName: 'v1_0/../..' })).toEqual([
      { path: 'weightsName', message: 'must be one path segment' },
    ]);
    expect(issuesOf({ weightsName: '.' })).toEqual([{ path: 'weightsName', message: 'must name a file or directory' }]);
    expect(issuesOf({ weightsName: '..' })).toEqual([
      { path: 'weightsName', message: 'must name a file or directory' },
    ]);
  });

  it("refuses a weights name a companion's directory already takes", () => {
    expect(issuesOf({ weightsName: 'mmproj' })).toEqual([
      { path: 'weightsName', message: 'is where the mmproj companion mounts' },
    ]);
  });

  it('refuses an upstream model on a multipart operation, whose form the gateway relays unread', () => {
    const transcription = {
      path: '/v1/audio/transcriptions',
      responseFormats: ['json'],
      streaming: StreamDialect.NONE,
      upstreamModel: 'whisper',
    };

    expect(issuesOf({ operations: { [BackendOperation.TRANSCRIPTION]: transcription } })).toEqual([
      {
        path: 'operations.transcription.upstreamModel',
        message: 'is relayed as a multipart form, which the gateway does not rewrite',
      },
    ]);
  });

  it('refuses a field declared twice', () => {
    const fields = [...llamaCppDefinition.declaration.fields, llamaCppDefinition.declaration.fields[1]];
    const declaration = { ...llamaCppDefinition.declaration, fields };

    expect(issuesOf({ declaration })).toEqual([
      { path: `declaration.fields[${fields.length - 1}].name`, message: 'contextSize is declared twice' },
    ]);
  });

  it('refuses an environment name that is not a variable name', () => {
    const environment = Object.fromEntries([['HF HOME', '/cache']]);

    expect(issuesOf({ environment }).map(issue => (issue as { path: string }).path)).toEqual(['environment.HF HOME']);
  });

  it('refuses a format version this code does not read', () => {
    const issues = validateDefinition({ ...llamaCppDefinition, formatVersion: 2 }).issues;

    expect(issues.map(issue => issue.path)).toEqual(['formatVersion']);
  });

  it('refuses a configured share read from a field not bounded to a share of each card', () => {
    expect(issuesOf({ vram: { estimate: { source: VramSource.CONFIGURATION, fractionField: 'ropeScale' } } })).toEqual([
      { path: 'vram.estimate.fractionField', message: 'ropeScale must be bounded above 0 and to at most 1' },
    ]);
  });
});
