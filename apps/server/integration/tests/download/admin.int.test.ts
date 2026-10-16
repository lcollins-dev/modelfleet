import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { MAX_DOWNLOADS_PER_NODE, MAX_FILES_PER_DOWNLOAD } from '@libs/agent-protocol';
import {
  DownloadState,
  DownloadTargetState,
  EventPartyType,
  EventType,
  DownloadDto,
  EventDto,
  UserRoleId,
} from '@libs/dto';

import {
  createDownload,
  dismissDownload,
  getDownload,
  getDownloadList,
  getRepositoryListing,
  retryDownload,
  stopDownload,
} from '../../clients/download.client';
import { getEventList } from '../../clients/event.client';
import { deleteNode, registerNode } from '../../clients/node.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';
import { FAKE_HUB_COMMIT, FAKE_HUB_GATED, FAKE_HUB_PUBLIC, FAKE_HUB_UNREADABLE } from '../../utils/fake-hub';

const DIRECTORY = 'huggingface/public-gguf';

describe('Downloads (integration)', () => {
  let app: NestExpressApplication;
  let adminToken: string;

  const register = async (): Promise<number> => {
    const response = await registerNode(app, adminToken, { name: `rig-${randomUUID()}` }).expect(201);

    return response.body.id as number;
  };

  const create = async (nodeIds: number[], files: string[] = ['model.gguf']): Promise<DownloadDto> => {
    const response = await createDownload(app, adminToken, {
      repository: FAKE_HUB_PUBLIC.toLowerCase(),
      directory: DIRECTORY,
      files,
      nodeIds,
    }).expect(201);

    return response.body as DownloadDto;
  };

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  describe('create', () => {
    it('pins the commit, spells the repository as the Hub does, and keeps the files in the order named', async () => {
      const nodeId = await register();

      const download = await create([nodeId], ['config.json', 'model.gguf']);

      expect(download).toMatchObject({
        repository: FAKE_HUB_PUBLIC,
        directory: DIRECTORY,
        revision: FAKE_HUB_COMMIT,
        files: [
          { path: 'config.json', sizeBytes: 752 },
          { path: 'model.gguf', sizeBytes: 639_447_744 },
        ],
        targets: [{ nodeId, state: DownloadTargetState.ACTIVE, progress: null }],
        state: DownloadState.ACTIVE,
      });
    });

    it('refuses a file another download is still writing on the same node, at any commit', async () => {
      const busy = await register();
      const free = await register();

      await create([busy]);

      const response = await createDownload(app, adminToken, {
        repository: FAKE_HUB_PUBLIC,
        directory: DIRECTORY,
        files: ['model.gguf'],
        nodeIds: [free, busy],
      }).expect(400);

      expect(response.body.message).toMatch(
        new RegExp(`^Another download is already writing ${DIRECTORY}/model\\.gguf on rig-`)
      );
    });

    it('refuses a download naming no destination', async () => {
      const nodeId = await register();

      await createDownload(app, adminToken, {
        repository: FAKE_HUB_PUBLIC,
        files: ['model.gguf'],
        nodeIds: [nodeId],
      }).expect(400);
    });

    it('lands the files where the operator names, and lets one file land at two places on a node', async () => {
      const nodeId = await register();

      await create([nodeId]);

      const response = await createDownload(app, adminToken, {
        repository: FAKE_HUB_PUBLIC,
        directory: 'gguf/public',
        files: ['model.gguf'],
        nodeIds: [nodeId],
      }).expect(201);

      expect((response.body as DownloadDto).directory).toBe('gguf/public');
    });

    it('refuses a second download landing a file at the same place on a node', async () => {
      const nodeId = await register();

      await createDownload(app, adminToken, {
        repository: FAKE_HUB_PUBLIC,
        directory: 'gguf/public',
        files: ['model.gguf'],
        nodeIds: [nodeId],
      }).expect(201);

      const response = await createDownload(app, adminToken, {
        repository: FAKE_HUB_PUBLIC,
        directory: 'gguf/public/',
        files: ['model.gguf'],
        nodeIds: [nodeId],
      }).expect(400);

      expect(response.body.message).toMatch(/^Another download is already writing gguf\/public\/model\.gguf on rig-/);
    });

    it.each([
      [FAKE_HUB_GATED, ['config.json'], `${FAKE_HUB_GATED} is gated, and cannot be downloaded without a token`],
      [
        'owner/private',
        ['config.json'],
        'owner/private does not exist, or is private and cannot be reached without a token',
      ],
      [FAKE_HUB_PUBLIC, ['missing.gguf', 'Q4_K_M'], `${FAKE_HUB_PUBLIC} holds no file missing.gguf, Q4_K_M at`],
    ])('refuses %s with the reason the Hub gives, writing nothing', async (repository, files, reason) => {
      const nodeId = await register();

      const response = await createDownload(app, adminToken, {
        repository,
        directory: DIRECTORY,
        files,
        nodeIds: [nodeId],
      }).expect(400);

      expect(response.body.message).toContain(reason);

      const targets = await dbQuery(app, 'SELECT id FROM download_target WHERE "nodeId" = $1', [nodeId]);
      expect(targets).toEqual([]);
    });

    it('refuses a node already working through as many downloads as a set can carry', async () => {
      const nodeId = await register();

      for (let download = 0; download < MAX_DOWNLOADS_PER_NODE; download += 1) {
        await createDownload(app, adminToken, {
          repository: FAKE_HUB_PUBLIC,
          directory: `capped/${download}`,
          files: ['config.json'],
          nodeIds: [nodeId],
        }).expect(201);
      }

      const response = await createDownload(app, adminToken, {
        repository: FAKE_HUB_PUBLIC,
        directory: 'capped/over',
        files: ['config.json'],
        nodeIds: [nodeId],
      }).expect(400);

      expect(response.body.message).toMatch(new RegExp(`already has ${MAX_DOWNLOADS_PER_NODE} downloads in progress$`));
    });

    it('admits only one of two downloads racing to land the same file on a node', async () => {
      const nodeId = await register();
      const request = { repository: FAKE_HUB_PUBLIC, directory: 'raced', files: ['config.json'], nodeIds: [nodeId] };

      const statuses = await Promise.all([
        createDownload(app, adminToken, request).then(response => response.status),
        createDownload(app, adminToken, request).then(response => response.status),
      ]);

      expect(statuses.sort()).toEqual([201, 400]);
    });

    it('lets a file be downloaded again once the first download of it has settled', async () => {
      const nodeId = await register();
      const first = await create([nodeId]);

      await stopDownload(app, adminToken, first.id).expect(201);

      await create([nodeId]);
    });
  });

  describe('listing', () => {
    it('reads the whole tree from the Hub at the commit the revision points at', async () => {
      const response = await getRepositoryListing(app, adminToken, { repository: FAKE_HUB_PUBLIC }).expect(200);

      expect(response.body).toEqual({
        repository: FAKE_HUB_PUBLIC,
        revision: FAKE_HUB_COMMIT,
        files: [
          { path: 'config.json', sizeBytes: 752 },
          { path: 'model.gguf', sizeBytes: 639_447_744 },
        ],
        truncated: false,
        maxFilesPerDownload: MAX_FILES_PER_DOWNLOAD,
      });
    });

    it.each([
      ['owner/private', 'main', 'owner/private does not exist, or is private and cannot be reached without a token'],
      [FAKE_HUB_PUBLIC, 'nope', `${FAKE_HUB_PUBLIC} has no revision nope`],
    ])('answers the Hub refusing %s at %s with the reason', async (repository, revision, reason) => {
      const response = await getRepositoryListing(app, adminToken, { repository, revision }).expect(400);

      expect(response.body.message).toContain(reason);
    });

    it('refuses on the repository field, as a 400, a Hub that cannot be read at all', async () => {
      const response = await getRepositoryListing(app, adminToken, { repository: FAKE_HUB_UNREADABLE }).expect(400);

      expect(response.body.message).toEqual([
        { path: 'repository', name: 'Repository', message: `${process.env.HUGGINGFACE_ENDPOINT} could not be read` },
      ]);
    });
  });

  describe('retry', () => {
    it('refuses to ask a node again for a file another download has since started writing there', async () => {
      const nodeId = await register();
      const first = await create([nodeId]);

      await stopDownload(app, adminToken, first.id).expect(201);
      await create([nodeId]);

      const response = await retryDownload(app, adminToken, first.id).expect(400);

      expect(response.body.message).toMatch(
        new RegExp(`^Another download is already writing ${DIRECTORY}/model\\.gguf on rig-`)
      );
    });
  });

  describe('dismiss', () => {
    it('removes a settled download with its files', async () => {
      const nodeId = await register();
      const download = await create([nodeId]);

      await stopDownload(app, adminToken, download.id).expect(201);
      await dismissDownload(app, adminToken, download.id).expect(200);

      await getDownload(app, adminToken, download.id).expect(400);

      const files = await dbQuery(app, 'SELECT id FROM download_file WHERE "downloadId" = $1', [download.id]);
      expect(files).toEqual([]);
    });

    it('names the download by its repository in the event log while it exists', async () => {
      const download = await create([await register()]);

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.DOWNLOAD,
        subjectId: `${download.id}`,
      }).expect(200);

      expect((response.body.eventList as EventDto[])[0].subjectName).toBe(FAKE_HUB_PUBLIC);
    });

    it('keeps the download events in the log after it is gone', async () => {
      const nodeId = await register();
      const download = await create([nodeId]);

      await stopDownload(app, adminToken, download.id).expect(201);
      await dismissDownload(app, adminToken, download.id).expect(200);

      const response = await getEventList(app, adminToken, {
        subjectType: EventPartyType.DOWNLOAD,
        subjectId: `${download.id}`,
      }).expect(200);
      const types = (response.body.eventList as EventDto[]).map(event => event.type);

      expect(types).toEqual([EventType.DOWNLOAD_DISMISSED, EventType.DOWNLOAD_STOPPED, EventType.DOWNLOAD_REQUESTED]);
    });
  });

  it('drops a deleted node from every download it was part of', async () => {
    const kept = await register();
    const deleted = await register();
    const download = await create([kept, deleted]);

    await deleteNode(app, adminToken, deleted).expect(200);

    const response = await getDownload(app, adminToken, download.id).expect(200);

    expect((response.body as DownloadDto).targets.map(target => target.nodeId)).toEqual([kept]);
  });

  it('fills a page with downloads, however many files and nodes each has', async () => {
    for (let download = 0; download < 21; download += 1) {
      await create([await register(), await register()], ['config.json', 'model.gguf']);
    }

    const response = await getDownloadList(app, adminToken).expect(200);

    expect(response.body.downloadList).toHaveLength(20);
    expect((response.body.downloadList as DownloadDto[]).every(download => download.targets.length > 0)).toBe(true);
  });

  it('narrows the list to a state and counts every state under the same search', async () => {
    const nodeId = await register();
    const stopped = await create([nodeId], ['config.json']);
    const active = await create([await register()], ['config.json']);

    await stopDownload(app, adminToken, stopped.id).expect(201);

    const response = await getDownloadList(app, adminToken, {
      search: 'public-gguf',
      state: DownloadState.STOPPED,
    }).expect(200);
    const ids = (response.body.downloadList as DownloadDto[]).map(download => download.id);
    const counts = response.body.counts as Record<DownloadState, number>;

    expect(ids).toContain(stopped.id);
    expect(ids).not.toContain(active.id);
    expect(counts[DownloadState.STOPPED]).toBeGreaterThan(0);
    expect(counts[DownloadState.ACTIVE]).toBeGreaterThan(0);

    const none = await getDownloadList(app, adminToken, { search: 'no-such-repository' }).expect(200);

    expect(none.body.counts).toEqual({ active: 0, failed: 0, stopped: 0, completed: 0 });
  });

  it.each([
    [DownloadState.FAILED, [DownloadTargetState.SUCCEEDED, DownloadTargetState.FAILED]],
    [DownloadState.COMPLETED, [DownloadTargetState.SUCCEEDED, DownloadTargetState.SUCCEEDED]],
    [DownloadState.STOPPED, [DownloadTargetState.SUCCEEDED, DownloadTargetState.STOPPED]],
    [DownloadState.ACTIVE, [DownloadTargetState.FAILED, DownloadTargetState.ACTIVE]],
    [DownloadState.STOPPED, []],
  ])('lists as %s a download whose nodes are %j, as its page reads it', async (state, targetStates) => {
    const download = await create([await register(), await register()], ['config.json']);

    await dbQuery(
      app,
      'DELETE FROM download_target WHERE "downloadId" = $1 AND id NOT IN (SELECT id FROM download_target WHERE "downloadId" = $1 ORDER BY id LIMIT $2)',
      [download.id, targetStates.length]
    );

    for (const [index, targetState] of targetStates.entries()) {
      await dbQuery(
        app,
        'UPDATE download_target SET state = $1 WHERE id = (SELECT id FROM download_target WHERE "downloadId" = $2 ORDER BY id OFFSET $3 LIMIT 1)',
        [targetState, download.id, index]
      );
    }

    const listed = await getDownloadList(app, adminToken, { state }).expect(200);
    const read = await getDownload(app, adminToken, download.id).expect(200);

    expect((listed.body.downloadList as DownloadDto[]).map(entry => entry.id)).toContain(download.id);
    expect((read.body as DownloadDto).state).toBe(state);
  });

  it('lists downloads newest first', async () => {
    const nodeId = await register();
    const older = await create([nodeId], ['config.json']);
    const newer = await create([await register()], ['config.json']);

    const response = await getDownloadList(app, adminToken).expect(200);
    const ids = (response.body.downloadList as DownloadDto[]).map(download => download.id);

    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });
});
