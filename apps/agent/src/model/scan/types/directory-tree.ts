import { IModelFile } from './model-file';

export interface IDirectoryNode {
  path: string;

  /** Only the files sitting directly in this directory, and only those a reader asked to see. */
  files: readonly IModelFile[];
}

export interface IDirectoryError {
  path: string;
  message: string;
}

export interface IDirectoryTree {
  /** Every directory walked, the root first. */
  directories: readonly IDirectoryNode[];
  errors: readonly IDirectoryError[];
}
