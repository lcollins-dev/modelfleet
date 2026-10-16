import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadState, DownloadTargetState, EventSeverity, EventType } from '@libs/dto';

import { DownloadTarget } from '@/core/download/entities/download-target.entity';
import { Download } from '@/core/download/entities/download.entity';

import { DownloadService } from '@/core/download/download.service';
import { EventService } from '@/core/event/event.service';

import { TEST_DOWNLOAD_ID, buildDownload, buildDownloadTarget } from '@/test/download.factory';

const ACTOR_ID = 7;

describe('DownloadService', () => {
  let downloadRepository: { findOne: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let downloadTargetRepository: { update: ReturnType<typeof vi.fn> };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let downloadService: DownloadService;

  beforeEach(async () => {
    downloadRepository = { findOne: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    downloadTargetRepository = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DownloadService,
        { provide: EventService, useValue: eventService },
        { provide: getRepositoryToken(Download), useValue: downloadRepository },
        { provide: getRepositoryToken(DownloadTarget), useValue: downloadTargetRepository },
      ],
    }).compile();

    downloadService = moduleRef.get(DownloadService);
  });

  describe('stop', () => {
    it('stops only the node named, leaving the rest downloading', async () => {
      downloadRepository.findOne.mockResolvedValue(
        buildDownload([
          buildDownloadTarget(1, DownloadTargetState.ACTIVE),
          buildDownloadTarget(2, DownloadTargetState.ACTIVE),
        ])
      );
      const changed: number[] = [];
      downloadService.getDesiredDownloadChanges().subscribe(nodeId => changed.push(nodeId));

      await downloadService.stop(TEST_DOWNLOAD_ID, 2, ACTOR_ID);

      expect(downloadTargetRepository.update).toHaveBeenCalledWith(
        { id: In([20]), state: DownloadTargetState.ACTIVE },
        expect.objectContaining({ state: DownloadTargetState.STOPPED })
      );
      expect(changed).toEqual([2]);
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.DOWNLOAD_STOPPED,
        EventSeverity.INFO,
        expect.objectContaining({ detail: { repository: 'owner/repo', nodes: 'gpu-02' } })
      );
    });

    it('stops every node still downloading where none is named', async () => {
      downloadRepository.findOne.mockResolvedValue(
        buildDownload([
          buildDownloadTarget(1, DownloadTargetState.ACTIVE),
          buildDownloadTarget(2, DownloadTargetState.SUCCEEDED),
        ])
      );
      const changed: number[] = [];
      downloadService.getDesiredDownloadChanges().subscribe(nodeId => changed.push(nodeId));

      await downloadService.stop(TEST_DOWNLOAD_ID, undefined, ACTOR_ID);

      expect(changed).toEqual([1]);
    });

    it('refuses to stop a node that is not downloading', async () => {
      downloadRepository.findOne.mockResolvedValue(buildDownload([buildDownloadTarget(1, DownloadTargetState.FAILED)]));

      await expect(downloadService.stop(TEST_DOWNLOAD_ID, 1, ACTOR_ID)).rejects.toThrow(
        'This download is not in progress on that node'
      );
    });

    it('refuses to stop a download no node is still downloading', async () => {
      downloadRepository.findOne.mockResolvedValue(
        buildDownload([buildDownloadTarget(1, DownloadTargetState.STOPPED)])
      );

      await expect(downloadService.stop(TEST_DOWNLOAD_ID, undefined, ACTOR_ID)).rejects.toThrow(
        'This download is no longer in progress on any node'
      );
    });
  });

  describe('stateOf', () => {
    it.each([
      [[DownloadTargetState.SUCCEEDED, DownloadTargetState.ACTIVE, DownloadTargetState.FAILED], DownloadState.ACTIVE],
      [[DownloadTargetState.SUCCEEDED, DownloadTargetState.FAILED, DownloadTargetState.STOPPED], DownloadState.FAILED],
      [[DownloadTargetState.SUCCEEDED, DownloadTargetState.SUCCEEDED], DownloadState.COMPLETED],
      [[DownloadTargetState.SUCCEEDED, DownloadTargetState.STOPPED], DownloadState.STOPPED],
      [[], DownloadState.STOPPED],
    ])('reads targets %j as %s', (states, expected) => {
      const download = buildDownload(states.map((state, index) => buildDownloadTarget(index + 1, state)));

      expect(downloadService.stateOf(download)).toBe(expected);
    });
  });

  describe('dismiss', () => {
    it('refuses a download still in progress on any node', async () => {
      downloadRepository.findOne.mockResolvedValue(
        buildDownload([
          buildDownloadTarget(1, DownloadTargetState.SUCCEEDED),
          buildDownloadTarget(2, DownloadTargetState.ACTIVE),
        ])
      );

      await expect(downloadService.dismiss(TEST_DOWNLOAD_ID, ACTOR_ID)).rejects.toThrow('stop it before dismissing it');
      expect(downloadRepository.delete).not.toHaveBeenCalled();
    });

    it('removes a download settled on every node, failed or not', async () => {
      downloadRepository.findOne.mockResolvedValue(
        buildDownload([
          buildDownloadTarget(1, DownloadTargetState.SUCCEEDED),
          buildDownloadTarget(2, DownloadTargetState.FAILED),
        ])
      );

      await downloadService.dismiss(TEST_DOWNLOAD_ID, ACTOR_ID);

      expect(downloadRepository.delete).toHaveBeenCalledWith({ id: TEST_DOWNLOAD_ID });
    });
  });

  describe('announce', () => {
    it('tells the wire each node whose set changed, and every reader that a row did', () => {
      const nodes: number[] = [];
      let rows = 0;

      downloadService.getDesiredDownloadChanges().subscribe(nodeId => nodes.push(nodeId));
      downloadService.getDownloadChanges().subscribe(() => (rows += 1));

      downloadService.announce([1, 2]);

      expect(nodes).toEqual([1, 2]);
      expect(rows).toBe(1);
    });
  });
});
