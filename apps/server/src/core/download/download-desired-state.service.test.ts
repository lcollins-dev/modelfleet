import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadTargetState, EventSeverity, EventType } from '@libs/dto';

import { DownloadTarget } from '@/core/download/entities/download-target.entity';
import { Download } from '@/core/download/entities/download.entity';

import { ConfigService } from '@/config/config.service';
import { DownloadDesiredStateService } from '@/core/download/download-desired-state.service';
import { DownloadService } from '@/core/download/download.service';
import { HubReaderService } from '@/core/download/hub-reader.service';
import { EventService } from '@/core/event/event.service';

import { TEST_DOWNLOAD_KEY, buildDownload, buildDownloadTarget } from '@/test/download.factory';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const REPORT = { nodeId: 1, downloadKey: TEST_DOWNLOAD_KEY, attempt: 0, message: null };

describe('DownloadDesiredStateService', () => {
  let downloadTargetRepository: { findOne: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let downloadService: { announce: ReturnType<typeof vi.fn> };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let downloadDesiredStateService: DownloadDesiredStateService;

  beforeEach(async () => {
    downloadTargetRepository = {
      findOne: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    downloadService = { announce: vi.fn() };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DownloadDesiredStateService,
        { provide: ConfigService, useValue: { huggingfaceEndpoint: 'https://hub.test' } },
        { provide: DownloadService, useValue: downloadService },
        { provide: EventService, useValue: eventService },
        { provide: HubReaderService, useValue: {} },
        { provide: getRepositoryToken(Download), useValue: {} },
        { provide: getRepositoryToken(DownloadTarget), useValue: downloadTargetRepository },
      ],
    }).compile();

    downloadDesiredStateService = moduleRef.get(DownloadDesiredStateService);
  });

  describe('settle', () => {
    it('records a failure with the reason the node gave, and drops it from that node', async () => {
      const target = buildDownloadTarget(1, DownloadTargetState.ACTIVE);
      target.download = buildDownload([]);
      downloadTargetRepository.findOne.mockResolvedValue(target);
      await downloadDesiredStateService.settle({ ...REPORT, message: 'The disk filled' }, DownloadTargetState.FAILED);

      expect(downloadTargetRepository.update).toHaveBeenCalledWith(
        { id: target.id, attempt: 0, state: DownloadTargetState.ACTIVE },
        expect.objectContaining({ state: DownloadTargetState.FAILED, message: 'The disk filled' })
      );
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.DOWNLOAD_FAILED,
        EventSeverity.ERROR,
        expect.objectContaining({
          detail: { repository: 'owner/repo', nodeName: 'gpu-01', problem: 'The disk filled' },
        })
      );
      expect(downloadService.announce).toHaveBeenCalledWith([1]);
    });

    it('ignores a report about a download the node is no longer asked for, or from an earlier attempt', async () => {
      await downloadDesiredStateService.settle(REPORT, DownloadTargetState.SUCCEEDED);

      expect(downloadTargetRepository.update).not.toHaveBeenCalled();
      expect(eventService.recordEvent).not.toHaveBeenCalled();
      expect(downloadService.announce).not.toHaveBeenCalled();
    });

    it('records nothing when a stop settled the target first', async () => {
      const target = buildDownloadTarget(1, DownloadTargetState.ACTIVE);
      target.download = buildDownload([]);
      downloadTargetRepository.findOne.mockResolvedValue(target);
      downloadTargetRepository.update.mockResolvedValue({ affected: 0 });

      await downloadDesiredStateService.settle(REPORT, DownloadTargetState.SUCCEEDED);

      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });
  });
});
