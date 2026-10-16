import { DownloadSource, DownloadTargetState } from '@libs/dto';

import { DownloadTarget } from '@/core/download/entities/download-target.entity';
import { Download } from '@/core/download/entities/download.entity';

import { buildNode } from '@/test/node.factory';

export const TEST_DOWNLOAD_ID = 12;
export const TEST_DOWNLOAD_KEY = '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f';

/** On a node named `gpu-0<nodeId>`, which the services' messages quote. */
export const buildDownloadTarget = (nodeId: number, state: DownloadTargetState): DownloadTarget => {
  const target = new DownloadTarget({ downloadId: TEST_DOWNLOAD_ID, nodeId });

  target.id = nodeId * 10;
  target.state = state;
  target.node = buildNode({ id: nodeId, name: `gpu-0${nodeId}` });

  return target;
};

/** Builds a download as a row read back from the database. */
export const buildDownload = (targets: DownloadTarget[]): Download => {
  const download = new Download({
    source: DownloadSource.HUGGINGFACE,
    repository: 'owner/repo',
    directory: 'huggingface/owner/repo',
    revision: 'a'.repeat(40),
    createdById: 7,
  });

  download.id = TEST_DOWNLOAD_ID;
  download.downloadKey = TEST_DOWNLOAD_KEY;
  download.files = [];
  download.targets = targets;

  return download;
};
