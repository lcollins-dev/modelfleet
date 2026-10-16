import { describe, expect, it } from 'vitest';

import { BackendId } from '../backend-id';
import { llamaCppDefinition } from '../backends/llama-cpp/definition';
import {
  BackendField,
  BackendFieldType,
  CONFIGURATION_SCHEMA_VERSION,
  EXTRA_FLAGS_FIELD,
  IMAGE_FIELD,
  backendField,
  validateConfiguration,
} from '../configuration';
import {
  BackendOperation,
  GIB,
  BackendDefinition,
  StreamDialect,
  VramSource,
  sharedImage,
  validateDefinition,
} from '../definition';
import { backendDefinitions, declarationFor, definitionFor } from '../definitions';
import { buildEstimatedModel } from '../test/container.factory';
import { EstimateBasis, EstimateInputSource } from './estimate';
import { BackendHook, HookKind, HookRegistry } from './hooks';
import { backendErrorFrom } from './mapping';
import { backendFor, backendHooks, hookIssues, mergeHooks, resolveBackend } from './registry';
import { VramSizingHook } from './sizing';

const size: VramSizingHook = (input, declaration) => ({
  estimate: {
    computed: false,
    missing: [{ source: EstimateInputSource.CONFIGURATION, field: declaration.fields.at(-1)?.name ?? '' }],
  },
  cardShares: input.devices.map(() => GIB),
});

const sizer: BackendHook = { kind: HookKind.SIZING, size };

const chatMapping: BackendHook = {
  kind: HookKind.MAPPING,
  operation: BackendOperation.CHAT_COMPLETIONS,
  mapping: { request: request => request, response: () => ({}) as never, chunk: () => ({}) as never },
};

const chat = { path: '/v1/chat/completions', responseFormats: null, streaming: StreamDialect.NONE };

const passthrough = (overrides: Partial<BackendDefinition> = {}): BackendDefinition => ({
  ...llamaCppDefinition,
  operations: { [BackendOperation.CHAT_COMPLETIONS]: chat },
  vram: { estimate: { source: VramSource.NONE } },
  ...overrides,
});

const estimateInput = {
  model: buildEstimatedModel({ sizeBytes: 2 * GIB }),
  companions: [{ field: 'mmproj', sizeBytes: GIB }],
  configuration: { fraction: 0.5 },
  deviceCount: 1,
  devices: [{ deviceKey: 'GPU-0', totalBytes: 24 * GIB }],
};

describe('backendFor', () => {
  it('resolves the registered definition with its hooks', () => {
    const backend = backendFor(BackendId.LLAMA_CPP);

    expect(backend.definition).toBe(llamaCppDefinition);
    expect(backend.mapping.chatCompletions).toBeDefined();
    expect(backend.mapping.embeddings).toBeDefined();
    expect(backend.mapping.transcription).toBeDefined();
    expect(backend.mapping.speech).toBeUndefined();
  });

  it('reaches the declaration through the definition', () => {
    expect(declarationFor(BackendId.LLAMA_CPP)).toBe(definitionFor(BackendId.LLAMA_CPP).declaration);
  });
});

describe('hookIssues', () => {
  it('names an unregistered sizing hook by its path', () => {
    const definition = passthrough({ vram: { estimate: { source: VramSource.HOOK, hook: 'nowhere/size' } } });

    expect(hookIssues(definition, new Map())).toEqual([
      { path: 'vram.estimate.hook', message: 'nowhere/size is not a registered hook' },
    ]);
  });

  it('names a mapping hook given as the sizing hook', () => {
    const hooks: HookRegistry = new Map<string, BackendHook>([['x/chat', chatMapping]]);
    const definition = passthrough({ vram: { estimate: { source: VramSource.HOOK, hook: 'x/chat' } } });

    expect(hookIssues(definition, hooks)).toEqual([
      { path: 'vram.estimate.hook', message: 'x/chat is not a sizing hook' },
    ]);
  });

  it('names an unregistered mapping under its operation', () => {
    const operations = { [BackendOperation.EMBEDDINGS]: { ...chat, path: '/v1/embeddings', mapping: 'x/embed' } };

    expect(hookIssues(passthrough({ operations }), new Map())).toEqual([
      { path: 'operations.embeddings.mapping', message: 'x/embed is not a registered hook' },
    ]);
  });

  it('names a mapping registered for another operation, and a sizing hook named as a mapping', () => {
    const hooks: HookRegistry = new Map<string, BackendHook>([
      ['x/chat', chatMapping],
      ['x/size', sizer],
    ]);
    const operations = {
      [BackendOperation.CHAT_COMPLETIONS]: { ...chat, mapping: 'x/size' },
      [BackendOperation.EMBEDDINGS]: { ...chat, path: '/v1/embeddings', mapping: 'x/chat' },
    };

    expect(hookIssues(passthrough({ operations }), hooks)).toEqual([
      { path: 'operations.chatCompletions.mapping', message: 'x/size is not a mapping hook' },
      { path: 'operations.embeddings.mapping', message: 'x/chat maps chatCompletions, not embeddings' },
    ]);
  });
});

describe('mergeHooks', () => {
  it('refuses a name two modules register', () => {
    const one: HookRegistry = new Map<string, BackendHook>([['x/size', sizer]]);

    expect(() => mergeHooks([one, one])).toThrow('The hook x/size is registered twice');
  });
});

