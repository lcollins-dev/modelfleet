import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DownloadDigestAlgorithm,
  DownloadFileState as ObservedFileState,
  DownloadState,
  MAX_DOWNLOAD_DIRECTORY_LENGTH,
  MAX_DOWNLOAD_PATH_LENGTH,
  MAX_FILES_PER_DOWNLOAD,
} from '@libs/agent-protocol';
import {
  DOWNLOAD_MAX_DIRECTORY_LENGTH,
  DOWNLOAD_MAX_FILES,
  DOWNLOAD_MAX_PATH_LENGTH,
  DownloadFileState,
  DownloadProgressState,
  DownloadSource,
  DownloadTargetState,
  NodeState,
} from '@libs/dto';

import { DownloadFile } from '@/core/download/entities/download-file.entity';
import { DownloadTarget } from '@/core/download/entities/download-target.entity';
import { Download } from '@/core/download/entities/download.entity';
import { Node } from '@/core/node/entities/node.entity';

import { DownloadAdminService } from '@/api/v1/download/download-admin.service';
import { ConfigService } from '@/config/config.service';
import { DownloadAdmissionService } from '@/core/download/download-admission.service';
import { DownloadProgressService } from '@/core/download/download-progress.service';
import { DownloadService } from '@/core/download/download.service';
import { HubReaderService } from '@/core/download/hub-reader.service';
import { NodeService } from '@/core/node/node.service';

const DOWNLOAD_KEY = '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f';

function buildDownload(states: DownloadTargetState[]): Download {
  const download = new Download({
    source: DownloadSource.HUGGINGFACE,
    repository: 'owner/repo',
    directory: 'huggingface/owner/repo',
    revision: 'a'.repeat(40),
    createdById: null,
  });

  download.id = 1;
  download.downloadKey = DOWNLOAD_KEY;
  download.createdDate = new Date('2026-09-25T12:00:00.000Z');
  download.files = [
    new DownloadFile({
      downloadId: 1,
      position: 0,
      path: 'model.gguf',
      sizeBytes: 300,
      digestAlgorithm: DownloadDigestAlgorithm.SHA256,
      digest: 'a'.repeat(64),
    }),
    new DownloadFile({
      downloadId: 1,
      position: 1,
      path: 'config.json',
      sizeBytes: 100,
      digestAlgorithm: DownloadDigestAlgorithm.GIT_SHA1,
      digest: 'b'.repeat(40),
    }),
  ];
  download.targets = states.map((state, index) => {
    const target = new DownloadTarget({ downloadId: 1, nodeId: index + 1 });

    target.state = state;
    target.node = { id: index + 1, name: `gpu-0${index + 1}` } as Node;

    return target;
  });

  return download;
}

