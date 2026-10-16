import { Injectable } from '@nestjs/common';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { IDirectoryError, IDirectoryNode, IDirectoryTree } from './types/directory-tree';
import { IModelFile } from './types/model-file';

@Injectable()
export class DirectoryWalkerService {
  /** A symlinked directory is not entered: `readdir` types it as a link, and following one can loop. */
  async walk(directory: string, suffixes: readonly string[]): Promise<IDirectoryTree> {
    const directories: IDirectoryNode[] = [];
    const errors: IDirectoryError[] = [];
    const pending = [resolve(directory)];

    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index];
      const files: IModelFile[] = [];
      let entries;

      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (error: unknown) {
        errors.push({ path: current, message: this.messageOf(error) });

        continue;
      }

      for (const entry of entries) {
        const path = join(current, entry.name);

        if (entry.isDirectory()) {
          pending.push(path);

          continue;
        }

        if (!this.claims(entry.name, suffixes) || !(entry.isFile() || entry.isSymbolicLink())) {
          continue;
        }

        try {
          files.push({ path, sizeBytes: (await stat(path)).size });
        } catch (error: unknown) {
          errors.push({ path, message: this.messageOf(error) });
        }
      }

      directories.push({ path: current, files });
    }

    return { directories, errors };
  }

  private claims(name: string, suffixes: readonly string[]): boolean {
    const lowered = name.toLowerCase();

    return suffixes.some(suffix => lowered.endsWith(suffix));
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'The directory could not be read';
  }
}
