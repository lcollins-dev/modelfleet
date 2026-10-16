import { Injectable } from '@nestjs/common';
import { basename } from 'node:path';

import { ModelFormat, ModelType } from '@libs/agent-protocol';

import { RepositoryMetadataService } from '../repository-metadata.service';
import { ShardReader } from '../shard-reader';
import { IDirectoryNode, IDirectoryTree } from '../types/directory-tree';
import { IFormatRead, IModelFormatReader, IModelGrouping, IModelSet } from '../types/format-reader';
import { IModelFile } from '../types/model-file';

export const PYTORCH_SUFFIX = '.pth';

const CONFIG_NAME = 'config.json';
const CONFIG_SUFFIX = '.json';

@Injectable()
export class PytorchReaderService implements IModelFormatReader {
  readonly format = ModelFormat.PYTORCH;
  readonly suffixes = [PYTORCH_SUFFIX, CONFIG_SUFFIX];

  constructor(private readonly repositoryMetadataService: RepositoryMetadataService) {}

  group(tree: IDirectoryTree): IModelGrouping {
    const sets = tree.directories.flatMap(directory => {
      const checkpoints = directory.files.filter(file => file.path.toLowerCase().endsWith(PYTORCH_SUFFIX));

      return checkpoints.length > 0 && this.isModelDirectory(directory)
        ? [this.directorySet(directory, checkpoints)]
        : [];
    });

    return { sets, gaps: [] };
  }

  async read(_stream: ShardReader, set: IModelSet): Promise<IFormatRead | null> {
    const { tasks, licence } = await this.repositoryMetadataService.read(set.path);

    return { name: null, type: ModelType.MODEL, fields: {}, description: { tasks, licence } };
  }

  private isModelDirectory(directory: IDirectoryNode): boolean {
    return directory.files.some(file => basename(file.path).toLowerCase() === CONFIG_NAME);
  }

  private directorySet(directory: IDirectoryNode, checkpoints: readonly IModelFile[]): IModelSet {
    const files = [...checkpoints].sort((left, right) => left.path.localeCompare(right.path));

    return {
      format: this.format,
      path: directory.path,
      directory: true,
      files,
      sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      name: basename(directory.path),
    };
  }
}
