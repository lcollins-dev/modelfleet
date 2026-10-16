import { Injectable } from '@nestjs/common';
import { basename, dirname } from 'node:path';

import { ModelFormat, ModelType, SafetensorsMetadata } from '@libs/agent-protocol';

import { RepositoryMetadataService } from '../repository-metadata.service';
import { ShardGrouperService } from '../shard-grouper.service';
import { ShardReader } from '../shard-reader';
import { IDirectoryNode, IDirectoryTree } from '../types/directory-tree';
import { IFormatRead, IModelFormatReader, IModelGap, IModelGrouping, IModelSet } from '../types/format-reader';
import { IModelFile } from '../types/model-file';
import { SafetensorsHeaderParserService } from './safetensors-header-parser.service';

export const SAFETENSORS_SUFFIX = '.safetensors';

const CONFIG_NAME = 'config.json';
const CONFIG_SUFFIX = '.json';

const INITIAL_HEADER_BYTES = 64 * 1024;
const MAX_HEADER_BYTES = 8 * 1024 * 1024;

@Injectable()
export class SafetensorsReaderService implements IModelFormatReader {
  readonly format = ModelFormat.SAFETENSORS;
  readonly suffixes = [SAFETENSORS_SUFFIX, CONFIG_SUFFIX];

  constructor(
    private readonly shardGrouperService: ShardGrouperService,
    private readonly safetensorsHeaderParserService: SafetensorsHeaderParserService,
    private readonly repositoryMetadataService: RepositoryMetadataService
  ) {}

  /** The tree lists a parent ahead of its children, so a model directory is known before anything inside it. */
  group(tree: IDirectoryTree): IModelGrouping {
    const sets: IModelSet[] = [];
    const gaps: IModelGap[] = [];

    const modelDirectories = new Map<string, IModelSet | null>();

    for (const directory of tree.directories) {
      const tensors = directory.files.filter(file => file.path.toLowerCase().endsWith(SAFETENSORS_SUFFIX));
      const enclosing = this.enclosingModel(directory, modelDirectories);

      if (enclosing !== undefined) {
        if (enclosing !== null) {
          enclosing.sizeBytes += this.sizeOf(tensors);
        }

        continue;
      }

      if (tensors.length === 0) {
        continue;
      }

      const grouping = this.shardGrouperService.group(tensors, SAFETENSORS_SUFFIX);

      if (this.isModelDirectory(directory)) {
        if (grouping.gaps.length > 0) {
          gaps.push(
            ...grouping.gaps.map(gap => ({ path: directory.path, message: this.shardGrouperService.gapMessage(gap) }))
          );
          modelDirectories.set(directory.path, null);
        } else {
          const set = this.directorySet(directory, tensors);

          sets.push(set);
          modelDirectories.set(directory.path, set);
        }

        continue;
      }

      sets.push(
        ...grouping.sets.map(set => ({
          format: this.format,
          path: set.files[0].path,
          directory: false,
          files: set.files,
          sizeBytes: set.sizeBytes,
          name: set.name,
        }))
      );

      gaps.push(...grouping.gaps.map(gap => ({ path: gap.path, message: this.shardGrouperService.gapMessage(gap) })));
    }

    return { sets, gaps };
  }

  async read(stream: ShardReader, set: IModelSet): Promise<IFormatRead | null> {
    const metadata = await this.readMetadata(stream);

    if (!set.directory) {
      return { name: null, type: ModelType.MODEL, fields: { safetensorsMetadata: metadata }, description: {} };
    }

    const { tasks, licence, architecture } = await this.repositoryMetadataService.read(set.path);

    return {
      name: null,
      type: ModelType.MODEL,
      fields: { safetensorsMetadata: { ...metadata, architecture } },
      description: { tasks, licence },
    };
  }

  private async readMetadata(stream: ShardReader): Promise<SafetensorsMetadata> {
    for (let wanted = INITIAL_HEADER_BYTES; wanted <= MAX_HEADER_BYTES; wanted *= 2) {
      const chunks: Buffer[] = [];

      await stream.read(0, wanted, chunk => {
        chunks.push(Buffer.from(chunk));
      });

      const result = this.safetensorsHeaderParserService.parse(Buffer.concat(chunks));

      if (result.ok) {
        return result.metadata;
      }

      if (!result.truncated || stream.sizeBytes <= wanted) {
        throw new Error(result.reason);
      }
    }

    throw new Error('The safetensors header runs past the head this agent reads');
  }

  /** Undefined where no model directory holds this one, and null where the one holding it has a gap. */
  private enclosingModel(
    directory: IDirectoryNode,
    modelDirectories: ReadonlyMap<string, IModelSet | null>
  ): IModelSet | null | undefined {
    for (let parent = dirname(directory.path); parent !== dirname(parent); parent = dirname(parent)) {
      if (modelDirectories.has(parent)) {
        return modelDirectories.get(parent);
      }
    }

    return undefined;
  }

  private sizeOf(files: readonly IModelFile[]): number {
    return files.reduce((sum, file) => sum + file.sizeBytes, 0);
  }

  private isModelDirectory(directory: IDirectoryNode): boolean {
    return directory.files.some(file => basename(file.path).toLowerCase() === CONFIG_NAME);
  }

  /** Leaves the config, other files and subdirectories out, so a repository keeps its top-level tensors' digest. */
  private directorySet(directory: IDirectoryNode, tensors: readonly IModelFile[]): IModelSet {
    const files = [...tensors].sort((left, right) => left.path.localeCompare(right.path));

    return {
      format: this.format,
      path: directory.path,
      directory: true,
      files,
      sizeBytes: this.sizeOf(files),
      name: basename(directory.path),
    };
  }
}
