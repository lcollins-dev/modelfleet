import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { DownloadFileState } from '@libs/dto';

import MfMeter from '../Meter.vue';
import TargetFiles from './TargetFiles.vue';

const MIB = 1024 ** 2;

const mountFiles = () =>
  mount(TargetFiles, {
    props: {
      nodeName: 'rig-01',
      downloadFiles: [
        { path: 'model.gguf', sizeBytes: 200 * MIB },
        { path: 'mmproj.gguf', sizeBytes: 100 * MIB },
        { path: 'config.json', sizeBytes: 1024 },
      ],
      files: [
        { path: 'model.gguf', state: DownloadFileState.DONE, bytesDone: 200 * MIB },
        { path: 'mmproj.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 50 * MIB },
        { path: 'config.json', state: DownloadFileState.PENDING, bytesDone: 0 },
      ],
    },
  });

describe('MfDownloadTargetFiles', () => {
  it('lines up each file with its state, a bar, and its bytes and percentage', () => {
    const rows = mountFiles().findAll('[data-testid="download-target-file"]');

    expect(rows.map(row => Array.from(row.element.children).map(cell => cell.textContent.trim()))).toEqual([
      ['model.gguf', 'Done', '', '200 MiB / 200 MiB (100%)'],
      ['mmproj.gguf', 'Downloading', '', '50 MiB / 100 MiB (50%)'],
      ['config.json', 'Waiting', '', '0 B / 1 KiB (0%)'],
    ]);
  });

  it('fills each bar to the share of that file done, in the tone of its state', () => {
    const meters = mountFiles().findAllComponents(MfMeter);

    expect(meters[0].props('bands')).toEqual([{ label: 'Done', tone: 'success', percent: 100 }]);
    expect(meters[1].props('bands')).toEqual([{ label: 'Downloading', tone: 'primary', percent: 50 }]);
    expect(meters[2].props('bands')).toEqual([{ label: 'Waiting', tone: 'muted', percent: 0 }]);
  });

  it('scrolls in a region named for the node', () => {
    expect(mountFiles().get('[role="region"]').attributes('aria-label')).toBe('Files on rig-01');
  });
});
