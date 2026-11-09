import { describe, expect, it } from 'vitest';

import {
  BackendFieldType,
  EXTRA_FLAGS_FIELD,
  IMAGE_FIELD,
  backendField,
  declarationIssues,
  modelReferenceFields,
  validateConfiguration,
} from '../../configuration';
import { ModelType } from '../../model';
import { declaredArguments } from '../../runtime';
import { llamaCppDeclaration } from './declaration';

const FINGERPRINT = 'a'.repeat(64);

describe('llamaCppDeclaration', () => {
  it('covers the flags the configuration form offers', () => {
    const names = llamaCppDeclaration.fields.map(field => field.name);

    expect(names).toEqual([
      'image',
      'contextSize',
      'batchSize',
      'ubatchSize',
      'parallel',
      'cpuMoe',
      'cpuMoeLayers',
      'tensorOverrides',
      'splitMode',
      'tensorSplit',
      'flashAttn',
      'cacheTypeK',
      'cacheTypeV',
      'noKvOffload',
      'loadMode',
      'lazyMode',
      'promptCache',
      'threads',
      'threadsBatch',
      'numa',
      'ropeScaling',
      'ropeScale',
      'ropeFreqBase',
      'ropeFreqScale',
      'mmproj',
      'draftModel',
      'speculativeType',
      'draftTokens',
      'contBatching',
      'jinja',
      'chatTemplate',
      'embeddings',
      'reranking',
      'pooling',
      'metrics',
      'extraFlags',
    ]);
  });

  it("names the backend's own flag for every field passed as one argument", () => {
    const withoutFlag = llamaCppDeclaration.fields.filter(field => field.flag === undefined);

    expect(withoutFlag.map(field => field.name)).toEqual([IMAGE_FIELD, EXTRA_FLAGS_FIELD]);
  });

  it('carries an off flag for every setting the backend defaults to on', () => {
    expect(backendField(llamaCppDeclaration, 'contBatching')).toMatchObject({
      flag: '--cont-batching',
      offFlag: '--no-cont-batching',
    });
    expect(backendField(llamaCppDeclaration, 'jinja')).toMatchObject({
      flag: '--jinja',
      offFlag: '--no-jinja',
      default: true,
    });
  });

  it('declares a default only where Modelfleet depends on the value, leaving the rest to the image', () => {
    const declared = llamaCppDeclaration.fields.filter(field => field.default !== undefined);

    expect(declared.map(field => field.name)).toEqual([
      'contextSize',
      'ubatchSize',
      'parallel',
      'cacheTypeK',
      'cacheTypeV',
      'jinja',
    ]);
  });

  it('launches an untouched document with the declared defaults alone', () => {
    expect(declaredArguments(llamaCppDeclaration, {})).toEqual([
      '--ctx-size',
      '4096',
      '--ubatch-size',
      '512',
      '--parallel',
      '1',
      '--cache-type-k',
      'f16',
      '--cache-type-v',
      'f16',
      '--jinja',
    ]);
  });

  it('declares no boolean default that would reach the backend as nothing', () => {
    const silent = llamaCppDeclaration.fields.filter(
      field => field.type === BackendFieldType.BOOLEAN && field.offFlag === undefined && field.default === false
    );

    expect(silent).toEqual([]);
  });

  it('takes the tensor split as a list, so it is overridden whole', () => {
    expect(backendField(llamaCppDeclaration, 'tensorSplit')?.type).toBe(BackendFieldType.NUMBER_LIST);
  });

  it('writes the tensor overrides as the one comma-separated list llama.cpp takes', () => {
    const tensorOverrides = ['per_layer_token_embd.weight=CPU', 'blk\\.0\\.=CUDA1'];
    const args = declaredArguments(llamaCppDeclaration, { tensorOverrides });
    const at = args.indexOf('--override-tensor');

    expect(args.slice(at, at + 2)).toEqual(['--override-tensor', 'per_layer_token_embd.weight=CPU,blk\\.0\\.=CUDA1']);
  });

  it('takes the projector as a reference to a catalogued projector, not a path', () => {
    expect(backendField(llamaCppDeclaration, 'mmproj')).toMatchObject({
      flag: '--mmproj',
      type: BackendFieldType.MODEL_REFERENCE,
      modelType: ModelType.PROJECTOR,
    });
  });

  it('names every model reference field so the agent protocol can carry it', () => {
    const names = modelReferenceFields(llamaCppDeclaration).map(field => field.name);

    expect(names).not.toEqual([]);

    for (const name of names) {
      expect(name).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it('accepts a fingerprint for the projector and refuses anything else', () => {
    expect(validateConfiguration(llamaCppDeclaration, { mmproj: FINGERPRINT }).valid).toBe(true);
    expect(validateConfiguration(llamaCppDeclaration, { mmproj: null }).valid).toBe(true);

    expect(
      validateConfiguration(llamaCppDeclaration, { mmproj: '/models/mmproj-F16.gguf' }).issues.map(issue => issue.field)
    ).toEqual(['mmproj']);
  });

  it('validates a document a user would write', () => {
    const result = validateConfiguration(llamaCppDeclaration, {
      contextSize: 32768,
      splitMode: 'tensor',
      tensorSplit: [0.5, 0.5],
      cacheTypeK: 'iq4_nl',
      cacheTypeV: 'q8_0',
      flashAttn: 'on',
      loadMode: 'mmap+mlock',
      jinja: true,
      extraFlags: ['--no-warmup'],
    });

    expect(result.valid).toBe(true);
    expect(result.unmodelledFields).toEqual([]);
  });

  it('reports the field and the reason where a document is wrong', () => {
    const result = validateConfiguration(llamaCppDeclaration, { contextSize: -1, cacheTypeK: 'q3_0' });

    expect(result.issues.map(issue => `${issue.field}: ${issue.reason}`)).toEqual([
      'contextSize: belowMinimum',
      'cacheTypeK: notAChoice',
    ]);
  });

  it('offers the three lazy modes and declares no default, so an unset field reaches the backend as its own', () => {
    expect(backendField(llamaCppDeclaration, 'lazyMode')).toMatchObject({
      flag: '--lazy-mode',
      group: 'memory',
      type: BackendFieldType.CHOICE,
      choices: ['auto', 'on', 'off'],
    });
    expect(backendField(llamaCppDeclaration, 'lazyMode')?.default).toBeUndefined();
  });

  it('passes the lazy mode the estimate reads', () => {
    expect(declaredArguments(llamaCppDeclaration, { lazyMode: 'off' })).toEqual(
      expect.arrayContaining(['--lazy-mode', 'off'])
    );
  });

  it('explains tensor-mode memory requirements and default GPU shares', () => {
    const description = backendField(llamaCppDeclaration, 'splitMode')?.description ?? '';

    expect(description).toContain('disables automatic fitting');
    expect(description).toContain('whole model must fit in VRAM');
    expect(description).toContain('divided equally unless you set Tensor split');
  });

  it('declares the prompt cache in MiB with no default, so an unset field passes no flag', () => {
    expect(backendField(llamaCppDeclaration, 'promptCache')).toMatchObject({
      flag: '--cache-ram',
      group: 'memory',
      type: BackendFieldType.INTEGER,
      min: 0,
    });
    expect(backendField(llamaCppDeclaration, 'promptCache')?.default).toBeUndefined();
    expect(declaredArguments(llamaCppDeclaration, {})).not.toContain('--cache-ram');
  });

  it.each([
    [2048, '2048'],
    [0, '0'],
  ])('passes a prompt cache of %d MiB', (promptCache, argument) => {
    expect(declaredArguments(llamaCppDeclaration, { promptCache })).toEqual(
      expect.arrayContaining(['--cache-ram', argument])
    );
  });

  it('refuses a negative prompt cache, which llama.cpp reads as no byte limit', () => {
    const result = validateConfiguration(llamaCppDeclaration, { promptCache: -1 });

    expect(result.issues.map(issue => issue.field)).toEqual(['promptCache']);
  });

  it('refuses a lazy mode the backend does not take', () => {
    const result = validateConfiguration(llamaCppDeclaration, { lazyMode: 'sometimes' });

    expect(result.issues.map(issue => `${issue.field}: ${issue.reason}`)).toEqual(['lazyMode: notAChoice']);
  });

  it('takes the draft model as a reference to a catalogued draft', () => {
    expect(backendField(llamaCppDeclaration, 'draftModel')).toMatchObject({
      flag: '--spec-draft-model',
      type: BackendFieldType.MODEL_REFERENCE,
      modelType: ModelType.DRAFT,
    });
  });

  it('offers the purpose-built speculative types and no draft-simple', () => {
    expect(backendField(llamaCppDeclaration, 'speculativeType')).toMatchObject({
      flag: '--spec-type',
      type: BackendFieldType.CHOICE,
      choices: ['draft-mtp', 'draft-dflash', 'draft-dspark', 'draft-eagle3'],
    });
  });

  it('launches a draft from its mounted path, with its type and token limit as set', () => {
    const companions = new Map([['draftModel', '/models/draftModel/dspark.gguf']]);
    const args = declaredArguments(
      llamaCppDeclaration,
      { draftModel: FINGERPRINT, speculativeType: 'draft-dspark', draftTokens: 16 },
      companions
    );

    expect(args).toEqual(
      expect.arrayContaining([
        '--spec-draft-model',
        '/models/draftModel/dspark.gguf',
        '--spec-type',
        'draft-dspark',
        '--spec-draft-n-max',
        '16',
      ])
    );
  });

  it('passes a speculative type with no draft named, since MTP can run from the main model', () => {
    expect(declaredArguments(llamaCppDeclaration, { speculativeType: 'draft-mtp' })).toEqual(
      expect.arrayContaining(['--spec-type', 'draft-mtp'])
    );
  });

  it('requires a dflash file for the two types llama.cpp aborts on otherwise', () => {
    expect(llamaCppDeclaration.referenceRequirements).toEqual([
      {
        choiceField: 'speculativeType',
        choices: ['draft-dflash', 'draft-dspark'],
        referenceField: 'draftModel',
        architecture: 'dflash',
      },
    ]);
  });

  it('declares a requirement over fields it holds', () => {
    expect(declarationIssues(llamaCppDeclaration)).toEqual([]);
    expect(
      declarationIssues({
        ...llamaCppDeclaration,
        referenceRequirements: [
          { choiceField: 'nope', choices: ['a'], referenceField: 'draftModel', architecture: 'dflash' },
        ],
      })
    ).toEqual([{ path: ['referenceRequirements', 0, 'choiceField'], message: 'nope is not a field' }]);
  });

  it('refuses a row split, which the CUDA build no longer loads', () => {
    const result = validateConfiguration(llamaCppDeclaration, { splitMode: 'row' });

    expect(result.issues.map(issue => `${issue.field}: ${issue.reason}`)).toEqual(['splitMode: notAChoice']);
  });
});