describe('DownloadAdminService', () => {
  let findWithThrow: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let list: ReturnType<typeof vi.fn>;
  let downloadChanges: Subject<void>;
  let findAndCount: ReturnType<typeof vi.fn>;
  let downloadProgressService: DownloadProgressService;
  let downloadAdminService: DownloadAdminService;

  beforeEach(() => {
    findWithThrow = vi.fn();
    create = vi.fn().mockResolvedValue(buildDownload([DownloadTargetState.ACTIVE]));
    list = vi.fn().mockResolvedValue({ repository: 'owner/repo', revision: 'abc', files: [], truncated: false });
    downloadChanges = new Subject<void>();
    findAndCount = vi.fn().mockResolvedValue([[buildDownload([DownloadTargetState.ACTIVE])], 1]);
    downloadProgressService = new DownloadProgressService();

    downloadAdminService = new DownloadAdminService(
      { pageSize: 20 } as ConfigService,
      { create } as unknown as DownloadAdmissionService,
      {
        findWithThrow,
        findAndCount,
        countByState: vi.fn().mockResolvedValue({}),
        stateOf: vi.fn(),
        getDownloadChanges: () => downloadChanges.asObservable(),
      } as unknown as DownloadService,
      downloadProgressService,
      { list } as unknown as HubReaderService,
      { getState: () => NodeState.ONLINE } as unknown as NodeService
    );
  });

  it('carries the node report on an active target, per file and summed', async () => {
    findWithThrow.mockResolvedValue(buildDownload([DownloadTargetState.ACTIVE]));
    downloadProgressService.replace(1, {
      downloads: [
        {
          downloadKey: DOWNLOAD_KEY,
          attempt: 0,
          state: DownloadState.DOWNLOADING,
          message: null,
          files: [
            { path: 'model.gguf', state: ObservedFileState.DOWNLOADING, bytesDone: 120 },
            { path: 'config.json', state: ObservedFileState.PENDING, bytesDone: 0 },
          ],
        },
      ],
    });

    const download = await downloadAdminService.getDownload(1);

    expect(download.targets[0]).toMatchObject({
      progress: DownloadProgressState.DOWNLOADING,
      bytesDone: 120,
      totalBytes: 400,
      files: [
        { path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 120 },
        { path: 'config.json', state: DownloadFileState.PENDING, bytesDone: 0 },
      ],
    });
  });

  it('reads an active target the node has not reported on as having no progress', async () => {
    findWithThrow.mockResolvedValue(buildDownload([DownloadTargetState.ACTIVE]));

    const download = await downloadAdminService.getDownload(1);

    expect(download.targets[0].progress).toBeNull();
    expect(download.targets[0].files[0]).toEqual({ path: 'model.gguf', state: null, bytesDone: 0 });
  });

  it('reads a succeeded target as every byte in place, and totals the download across its nodes', async () => {
    findWithThrow.mockResolvedValue(buildDownload([DownloadTargetState.SUCCEEDED, DownloadTargetState.FAILED]));

    const download = await downloadAdminService.getDownload(1);

    expect(download.targets[0].bytesDone).toBe(400);
    expect(download.targets[0].files.every(file => file.state === DownloadFileState.DONE)).toBe(true);
    expect(download.bytesDone).toBe(400);
    expect(download.totalBytes).toBe(800);
  });

  it('ignores a report the node still holds for a target the server has already settled', async () => {
    findWithThrow.mockResolvedValue(buildDownload([DownloadTargetState.STOPPED]));
    downloadProgressService.replace(1, {
      downloads: [
        { downloadKey: DOWNLOAD_KEY, attempt: 0, state: DownloadState.DOWNLOADING, message: null, files: [] },
      ],
    });

    const download = await downloadAdminService.getDownload(1);

    expect(download.targets[0].progress).toBeNull();
  });

  describe('createDownload', () => {
    it.each([undefined, '   '])(
      'asks for main where the revision is %j, and trims what it is handed',
      async revision => {
        await downloadAdminService.createDownload(
          { repository: ' owner/repo ', directory: ' gguf/qwen/ ', revision, files: ['model.gguf'], nodeIds: [1] },
          7
        );

        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ repository: 'owner/repo', directory: 'gguf/qwen', revision: 'main' }),
          7
        );
      }
    );
  });

  describe('getRepositoryListing', () => {
    it.each([undefined, '   '])('lists at main where the revision is %j, and trims the repository', async revision => {
      await downloadAdminService.getRepositoryListing({ repository: ' owner/repo ', revision });

      expect(list).toHaveBeenCalledWith('owner/repo', 'main');
    });

    it('carries the listing and the most files a download can name', async () => {
      list.mockResolvedValue({
        repository: 'owner/repo',
        revision: 'abc',
        files: [{ path: 'model.gguf', sizeBytes: 5 }],
        truncated: true,
      });

      expect(await downloadAdminService.getRepositoryListing({ repository: 'owner/repo' })).toEqual({
        repository: 'owner/repo',
        revision: 'abc',
        files: [{ path: 'model.gguf', sizeBytes: 5 }],
        truncated: true,
        maxFilesPerDownload: MAX_FILES_PER_DOWNLOAD,
      });
    });
  });

  describe('watchDownloadProgress', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends a burst of reports as one message a second, without reading a row', async () => {
      vi.useFakeTimers();

      const received: number[] = [];
      const subscription = downloadAdminService
        .watchDownloadProgress()
        .subscribe(progress => received.push(progress.downloads.length));

      for (let report = 0; report < 20; report += 1) {
        downloadProgressService.forget(report);
      }

      await vi.advanceTimersByTimeAsync(1000);

      expect(received).toEqual([0, 0]);
      expect(findWithThrow).not.toHaveBeenCalled();

      subscription.unsubscribe();
    });
  });

  describe('getDownloadProgress', () => {
    it('gathers every node reporting on a download under its key, without reading a row', () => {
      const report = (bytesDone: number) => ({
        downloads: [
          {
            downloadKey: DOWNLOAD_KEY,
            attempt: 0,
            state: DownloadState.DOWNLOADING,
            message: null,
            files: [{ path: 'model.gguf', state: ObservedFileState.DOWNLOADING, bytesDone }],
          },
        ],
      });

      downloadProgressService.replace(1, report(100));
      downloadProgressService.replace(2, report(250));

      expect(downloadAdminService.getDownloadProgress()).toEqual({
        downloads: [
          {
            key: DOWNLOAD_KEY,
            targets: [
              {
                nodeId: 1,
                progress: DownloadProgressState.DOWNLOADING,
                bytesDone: 100,
                bytesPerSecond: null,
                files: [{ path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 100 }],
              },
              {
                nodeId: 2,
                progress: DownloadProgressState.DOWNLOADING,
                bytesDone: 250,
                bytesPerSecond: null,
                files: [{ path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 250 }],
              },
            ],
          },
        ],
      });
      expect(findAndCount).not.toHaveBeenCalled();
      expect(findWithThrow).not.toHaveBeenCalled();
    });
  });

  it('refuses a request by the same limits the agent protocol holds a download to', () => {
    expect([DOWNLOAD_MAX_FILES, DOWNLOAD_MAX_PATH_LENGTH, DOWNLOAD_MAX_DIRECTORY_LENGTH]).toEqual([
      MAX_FILES_PER_DOWNLOAD,
      MAX_DOWNLOAD_PATH_LENGTH,
      MAX_DOWNLOAD_DIRECTORY_LENGTH,
    ]);
  });
});
