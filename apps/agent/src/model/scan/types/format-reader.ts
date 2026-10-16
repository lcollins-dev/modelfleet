import { ModelEntry, ModelFormat, ModelType } from '@libs/agent-protocol';

import { ShardReader } from '../shard-reader';
import { IDirectoryTree } from './directory-tree';
import { IModelFile } from './model-file';

/** One block per format, and a model fills only its own. */
export type ModelFormatFields = Pick<ModelEntry, 'ggufMetadata' | 'safetensorsMetadata'>;

/** Laid under a reader's own contribution, so the blocks it does not fill stay null. */
export const NO_FORMAT_FIELDS: ModelFormatFields = { ggufMetadata: null, safetensorsMetadata: null };

export type ModelDescription = Required<Pick<ModelEntry, 'tasks' | 'licence' | 'modalities'>>;

export const NO_DESCRIPTION: ModelDescription = { tasks: [], licence: null, modalities: null };

export interface IModelSet {
  format: ModelFormat;

  /** What a backend is handed: one of `files`, or the directory holding them. */
  path: string;

  directory: boolean;

  /** In read order, so the concatenation is the model's byte stream. Never empty. */
  files: readonly IModelFile[];

  sizeBytes: number;

  /** Stands in as the model's name where the format states none of its own. */
  name: string;
}

export interface IModelGap {
  path: string | null;

  message: string;
}

export interface IModelGrouping {
  sets: readonly IModelSet[];
  gaps: readonly IModelGap[];
}

export interface IFormatRead {
  name: string | null;

  /** A format stating nothing about what its weights are reports a model. */
  type: ModelType;

  fields: Partial<ModelFormatFields>;

  description: Partial<ModelDescription>;
}

export interface IModelFormatReader {
  readonly format: ModelFormat;

  /** Lowercase and with the dot. A file no reader claims is never opened or sized. */
  readonly suffixes: readonly string[];

  /** Claims what it recognises out of a tree already narrowed to the files this reader claims. */
  group(tree: IDirectoryTree): IModelGrouping;

  /** Returns null where the format states nothing; throws where its files will not parse. */
  read(stream: ShardReader, set: IModelSet): Promise<IFormatRead | null>;
}
