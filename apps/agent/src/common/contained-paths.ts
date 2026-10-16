import { readlink, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

/** As many symlinks as Linux follows in one path before it gives up with ELOOP. */
const MAX_SYMLINK_HOPS = 40;

/**
 * Whether a path on this host sits inside a set of root directories, read through every symlink on the way. A path
 * handed over the wire, or a symlink swapped in on disk, is only safe to write or mount once it passes.
 */
export class ContainedPaths {
  constructor(private readonly roots: readonly string[]) {}

  /** Null where nothing is at the path. */
  async realpathOf(path: string): Promise<string | null> {
    try {
      return await realpath(path);
    } catch {
      return null;
    }
  }

  /**
   * For a path that may not exist yet: its nearest existing ancestor read through its symlinks, with the rest after. A
   * symlink whose target does not exist yet is read as its target, since a write through it lands there.
   */
  async realpathOfNew(path: string): Promise<string> {
    return this.followNew(path, 0);
  }

  /** A root that cannot be read is compared as written, so a missing root contains nothing it did not before. */
  async contains(realPath: string): Promise<boolean> {
    const roots = await Promise.all(this.roots.map(async root => (await this.realpathOf(root)) ?? root));

    return roots.some(root => realPath === root || realPath.startsWith(`${root}${sep}`));
  }

  private async followNew(path: string, hops: number): Promise<string> {
    const existing = await this.realpathOf(path);

    if (existing !== null) {
      return existing;
    }

    const target = await this.linkTargetOf(path);

    if (target !== null) {
      if (hops >= MAX_SYMLINK_HOPS) {
        throw new Error(`${path} leads through too many symlinks to read`);
      }

      return this.followNew(resolve(dirname(path), target), hops + 1);
    }

    const parent = dirname(path);

    return parent === path ? path : join(await this.followNew(parent, hops), basename(path));
  }

  private async linkTargetOf(path: string): Promise<string | null> {
    try {
      return await readlink(path);
    } catch {
      return null;
    }
  }
}
