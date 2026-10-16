import { beforeEach, describe, expect, it } from 'vitest';

import { BackendField, BackendFieldType, BackendId, BackendDeclaration, ModelFormat } from '@libs/backends';
import { ConfigurationSource } from '@libs/dto';

import { ConfigurationValueService } from '@/core/configuration/configuration-value.service';
import { EffectiveConfigurationService } from '@/core/configuration/effective-configuration.service';

const declaration = (names: string[]): BackendDeclaration => ({
  schemaVersion: 1,
  formats: [ModelFormat.GGUF],
  groups: [{ group: 'general', label: 'General' }],
  fields: names.map(name => ({
    name,
    label: name,
    description: name,
    group: 'general',
    type: BackendFieldType.TEXT,
  })),
});

const LLAMA_CPP = declaration(['image', 'threads', 'gpuLayers', 'chatTemplate', 'extraFlags']);
const OTHER_BACKEND = declaration(['gpuLayers', 'extraFlags']);

const DECLARED_IMAGE = 'llama.cpp:tested';
const DECLARED_SPLIT = [0.5, 0.5];

const replacing = (base: BackendDeclaration, field: BackendField): BackendDeclaration => ({
  ...base,
  fields: base.fields.map(existing => (existing.name === field.name ? field : existing)),
});

const WITH_DECLARED_IMAGE = replacing(LLAMA_CPP, {
  name: 'image',
  label: 'image',
  description: 'image',
  group: 'general',
  type: BackendFieldType.TEXT,
  default: DECLARED_IMAGE,
});

const WITH_DECLARED_LIST = replacing(LLAMA_CPP, {
  name: 'gpuLayers',
  flag: '--tensor-split',
  label: 'gpuLayers',
  description: 'gpuLayers',
  group: 'general',
  type: BackendFieldType.NUMBER_LIST,
  default: DECLARED_SPLIT,
});

const WITH_SILENT_BOOLEAN = replacing(LLAMA_CPP, {
  name: 'chatTemplate',
  flag: '--silent',
  label: 'chatTemplate',
  description: 'chatTemplate',
  group: 'general',
  type: BackendFieldType.BOOLEAN,
  default: false,
});

const WITH_NO_DEFAULT = replacing(LLAMA_CPP, {
  name: 'gpuLayers',
  label: 'gpuLayers',
  description: 'gpuLayers',
  group: 'general',
  type: BackendFieldType.INTEGER,
});

