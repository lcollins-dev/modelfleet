import { describe, expect, it, vi } from 'vitest';

import { ModelFormat, ModelTask, ModelType } from '@libs/agent-protocol';

import { PytorchReaderService } from '@/model/scan/pytorch/pytorch-reader.service';
import { RepositoryMetadataService } from '@/model/scan/repository-metadata.service';
import { ShardReader } from '@/model/scan/shard-reader';
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

describe('PytorchReaderService', () => {
  const repositoryMetadataService = {
    read: vi.fn().mockResolvedValue({
      tasks: [ModelTask.SPEECH],
      licence: { id: 'apache-2.0', name: null, link: null },
      architecture: null,
    }),
  };
  const reader = new PytorchReaderService(repositoryMetadataService as unknown as RepositoryMetadataService);

  it('reads a directory holding a config and a checkpoint as one model, at the directory', () => {
    const grouping = reader.group(
      tree({ path: '/models/Kokoro-82M', names: ['kokoro-v1_0.pth', 'config.json', 'extra.pth'] })
    );

    expect(reader.suffixes).toEqual(['.pth', '.json']);
    expect(grouping).toEqual({
      sets: [
        {
          format: ModelFormat.PYTORCH,
          path: '/models/Kokoro-82M',
          directory: true,
          files: [
            { path: '/models/Kokoro-82M/extra.pth', sizeBytes: 100 },
            { path: '/models/Kokoro-82M/kokoro-v1_0.pth', sizeBytes: 100 },
          ],
          sizeBytes: 200,
          name: 'Kokoro-82M',
        },
      ],
      gaps: [],
    });
  });

  it('passes over a loose checkpoint, and a config with no checkpoint beside it', () => {
    const grouping = reader.group(
      tree({ path: '/models/loose', names: ['model.pth'] }, { path: '/models/llama', names: ['config.json'] })
    );

    expect(grouping.sets).toEqual([]);
  });

  it('parses nothing out of the pickle, asking the directory what the model is', async () => {
    const set = reader.group(tree({ path: '/models/Kokoro-82M', names: ['kokoro-v1_0.pth', 'config.json'] })).sets[0];

    expect(await reader.read(new ShardReader(set.files), set)).toEqual({
      name: null,
      type: ModelType.MODEL,
      fields: {},
      description: { tasks: [ModelTask.SPEECH], licence: { id: 'apache-2.0', name: null, link: null } },
    });
    expect(repositoryMetadataService.read).toHaveBeenCalledWith('/models/Kokoro-82M');
  });
});
