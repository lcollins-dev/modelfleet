import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadDigestAlgorithm } from '@libs/agent-protocol';
import { DownloadTargetState, EventSeverity, EventType } from '@libs/dto';

import { DownloadFile } from '@/core/download/entities/download-file.entity';
import { DownloadTarget } from '@/core/download/entities/download-target.entity';
import { Download } from '@/core/download/entities/download.entity';

import { DownloadAdmissionService } from '@/core/download/download-admission.service';
import { DownloadService } from '@/core/download/download.service';
import { HubReaderService } from '@/core/download/hub-reader.service';
import { EventService } from '@/core/event/event.service';
import { NodeService } from '@/core/node/node.service';

import { TEST_DOWNLOAD_ID, buildDownload, buildDownloadTarget } from '@/test/download.factory';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const ACTOR_ID = 7;

/** Reads no rows, so every check a query makes passes. */
function emptyQuery() {
  return {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue([]),
  };
}

describe('DownloadAdmissionService', () => {
  let downloadRepository: { insert: ReturnType<typeof vi.fn<(download: Download) => Promise<unknown>>> };
  let downloadTargetRepository: {
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
  let downloadFileRepository: { insert: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };
  let busyQuery: ReturnType<typeof emptyQuery>;
  let downloadService: { findWithThrow: ReturnType<typeof vi.fn>; announce: ReturnType<typeof vi.fn> };
  let hubReaderService: { read: ReturnType<typeof vi.fn<HubReaderService['read']>> };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let downloadAdmissionService: DownloadAdmissionService;

  beforeEach(async () => {
    downloadRepository = { insert: vi.fn<(download: Download) => Promise<unknown>>().mockResolvedValue(undefined) };
    downloadTargetRepository = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn(() => emptyQuery()),
      query: vi.fn().mockResolvedValue([]),
    };

    busyQuery = emptyQuery();

    downloadFileRepository = { insert: vi.fn(), createQueryBuilder: vi.fn().mockReturnValue(busyQuery) };
    downloadService = { findWithThrow: vi.fn().mockResolvedValue(buildDownload([])), announce: vi.fn() };
    hubReaderService = { read: vi.fn<HubReaderService['read']>() };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DownloadAdmissionService,
        { provide: DownloadService, useValue: downloadService },
        { provide: EventService, useValue: eventService },
        { provide: HubReaderService, useValue: hubReaderService },
        {
          provide: NodeService,
          useValue: {
            findWithThrow: vi.fn().mockResolvedValue({}),
            findNames: vi.fn().mockResolvedValue(new Map([[1, 'gpu-01']])),
          },
        },
        { provide: getRepositoryToken(Download), useValue: downloadRepository },
        { provide: getRepositoryToken(DownloadFile), useValue: downloadFileRepository },
        { provide: getRepositoryToken(DownloadTarget), useValue: downloadTargetRepository },
      ],
    }).compile();

    downloadAdmissionService = moduleRef.get(DownloadAdmissionService);
  });

  describe('create', () => {
    const definition = {
      repository: 'owner/repo',
      directory: 'huggingface/owner/repo',
      revision: 'main',
      files: ['model.gguf'],
      nodeIds: [1],
      modelDirectories: [],
    };

    it.each([
      ['a repository not named owner/name', { repository: 'gpt2' }, 'Enter the repository as owner/name'],
      ['a path that climbs out of the repository', { files: ['../escape.gguf'] }, 'cannot be downloaded to a node'],
      ['a path ending in the partial suffix', { files: ['model.gguf.part'] }, 'cannot be downloaded to a node'],
      ['no files', { files: [' '] }, 'Select between 1 and 64 files per download'],
      ['no nodes', { nodeIds: [] }, 'Select at least one node'],
      [
        'a model directory for a node it does not name',
        { modelDirectories: [{ nodeId: 2, path: '/models' }] },
        'Select a model directory only for nodes included in this download.',
      ],
      [
        'two model directories for one node',
        {
          modelDirectories: [
            { nodeId: 1, path: '/models' },
            { nodeId: 1, path: '/bulk' },
          ],
        },
        'Select only one model directory per node.',
      ],
      [
        'a model directory holding a NUL',
        { modelDirectories: [{ nodeId: 1, path: '/models\0' }] },
        'Model directory paths must be non-empty, at most 1024 characters long, and contain no null characters.',
      ],
      [
        'a model directory of whitespace alone',
        { modelDirectories: [{ nodeId: 1, path: '   ' }] },
        'Model directory paths must be non-empty, at most 1024 characters long, and contain no null characters.',
      ],
      [
        'a model directory longer in UTF-16 than the desired set carries',
        { modelDirectories: [{ nodeId: 1, path: `/${'😀'.repeat(600)}` }] },
        'Model directory paths must be non-empty, at most 1024 characters long, and contain no null characters.',
      ],
    ])('refuses %s without asking the Hub', async (_case, change, message) => {
      await expect(downloadAdmissionService.create({ ...definition, ...change }, ACTOR_ID)).rejects.toThrow(message);
      expect(hubReaderService.read).not.toHaveBeenCalled();
    });

    describe('once the Hub has read the repository', () => {
      beforeEach(() => {
        hubReaderService.read.mockImplementation((repository, _revision, paths) =>
          Promise.resolve({
            repository,
            revision: 'a'.repeat(40),
            files: paths.map(path => ({
              path,
              sizeBytes: 1,
              digestAlgorithm: DownloadDigestAlgorithm.SHA256,
              digest: 'b'.repeat(64),
            })),
          })
        );
        downloadRepository.insert.mockImplementation(download => {
          download.id = TEST_DOWNLOAD_ID;

          return Promise.resolve(undefined);
        });
      });

      it('writes one file per name and one target per node, however often each was named', async () => {
        await downloadAdmissionService.create(
          { ...definition, files: ['model.gguf', ' model.gguf', 'config.json'], nodeIds: [1, 1] },
          ACTOR_ID
        );

        expect(hubReaderService.read).toHaveBeenCalledWith('owner/repo', 'main', ['model.gguf', 'config.json']);
        expect(downloadFileRepository.insert.mock.calls[0][0]).toHaveLength(2);
        expect(downloadTargetRepository.insert.mock.calls[0][0]).toHaveLength(1);
      });

      it('keeps the model directory chosen for each node, and none for a node left out', async () => {
        await downloadAdmissionService.create(
          { ...definition, nodeIds: [1, 2], modelDirectories: [{ nodeId: 2, path: '/bulk' }] },
          ACTOR_ID
        );

        const targets = downloadTargetRepository.insert.mock.calls[0][0] as DownloadTarget[];

        expect(targets.map(target => [target.nodeId, target.modelDirectory])).toEqual([
          [1, null],
          [2, '/bulk'],
        ]);
      });

      it.each([
        ['the same model directory', '/models', '/models'],
        ['no model directory on the active download, which may be the same', null, '/models'],
        ['no model directory on the new download, which may be the same', '/models', null],
      ])('refuses a file another active download lands at the same path in %s', async (_case, active, chosen) => {
        busyQuery.getRawMany.mockResolvedValue([
          { path: 'huggingface/owner/repo/model.gguf', nodeId: 1, modelDirectory: active },
        ]);

        const modelDirectories = chosen === null ? [] : [{ nodeId: 1, path: chosen }];

        await expect(downloadAdmissionService.create({ ...definition, modelDirectories }, ACTOR_ID)).rejects.toThrow(
          'Another download is already writing huggingface/owner/repo/model.gguf on gpu-01'
        );
      });

      it('admits a file another active download lands at the same path in another model directory', async () => {
        busyQuery.getRawMany.mockResolvedValue([
          { path: 'huggingface/owner/repo/model.gguf', nodeId: 1, modelDirectory: '/models' },
        ]);

        await downloadAdmissionService.create(
          { ...definition, modelDirectories: [{ nodeId: 1, path: '/bulk' }] },
          ACTOR_ID
        );

        expect(downloadTargetRepository.insert).toHaveBeenCalled();
      });

      it('lands the files where the operator named', async () => {
        await downloadAdmissionService.create({ ...definition, directory: 'gguf/qwen' }, ACTOR_ID);

        expect(downloadRepository.insert.mock.calls[0][0].directory).toBe('gguf/qwen');
      });
    });

    it('refuses a destination that would leave the model directory', async () => {
      await expect(
        downloadAdmissionService.create({ ...definition, directory: '../elsewhere' }, ACTOR_ID)
      ).rejects.toThrow('Enter a path within the model directory');
      expect(hubReaderService.read).not.toHaveBeenCalled();
    });

    it('writes nothing when the Hub refuses the repository', async () => {
      hubReaderService.read.mockRejectedValue(new BadRequestException('This repository is gated'));

      await expect(downloadAdmissionService.create(definition, ACTOR_ID)).rejects.toThrow('This repository is gated');
      expect(downloadRepository.insert).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it.each([
      ['refuses', '/bulk', true],
      ['admits', '/models', false],
    ])(
      '%s a retry against a download active in the model directory %s, checking the one its target keeps',
      async (_verb, active, refused) => {
        const target = buildDownloadTarget(1, DownloadTargetState.FAILED);

        target.modelDirectory = '/bulk';
        downloadService.findWithThrow.mockResolvedValue(buildDownload([target]));
        busyQuery.getRawMany.mockResolvedValue([
          { path: 'huggingface/owner/repo/model.gguf', nodeId: 1, modelDirectory: active },
        ]);

        const retried = downloadAdmissionService.retry(TEST_DOWNLOAD_ID, ACTOR_ID);

        if (refused) {
          await expect(retried).rejects.toThrow('Another download is already writing');
        } else {
          await retried;
        }

        expect(downloadTargetRepository.update).toHaveBeenCalledTimes(refused ? 0 : 1);
      }
    );

    it('refuses a download that neither failed nor was stopped on any node', async () => {
      downloadService.findWithThrow.mockResolvedValue(
        buildDownload([buildDownloadTarget(1, DownloadTargetState.SUCCEEDED)])
      );

      await expect(downloadAdmissionService.retry(TEST_DOWNLOAD_ID, ACTOR_ID)).rejects.toThrow(
        'Only failed or cancelled downloads can be retried'
      );
    });

    it('asks only the nodes it failed or was stopped on to try again, and records it', async () => {
      downloadService.findWithThrow.mockResolvedValue(
        buildDownload([
          buildDownloadTarget(1, DownloadTargetState.FAILED),
          buildDownloadTarget(2, DownloadTargetState.SUCCEEDED),
          buildDownloadTarget(3, DownloadTargetState.STOPPED),
        ])
      );
      await downloadAdmissionService.retry(TEST_DOWNLOAD_ID, ACTOR_ID);

      expect(downloadTargetRepository.update).toHaveBeenCalledWith(
        { id: In([10, 30]), state: In([DownloadTargetState.FAILED, DownloadTargetState.STOPPED]) },
        expect.objectContaining({ state: DownloadTargetState.ACTIVE, message: null, settledDate: null })
      );
      const changes = downloadTargetRepository.update.mock.calls[0][1] as { attempt: () => string };
      expect(changes.attempt()).toBe('"attempt" + 1');
      expect(downloadService.announce).toHaveBeenCalledWith([1, 3]);
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.DOWNLOAD_RETRIED,
        EventSeverity.INFO,
        expect.objectContaining({ detail: { repository: 'owner/repo', nodes: 'gpu-01, gpu-03' } })
      );
    });
  });
});