describe('EffectiveConfigurationService', () => {
  let effectiveConfigurationService: EffectiveConfigurationService;

  beforeEach(() => {
    effectiveConfigurationService = new EffectiveConfigurationService(new ConfigurationValueService());
  });

  describe('resolve', () => {
    it('attributes an overridden value to the deployment and reports the preset value it replaced', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        LLAMA_CPP,
        { threads: 16 },
        { threads: 8 }
      );

      expect(resolved.entries).toEqual([
        { key: 'threads', value: 8, source: ConfigurationSource.DEPLOYMENT, presetValue: 16, modelled: true },
      ]);
      expect(resolved.configuration).toEqual({ threads: 8 });
    });

    it('attributes an inherited value to the preset, carrying no preset value beside it', () => {
      const resolved = effectiveConfigurationService.resolve(BackendId.LLAMA_CPP, LLAMA_CPP, { threads: 16 }, {});

      expect(resolved.entries).toEqual([
        { key: 'threads', value: 16, source: ConfigurationSource.PRESET, modelled: true },
      ]);
    });

    it('replaces a list whole rather than merging it element-wise', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        LLAMA_CPP,
        { extraFlags: ['--no-mmap'] },
        { extraFlags: ['--mlock'] }
      );

      expect(resolved.configuration).toEqual({ extraFlags: ['--mlock'] });
    });

    it('reads a null override as a value the deployment sets, not as an absent key', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        LLAMA_CPP,
        { chatTemplate: 'chatml' },
        { chatTemplate: null }
      );

      expect(resolved.entries).toEqual([
        {
          key: 'chatTemplate',
          value: null,
          source: ConfigurationSource.DEPLOYMENT,
          presetValue: 'chatml',
          modelled: true,
        },
      ]);
    });

    it('attributes every value to the deployment where it names no preset', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        LLAMA_CPP,
        {},
        { image: 'llama:latest', threads: 8 }
      );

      expect(resolved.entries.map(entry => entry.source)).toEqual([
        ConfigurationSource.DEPLOYMENT,
        ConfigurationSource.DEPLOYMENT,
      ]);
    });

    it('marks a key no field models, so the caller can see nothing validated it', () => {
      const resolved = effectiveConfigurationService.resolve(BackendId.LLAMA_CPP, LLAMA_CPP, { someNewFlag: 1 }, {});

      expect(resolved.entries).toEqual([
        { key: 'someNewFlag', value: 1, source: ConfigurationSource.PRESET, modelled: false },
      ]);
    });

    it('names only what a document sets, so a field left to a hint default stays out', () => {
      const resolved = effectiveConfigurationService.resolve(BackendId.LLAMA_CPP, LLAMA_CPP, { threads: 16 }, {});

      expect(resolved.entries.map(entry => entry.key)).toEqual(['threads']);
      expect(resolved.configuration).toEqual({ threads: 16 });
    });

    it('reports a declared default no document sets, in declaration order beside the values a document gives', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        WITH_DECLARED_IMAGE,
        { threads: 16 },
        {}
      );

      expect(resolved.entries).toEqual([
        { key: 'image', value: DECLARED_IMAGE, source: ConfigurationSource.DECLARATION, modelled: true },
        { key: 'threads', value: 16, source: ConfigurationSource.PRESET, modelled: true },
      ]);
    });

    it('keeps a declared default out of the document, which carries only what the layers set', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        WITH_DECLARED_IMAGE,
        { threads: 16 },
        {}
      );

      expect(resolved.configuration).toEqual({ threads: 16 });
    });

    it('names a defaulted key once, attributed to the document that sets it', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        WITH_DECLARED_IMAGE,
        {},
        { image: 'llama:latest' }
      );

      expect(resolved.entries).toEqual([
        { key: 'image', value: 'llama:latest', source: ConfigurationSource.DEPLOYMENT, modelled: true },
      ]);
      expect(resolved.configuration).toEqual({ image: 'llama:latest' });
    });

    it('attributes a defaulted key the preset sets to the preset, naming no default beside it', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        WITH_DECLARED_IMAGE,
        { image: 'llama:latest' },
        {}
      );

      expect(resolved.entries).toEqual([
        { key: 'image', value: 'llama:latest', source: ConfigurationSource.PRESET, modelled: true },
      ]);
    });

    it('names no entry for a boolean defaulting to false with no off flag, which passes nothing', () => {
      const resolved = effectiveConfigurationService.resolve(BackendId.LLAMA_CPP, WITH_SILENT_BOOLEAN, {}, {});

      expect(resolved.entries).toEqual([]);
    });

    it('names no entry for a field with no default, since there is no value to pass', () => {
      const resolved = effectiveConfigurationService.resolve(BackendId.LLAMA_CPP, WITH_NO_DEFAULT, {}, {});

      expect(resolved.entries).toEqual([]);
    });

    it('copies a declared list, so the declaration cannot be written through the entry', () => {
      const resolved = effectiveConfigurationService.resolve(BackendId.LLAMA_CPP, WITH_DECLARED_LIST, {}, {});
      const entry = resolved.entries.find(candidate => candidate.key === 'gpuLayers');

      expect(entry).toEqual({
        key: 'gpuLayers',
        value: [0.5, 0.5],
        source: ConfigurationSource.DECLARATION,
        modelled: true,
      });
      expect(entry?.value).not.toBe(DECLARED_SPLIT);
    });

    it('reports a default a document sets to null as the null it applies', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        WITH_DECLARED_IMAGE,
        {},
        { image: null }
      );

      expect(resolved.entries).toEqual([
        { key: 'image', value: null, source: ConfigurationSource.DEPLOYMENT, modelled: true },
      ]);
    });

    it('orders the fleet keys first, then the declared fields, then the unmodelled keys by name', () => {
      const resolved = effectiveConfigurationService.resolve(
        BackendId.LLAMA_CPP,
        LLAMA_CPP,
        { zzz: 1, gpuLayers: 99, aaa: 2, replicas: 2 },
        { threads: 8, image: 'llama:latest' }
      );

      expect(resolved.entries.map(entry => entry.key)).toEqual([
        'replicas',
        'image',
        'threads',
        'gpuLayers',
        'aaa',
        'zzz',
      ]);
    });
  });

  describe('orphanedKeys', () => {
    it('drops nothing where the backend is unchanged', () => {
      expect(effectiveConfigurationService.orphanedKeys(LLAMA_CPP, LLAMA_CPP, { threads: 8, someNewFlag: 1 })).toEqual(
        []
      );
    });

    it('lists an override the new backend has no field for', () => {
      expect(effectiveConfigurationService.orphanedKeys(LLAMA_CPP, OTHER_BACKEND, { threads: 8 })).toEqual(['threads']);
    });

    it('keeps an override both backends model', () => {
      expect(effectiveConfigurationService.orphanedKeys(LLAMA_CPP, OTHER_BACKEND, { gpuLayers: 99 })).toEqual([]);
    });

    it('keeps a fleet key, which no backend declares and every backend reads', () => {
      expect(effectiveConfigurationService.orphanedKeys(LLAMA_CPP, OTHER_BACKEND, { replicas: 2 })).toEqual([]);
    });

    it('keeps a key neither backend models, so the escape hatch survives the swap', () => {
      expect(effectiveConfigurationService.orphanedKeys(LLAMA_CPP, OTHER_BACKEND, { someNewFlag: 1 })).toEqual([]);
    });
  });

  describe('changedKeys', () => {
    it('lists a key whose value moved, one added and one removed', () => {
      const changed = effectiveConfigurationService.changedKeys(
        { threads: 16, gpuLayers: 99 },
        { threads: 8, chatTemplate: 'chatml' }
      );

      expect(changed).toEqual(['chatTemplate', 'gpuLayers', 'threads']);
    });

    it('reads a key set to null as changed, not as one left alone', () => {
      expect(effectiveConfigurationService.changedKeys({ chatTemplate: 'chatml' }, { chatTemplate: null })).toEqual([
        'chatTemplate',
      ]);
    });

    it('reads a key dropped to absent as changed', () => {
      expect(effectiveConfigurationService.changedKeys({ chatTemplate: null }, {})).toEqual(['chatTemplate']);
    });

    it('leaves a list of equal entries alone', () => {
      expect(
        effectiveConfigurationService.changedKeys({ tensorSplit: [0.5, 0.5] }, { tensorSplit: [0.5, 0.5] })
      ).toEqual([]);
    });

    it('lists a list whose entries moved', () => {
      expect(effectiveConfigurationService.changedKeys({ tensorSplit: [0.5, 0.5] }, { tensorSplit: [1, 0] })).toEqual([
        'tensorSplit',
      ]);
    });

    it('leaves a nested mapping written in another key order alone', () => {
      const before = { placement: { spreadAcrossNodes: true, nodeIds: [1, 2] } };
      const after = { placement: { nodeIds: [1, 2], spreadAcrossNodes: true } };

      expect(effectiveConfigurationService.changedKeys(before, after)).toEqual([]);
    });

    it('lists a nested mapping that gained a key', () => {
      const before = { placement: { nodeIds: [1] } };
      const after = { placement: { nodeIds: [1], spreadAcrossNodes: true } };

      expect(effectiveConfigurationService.changedKeys(before, after)).toEqual(['placement']);
    });
  });
});
