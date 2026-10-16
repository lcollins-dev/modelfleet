import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContainedPaths } from '@/common/contained-paths';

describe('ContainedPaths', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'modelfleet-contained-')));
    root = join(base, 'models');
    outside = join(base, 'elsewhere');

    await mkdir(root);
    await mkdir(outside);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('contains a file inside a root', async () => {
    await writeFile(join(root, 'model.gguf'), 'weights');

    const contained = new ContainedPaths([root]);
    const resolved = await contained.realpathOf(join(root, 'model.gguf'));

    expect(resolved).toBe(join(root, 'model.gguf'));
    expect(await contained.contains(resolved ?? '')).toBe(true);
  });

  it('reads nothing at a path that does not exist', async () => {
    expect(await new ContainedPaths([root]).realpathOf(join(root, 'missing.gguf'))).toBeNull();
  });

  it('does not contain a file reached through a symlink that leads out of the root', async () => {
    await writeFile(join(outside, 'secret'), 'not a model');
    await symlink(join(outside, 'secret'), join(root, 'model.gguf'));

    const contained = new ContainedPaths([root]);

    expect(await contained.contains((await contained.realpathOf(join(root, 'model.gguf'))) ?? '')).toBe(false);
  });

  it('follows the symlinks above a file not written yet', async () => {
    await symlink(outside, join(root, 'linked'));

    const contained = new ContainedPaths([root]);
    const landed = await contained.realpathOfNew(join(root, 'linked', 'deeper', 'model.gguf'));

    expect(landed).toBe(join(outside, 'deeper', 'model.gguf'));
    expect(await contained.contains(landed)).toBe(false);
  });

  it('reads a symlink to nothing yet as its target, since a write through it lands there', async () => {
    await symlink(join(outside, 'planted'), join(root, 'model.gguf.part'));

    const contained = new ContainedPaths([root]);
    const landed = await contained.realpathOfNew(join(root, 'model.gguf.part'));

    expect(landed).toBe(join(outside, 'planted'));
    expect(await contained.contains(landed)).toBe(false);
  });

  it('refuses to read a loop of symlinks', async () => {
    await symlink(join(root, 'b'), join(root, 'a'));
    await symlink(join(root, 'a'), join(root, 'b'));

    await expect(new ContainedPaths([root]).realpathOfNew(join(root, 'a'))).rejects.toThrow('too many symlinks');
  });

  it('reads a root through its own symlink, so a linked model directory still contains its files', async () => {
    const linkedRoot = join(base, 'linked-models');

    await symlink(root, linkedRoot);

    expect(await new ContainedPaths([linkedRoot]).contains(join(root, 'model.gguf'))).toBe(true);
  });

  it('does not take a sibling sharing the root as a prefix for the root', async () => {
    expect(await new ContainedPaths([root]).contains(`${root}-other/model.gguf`)).toBe(false);
  });
});
