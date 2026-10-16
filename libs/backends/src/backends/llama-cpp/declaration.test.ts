import { describe, expect, it } from 'vitest';

import {
  BackendFieldType,
  EXTRA_FLAGS_FIELD,
  IMAGE_FIELD,
  backendField,
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
      'threads',
      'threadsBatch',
      'numa',
      'ropeScaling',
      'ropeScale',
      'ropeFreqBase',
      'ropeFreqScale',
      'mmproj',
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
      IMAGE_FIELD,
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
});
