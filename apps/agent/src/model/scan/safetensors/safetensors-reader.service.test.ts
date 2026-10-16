import { describe, expect, it } from 'vitest';

import { ModelFormat } from '@libs/agent-protocol';

import { RepositoryMetadataService } from '@/model/scan/repository-metadata.service';
import { SafetensorsHeaderParserService } from '@/model/scan/safetensors/safetensors-header-parser.service';
import { SafetensorsReaderService } from '@/model/scan/safetensors/safetensors-reader.service';
import { ShardGrouperService } from '@/model/scan/shard-grouper.service';
import { IDirectoryTree } from '@/model/scan/types/directory-tree';

function tree(...directories: { path: string; names: string[] }[]): IDirectoryTree {
  return {
    directories: directories.map(directory => ({
      path: directory.path,
      files: directory.names.map(name => ({ path: `${directory.path}/${name}`, sizeBytes: 100 })),
    })),
    errors: [],
  };
}

describe('SafetensorsReaderService', () => {
  const reader = new SafetensorsReaderService(
    new ShardGrouperService(),
    new SafetensorsHeaderParserService(),
    new RepositoryMetadataService()
  );

  it('asks to see the config alongside the tensors', () => {
    expect(reader.format).toBe(ModelFormat.SAFETENSORS);
    expect(reader.suffixes).toEqual(['.safetensors', '.json']);
  });

  it('reads a directory carrying a config as one model, at the directory', () => {
    const grouping = reader.group(
      tree({
        path: '/models/llama-3-8b',
        names: ['config.json', 'model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors'],
      })
    );

    expect(grouping.gaps).toEqual([]);
    expect(grouping.sets).toHaveLength(1);
    expect(grouping.sets[0]).toMatchObject({
      format: ModelFormat.SAFETENSORS,
      path: '/models/llama-3-8b',
      sizeBytes: 200,
      name: 'llama-3-8b',
    });
  });

  it('reports a directory carrying a config and missing a shard as a gap at the directory, not as a model', () => {
    const grouping = reader.group(
      tree({ path: '/models/llama-3-8b', names: ['config.json', 'model-00001-of-00002.safetensors'] })
    );

    expect(grouping.sets).toEqual([]);
    expect(grouping.gaps).toEqual([
      { path: '/models/llama-3-8b', message: 'model is missing shard 2 of 2, so it is not reported' },
    ]);
  });

  it('reads a directory carrying a config and a lone tensor file beside a complete set as one model', () => {
    const grouping = reader.group(
      tree({
        path: '/models/mistral',
        names: [
          'config.json',
          'consolidated.safetensors',
          'model-00001-of-00002.safetensors',
          'model-00002-of-00002.safetensors',
        ],
      })
    );

    expect(grouping.gaps).toEqual([]);
    expect(grouping.sets).toHaveLength(1);
    expect(grouping.sets[0]).toMatchObject({ path: '/models/mistral', sizeBytes: 300 });
  });

  it('reports a directory carrying a config and a leftover partial set beside a complete one as a gap', () => {
    const grouping = reader.group(
      tree({
        path: '/models/llama-3-8b',
        names: [
          'config.json',
          'model-00001-of-00002.safetensors',
          'model-00002-of-00002.safetensors',
          'model-00001-of-00004.safetensors',
        ],
      })
    );

    expect(grouping.sets).toEqual([]);
    expect(grouping.gaps).toEqual([
      { path: '/models/llama-3-8b', message: 'model is missing shard 2, 3, 4 of 4, so it is not reported' },
    ]);
  });

  it('leaves the config out of the bytes it digests', () => {
    const grouping = reader.group(tree({ path: '/models/llama-3-8b', names: ['config.json', 'model.safetensors'] }));

    expect(grouping.sets[0].files.map(file => file.path)).toEqual(['/models/llama-3-8b/model.safetensors']);
  });

  it('reads a loose file with no config beside it as a model of its own', () => {
    const grouping = reader.group(tree({ path: '/models', names: ['mistral-7b.safetensors'] }));

    expect(grouping.sets).toHaveLength(1);
    expect(grouping.sets[0]).toMatchObject({
      path: '/models/mistral-7b.safetensors',
      name: 'mistral-7b',
    });
  });

  it('keeps two loose models in one directory apart rather than reading the directory as one', () => {
    const grouping = reader.group(tree({ path: '/models', names: ['a.safetensors', 'b.safetensors'] }));

    expect(grouping.sets.map(set => set.name).sort()).toEqual(['a', 'b']);
  });

  it('gathers a loose shard set with no config into one model', () => {
    const grouping = reader.group(
      tree({ path: '/models', names: ['qwen-00001-of-00002.safetensors', 'qwen-00002-of-00002.safetensors'] })
    );

    expect(grouping.sets).toHaveLength(1);
    expect(grouping.sets[0]).toMatchObject({ path: '/models/qwen-00001-of-00002.safetensors', name: 'qwen' });
  });

  it('reports a loose shard set missing a member as a gap', () => {
    const grouping = reader.group(
      tree({ path: '/models', names: ['qwen-00001-of-00003.safetensors', 'qwen-00003-of-00003.safetensors'] })
    );

    expect(grouping.sets).toEqual([]);
    expect(grouping.gaps).toEqual([
      { path: '/models/qwen', message: 'qwen is missing shard 2 of 3, so it is not reported' },
    ]);
  });

  it('claims nothing from a directory holding a config and no tensors', () => {
    const grouping = reader.group(tree({ path: '/models/notes', names: ['config.json'] }));

    expect(grouping).toEqual({ sets: [], gaps: [] });
  });

  it('leaves gguf files alone', () => {
    const grouping = reader.group(tree({ path: '/models', names: ['llama.gguf'] }));

    expect(grouping).toEqual({ sets: [], gaps: [] });
  });

  describe('a repository with subdirectories', () => {
    it('keeps a subdirectory out of the bytes it digests, so the fingerprint is what it was', () => {
      const grouping = reader.group(
        tree(
          { path: '/models/voxtral', names: ['config.json', 'model.safetensors'] },
          { path: '/models/voxtral/codec', names: ['config.json', 'codec.safetensors'] }
        )
      );

      expect(grouping.sets[0].files.map(file => file.path)).toEqual(['/models/voxtral/model.safetensors']);
    });

    it('folds tensors with no config and directories nested deeper', () => {
      const grouping = reader.group(
        tree(
          { path: '/models/qwen3-tts', names: ['config.json', 'model.safetensors'] },
          { path: '/models/qwen3-tts/speech_tokenizer', names: ['model.safetensors'] },
          { path: '/models/qwen3-tts/speech_tokenizer/decoder', names: ['config.json', 'decoder.safetensors'] }
        )
      );

      expect(grouping.sets).toHaveLength(1);
      expect(grouping.sets[0].sizeBytes).toBe(300);
    });

    it('catalogues nothing inside a model directory a gap keeps out', () => {
      const grouping = reader.group(
        tree(
          { path: '/models/llama', names: ['config.json', 'model-00001-of-00002.safetensors'] },
          { path: '/models/llama/codec', names: ['config.json', 'codec.safetensors'] }
        )
      );

      expect(grouping.sets).toEqual([]);
      expect(grouping.gaps).toHaveLength(1);
    });

    it('leaves a sibling whose name starts with the model directory its own model', () => {
      const grouping = reader.group(
        tree(
          { path: '/models/llama', names: ['config.json', 'model.safetensors'] },
          { path: '/models/llama-2', names: ['config.json', 'model.safetensors'] }
        )
      );

      expect(grouping.sets.map(set => set.path)).toEqual(['/models/llama', '/models/llama-2']);
    });

    it('reads a subdirectory of a directory that is no model as models of its own, as before', () => {
      const grouping = reader.group(
        tree(
          { path: '/models', names: ['loose.safetensors'] },
          { path: '/models/whisper', names: ['config.json', 'model.safetensors'] }
        )
      );

      expect(grouping.sets.map(set => set.path)).toEqual(['/models/loose.safetensors', '/models/whisper']);
    });
  });
});