describe('resolveBackend', () => {
  it('refuses a definition whose hook does not resolve, naming it', () => {
    const definition = passthrough({ vram: { estimate: { source: VramSource.HOOK, hook: 'nowhere/size' } } });

    expect(() => resolveBackend(definition, new Map())).toThrow(
      'vram.estimate.hook nowhere/size is not a registered hook'
    );
  });

  it('refuses a definition the schema refuses, naming the path', () => {
    const definition = passthrough({ environment: { CUDA_VISIBLE_DEVICES: '0' } });

    expect(() => resolveBackend(definition, new Map())).toThrow('environment.CUDA_VISIBLE_DEVICES is reserved');
  });

  it('relays an operation with no mapping hook as bytes, and maps its failures all the same', () => {
    const backend = resolveBackend(passthrough(), new Map());

    expect(backend.mapping.chatCompletions).toBeUndefined();
    expect(backend.mapping.error(502, 'Bad gateway')).toEqual(backendErrorFrom(502, 'Bad gateway'));
  });

  it('sizes nothing where the definition declares no estimate', () => {
    expect(resolveBackend(passthrough(), new Map()).sizeVram(estimateInput)).toEqual({
      estimate: { computed: false, missing: [] },
      cardShares: null,
    });
  });

  it('sizes by the configured share where the definition declares one', () => {
    const fraction: BackendField = {
      name: 'fraction',
      label: 'Fraction',
      description: '',
      group: 'advanced',
      type: BackendFieldType.NUMBER,
      min: 0.05,
      max: 1,
    };
    const declaration = {
      ...llamaCppDefinition.declaration,
      fields: [...llamaCppDefinition.declaration.fields, fraction],
    };
    const backend = resolveBackend(
      passthrough({ declaration, vram: { estimate: { source: VramSource.CONFIGURATION, fractionField: 'fraction' } } }),
      new Map()
    );
    const sizing = backend.sizeVram(estimateInput);

    expect(sizing.estimate).toMatchObject({ basis: EstimateBasis.CONFIGURATION });
    expect(sizing.cardShares).toEqual([24 * GIB]);
  });

  it('sizes a configured size by its field and places it evenly across the cards', () => {
    const sizing = backendFor(BackendId.VLLM_OMNI).sizeVram(estimateInput);

    expect(sizing.estimate).toMatchObject({ basis: EstimateBasis.CONFIGURATION });
    expect(sizing.cardShares).toEqual([1]);
  });

  it("sizes by the hook the definition names, handing it the definition's declaration", () => {
    const hooks: HookRegistry = new Map<string, BackendHook>([['x/size', sizer]]);
    const declaration = {
      ...llamaCppDefinition.declaration,
      fields: [...llamaCppDefinition.declaration.fields, { ...llamaCppDefinition.declaration.fields[0], name: 'own' }],
    };
    const definition = passthrough({ declaration, vram: { estimate: { source: VramSource.HOOK, hook: 'x/size' } } });

    expect(resolveBackend(definition, hooks).sizeVram(estimateInput)).toEqual({
      estimate: { computed: false, missing: [{ source: EstimateInputSource.CONFIGURATION, field: 'own' }] },
      cardShares: [GIB],
    });
  });

  it('sizes by the weights on disk where the definition declares a factor', () => {
    const backend = resolveBackend(
      passthrough({ vram: { estimate: { source: VramSource.WEIGHTS, factor: 1.5, overheadBytesPerDevice: GIB } } }),
      new Map()
    );

    const sizing = backend.sizeVram(estimateInput);

    expect(sizing.estimate).toMatchObject({ basis: EstimateBasis.WEIGHTS });
    expect(sizing.cardShares).toBeNull();
  });
});

describe.each(Object.values(backendDefinitions))('the $id definition', definition => {
  const { declaration } = definition;

  it('parses against the definition schema', () => {
    expect(validateDefinition(definition).issues).toEqual([]);
  });

  it('survives a JSON round trip unchanged', () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(definition));

    expect(roundTripped).toStrictEqual(definition);
    expect(validateDefinition(roundTripped).definition).toEqual(definition);
  });

  it('names only hooks that resolve to the right kind', () => {
    expect(hookIssues(definition, backendHooks)).toEqual([]);
  });

  it('registers under the backend it names', () => {
    expect(backendDefinitions[definition.id]).toBe(definition);
  });

  it('serves at least one operation', () => {
    expect(Object.keys(definition.operations).length).toBeGreaterThan(0);
  });

  it('gives a stop grace period before a kill escalates', () => {
    expect(definition.container.stopGraceSeconds).toBeGreaterThan(0);
  });

  it('states the schema version the code understands', () => {
    expect(declaration.schemaVersion).toBe(CONFIGURATION_SCHEMA_VERSION);
  });

  it('names each flag once', () => {
    const flags = declaration.fields.map(field => field.flag).filter(flag => flag !== undefined);

    expect(new Set(flags).size).toBe(flags.length);
  });

  it('carries the extra flags escape hatch wherever it declares a flag', () => {
    const takesFlags = declaration.fields.some(field => field.flag !== undefined);

    expect(backendField(declaration, EXTRA_FLAGS_FIELD)?.type).toBe(
      takesFlags ? BackendFieldType.TEXT_LIST : undefined
    );
  });

  it('declares the image as a field passed as no flag, defaulting to the one image every variant names', () => {
    const image = backendField(declaration, IMAGE_FIELD);

    expect(image?.type).toBe(BackendFieldType.TEXT);
    expect(image?.flag).toBeUndefined();
    expect(image?.default).toBe(sharedImage(definition.images));
  });

  it('reads more than an open port before it says the model is served', () => {
    expect(definition.readiness.probe.passStatuses).not.toContain(503);
  });

  it('declares defaults that validate against itself', () => {
    const defaults = Object.fromEntries(
      declaration.fields.filter(field => field.default !== undefined).map(field => [field.name, field.default])
    );

    expect(validateConfiguration(declaration, defaults).issues).toEqual([]);
  });
});
