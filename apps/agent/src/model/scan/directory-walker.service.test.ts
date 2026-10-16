import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DirectoryWalkerService } from '@/model/scan/directory-walker.service';
import { IDirectoryTree } from '@/model/scan/types/directory-tree';
import { IModelFile } from '@/model/scan/types/model-file';

const GGUF = ['.gguf'];

function filesOf(tree: IDirectoryTree): IModelFile[] {
  return tree.directories.flatMap(node => [...node.files]);
}

describe('DirectoryWalkerService', () => {
  const walker = new DirectoryWalkerService();

  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'modelfleet-walk-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function write(name: string, contents = 'weights'): Promise<string> {
    const path = join(directory, name);

    await writeFile(path, contents);

    return path;
  }

  it('finds every gguf file, whatever the case of the suffix', async () => {
    await write('one.gguf');
    await write('two.GGUF');
    await write('notes.txt');

    const walk = await walker.walk(directory, GGUF);

    expect(walk.errors).toEqual([]);
    expect(
      filesOf(walk)
        .map(file => file.path)
        .sort()
    ).toEqual([join(directory, 'one.gguf'), join(directory, 'two.GGUF')]);
  });

  it('records each file its byte size', async () => {
    await write('one.gguf', 'abcdef');

    const walk = await walker.walk(directory, GGUF);

    expect(filesOf(walk)[0].sizeBytes).toBe(6);
  });

  it('reports every directory it walked, so a reader can claim a whole one', async () => {
    await mkdir(join(directory, 'llama'));

    const walk = await walker.walk(directory, GGUF);

    expect(walk.directories.map(node => node.path)).toEqual([directory, join(directory, 'llama')]);
  });

  it('passes over a file still being downloaded, whatever format it will be', async () => {
    await write('model.gguf.part');
    await write('model-00001-of-00002.safetensors.part');
    await write('config.json.part');

    const walk = await walker.walk(directory, ['.gguf', '.safetensors', '.json']);

    expect(filesOf(walk)).toEqual([]);
  });

  it('leaves a file no reader claims unsized', async () => {
    await write('one.gguf');
    await write('config.json');

    const walk = await walker.walk(directory, GGUF);

    expect(filesOf(walk).map(file => file.path)).toEqual([join(directory, 'one.gguf')]);
  });

  it('descends into subdirectories', async () => {
    await mkdir(join(directory, 'llama', '8b'), { recursive: true });
    await writeFile(join(directory, 'llama', '8b', 'model.gguf'), 'weights');

    const walk = await walker.walk(directory, GGUF);

    expect(filesOf(walk).map(file => file.path)).toEqual([join(directory, 'llama', '8b', 'model.gguf')]);
  });

  it('follows a symlinked file but not a symlinked directory', async () => {
    const target = await write('real.gguf');

    await mkdir(join(directory, 'nested'));
    await symlink(target, join(directory, 'nested', 'linked.gguf'));
    await symlink(directory, join(directory, 'nested', 'loop'));

    const walk = await walker.walk(directory, GGUF);

    expect(
      filesOf(walk)
        .map(file => file.path)
        .sort()
    ).toEqual([join(directory, 'nested', 'linked.gguf'), join(directory, 'real.gguf')]);
  });

  it('reports a directory it cannot read as an error rather than throwing', async () => {
    const walk = await walker.walk(join(directory, 'absent'), GGUF);

    expect(filesOf(walk)).toEqual([]);
    expect(walk.errors).toHaveLength(1);
    expect(walk.errors[0].path).toBe(join(directory, 'absent'));
  });

  it('reports a symlink pointing at nothing as an error and keeps going', async () => {
    await write('real.gguf');
    await symlink(join(directory, 'gone.gguf'), join(directory, 'dangling.gguf'));

    const walk = await walker.walk(directory, GGUF);

    expect(filesOf(walk).map(file => file.path)).toEqual([join(directory, 'real.gguf')]);
    expect(walk.errors.map(error => error.path)).toEqual([join(directory, 'dangling.gguf')]);
  });
});
