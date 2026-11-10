import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DesiredDownload, DownloadDigestAlgorithm, DownloadSource } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { DownloadLocationService } from '@/download/download-location.service';

const DOWNLOAD: DesiredDownload = {
  downloadKey: '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f',
  attempt: 0,
  source: DownloadSource.HUGGINGFACE,
  endpoint: 'https://hub.test',
  repository: 'owner/repo',
  directory: 'huggingface/owner/repo',
  revision: 'a'.repeat(40),
  files: [],
};

function fileOf(path: string) {
  return { path, sizeBytes: 1, digest: { algorithm: DownloadDigestAlgorithm.SHA256, value: 'a'.repeat(64) } };
}

function serviceWith(modelDirs: string[]): DownloadLocationService {
  return new DownloadLocationService({ modelDirs } as unknown as ConfigService);
}

describe('DownloadLocationService', () => {
  it('writes under the first model directory as configured, not as the scanner sorts them', () => {
    const location = serviceWith(['/b', '/a']).fileLocation(DOWNLOAD, fileOf('sub/model.gguf'));

    expect(location).toEqual({
      modelDirectory: '/b',
      filePath: '/b/huggingface/owner/repo/sub/model.gguf',
      partialPath: '/b/huggingface/owner/repo/sub/model.gguf.part',
    });
  });

  it('writes under the directory the download names', () => {
    const location = serviceWith(['/b']).fileLocation({ ...DOWNLOAD, directory: 'gguf/qwen' }, fileOf('model.gguf'));

    expect(location.filePath).toBe('/b/gguf/qwen/model.gguf');
  });

  it('writes under the model directory the download names, matched as the node has it configured', () => {
    const location = serviceWith(['/b', '/a']).fileLocation(
      { ...DOWNLOAD, modelDirectory: '/a' },
      fileOf('model.gguf')
    );

    expect(location.modelDirectory).toBe('/a');
    expect(location.filePath).toBe('/a/huggingface/owner/repo/model.gguf');
  });

  it.each([
    ['a directory the node does not have', '/c'],
    ['a directory beneath one it has', '/a/sub'],
    ['one it has, spelled otherwise', '/a/'],
  ])('refuses %s, naming it', (_case, modelDirectory) => {
    expect(() => serviceWith(['/b', '/a']).fileLocation({ ...DOWNLOAD, modelDirectory }, fileOf('model.gguf'))).toThrow(
      `Model directory ${modelDirectory} is not configured on this node.`
    );
  });

  it('refuses a path that would land outside the model directory', () => {
    expect(() => serviceWith(['/b']).fileLocation(DOWNLOAD, fileOf('../../../../escape.gguf'))).toThrow(
      'huggingface/owner/repo/../../../../escape.gguf would land outside /b'
    );
  });

  it('refuses a file that a symlink inside the model directory carries out of it', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'modelfleet-location-')));

    try {
      await mkdir(join(base, 'models'));
      await mkdir(join(base, 'elsewhere'));
      await symlink(join(base, 'elsewhere'), join(base, 'models', 'huggingface'));

      const service = serviceWith([join(base, 'models')]);

      await expect(service.checkContained(service.fileLocation(DOWNLOAD, fileOf('model.gguf')))).rejects.toThrow(
        'leads outside'
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('refuses a file that a symlink carries out of the chosen model directory into another configured one', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'modelfleet-location-')));

    try {
      await mkdir(join(base, 'fast'));
      await mkdir(join(base, 'bulk'));
      await symlink(join(base, 'bulk'), join(base, 'fast', 'huggingface'));

      const service = serviceWith([join(base, 'bulk'), join(base, 'fast')]);
      const location = service.fileLocation({ ...DOWNLOAD, modelDirectory: join(base, 'fast') }, fileOf('model.gguf'));

      await expect(service.checkContained(location)).rejects.toThrow(`leads outside ${join(base, 'fast')}`);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('refuses a partial planted as a symlink to a file that does not exist yet outside the model directory', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'modelfleet-location-')));

    try {
      await mkdir(join(base, 'models', 'huggingface', 'owner', 'repo'), { recursive: true });
      await symlink(join(base, 'planted'), join(base, 'models', 'huggingface', 'owner', 'repo', 'model.gguf.part'));

      const service = serviceWith([join(base, 'models')]);

      await expect(service.checkContained(service.fileLocation(DOWNLOAD, fileOf('model.gguf')))).rejects.toThrow(
        'model.gguf.part leads outside'
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
